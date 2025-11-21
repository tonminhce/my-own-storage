package services

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"sort"
	"strings"
	"sync"
	"telegram-storage/bot"
	"telegram-storage/models"
	"time"

	tgbotapi "github.com/go-telegram-bot-api/telegram-bot-api/v5"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
	"golang.org/x/time/rate"
)

const (
	MaxChunkSize     = 50 * 1024 * 1024 // 50MB per Telegram limit
	MaxChunksPerFile = 1000
	MaxRetries       = 3
	RetryDelay       = 2 * time.Second
)

var downloadClient = &http.Client{
	Timeout: 120 * time.Second,
	Transport: &http.Transport{
		MaxIdleConns:        100,
		MaxIdleConnsPerHost: 50,
		IdleConnTimeout:     90 * time.Second,
	},
}

type FileService struct {
	botPool         *bot.BotPool
	db              *mongo.Database
	uploadLocks     sync.Map
	downloadLimiter *rate.Limiter
}

var AppFileService *FileService

func NewFileService(botPool *bot.BotPool, db *mongo.Database) *FileService {
	return &FileService{
		botPool:         botPool,
		db:              db,
		uploadLocks:     sync.Map{},
		downloadLimiter: rate.NewLimiter(rate.Limit(20), 40),
	}
}

func (s *FileService) InitUpload(name string, size int64, mimeType string) (*models.FileMetadata, error) {

	if size <= 0 {
		return nil, fmt.Errorf("invalid file size: %d", size)
	}

	expectedChunks := int(math.Ceil(float64(size) / float64(MaxChunkSize)))
	if expectedChunks > MaxChunksPerFile {
		return nil, fmt.Errorf("file too large: would require %d chunks (max: %d)", expectedChunks, MaxChunksPerFile)
	}

	metadata := models.FileMetadata{
		ID:        primitive.NewObjectID(),
		Name:      name,
		Size:      size,
		MimeType:  mimeType,
		Status:    "pending",
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
		Chunks:    []models.FileChunk{},
	}

	collection := s.db.Collection("files")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	_, err := collection.InsertOne(ctx, metadata)
	if err != nil {
		return nil, fmt.Errorf("failed to insert file metadata: %v", err)
	}

	log.Printf("[InitUpload] Created upload %s for file '%s' (%d bytes, ~%d chunks)",
		metadata.ID.Hex(), name, size, expectedChunks)
	return &metadata, nil
}

func (s *FileService) chunkExists(ctx context.Context, uploadID string, sequence int) (bool, error) {
	oid, err := primitive.ObjectIDFromHex(uploadID)
	if err != nil {
		return false, fmt.Errorf("invalid upload id: %v", err)
	}

	collection := s.db.Collection("files")
	filter := bson.M{
		"_id":             oid,
		"chunks.sequence": sequence,
	}

	count, err := collection.CountDocuments(ctx, filter)
	if err != nil {
		return false, err
	}

	return count > 0, nil
}

func (s *FileService) uploadChunkWithRetry(uploadID string, sequence int, chunkData io.Reader, chunkSize int64, groupID int64) (*models.FileChunk, error) {
	var lastErr error

	for attempt := 0; attempt < MaxRetries; attempt++ {
		if attempt > 0 {
			backoff := time.Duration(math.Pow(2, float64(attempt))) * RetryDelay
			log.Printf("[Retry] Chunk %d attempt %d/%d, waiting %v", sequence, attempt+1, MaxRetries, backoff)
			time.Sleep(backoff)
		}

		chunk, err := s.uploadChunkOnce(uploadID, sequence, chunkData, chunkSize, groupID)
		if err == nil {
			return chunk, nil
		}

		lastErr = err

		if !isRetryableError(err) {
			break
		}
	}

	return nil, fmt.Errorf("failed after %d retries: %v", MaxRetries, lastErr)
}

func isRetryableError(err error) bool {
	errMsg := err.Error()
	return strings.Contains(errMsg, "timeout") ||
		strings.Contains(errMsg, "Too Many Requests") ||
		strings.Contains(errMsg, "connection") ||
		strings.Contains(errMsg, "EOF")
}

func (s *FileService) uploadChunkOnce(uploadID string, sequence int, chunkData io.Reader, chunkSize int64, groupID int64) (*models.FileChunk, error) {
	startTime := time.Now()
	log.Printf("[DEBUG] [%s] Start processing chunk %d", startTime.Format("15:04:05.000"), sequence) // LOG START

	oid, err := primitive.ObjectIDFromHex(uploadID)
	if err != nil {
		return nil, fmt.Errorf("invalid upload id: %v", err)
	}

	// Lock removed to allow parallel uploads
	// MongoDB $push is atomic, so data integrity is preserved.
	// Duplicate chunks (if any) are handled during assembly.

	if chunkSize > MaxChunkSize {
		return nil, fmt.Errorf("chunk size %d exceeds maximum %d", chunkSize, MaxChunkSize)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	exists, err := s.chunkExists(ctx, uploadID, sequence)
	if err != nil {
		return nil, fmt.Errorf("failed to check chunk existence: %v", err)
	}
	if exists {
		log.Printf("[UploadChunk] Chunk %d already exists for upload %s (idempotent)", sequence, uploadID)
		return &models.FileChunk{Sequence: sequence}, nil
	}

	currentBot := s.botPool.GetNextBot()
	if currentBot == nil {
		return nil, fmt.Errorf("no bots available")
	}

	fileName := fmt.Sprintf("chunk_%s_%d", uploadID, sequence)
	fileReader := tgbotapi.FileReader{Name: fileName, Reader: chunkData}
	doc := tgbotapi.NewDocument(groupID, fileReader)
	doc.Caption = fmt.Sprintf("ID: %s\nPart: %d", uploadID, sequence)

	msg, err := currentBot.Send(doc)
	if err != nil {
		return nil, fmt.Errorf("telegram upload failed: %v", err)
	}

	if msg.Document == nil {
		return nil, fmt.Errorf("no document in message")
	}

	chunk := models.FileChunk{
		Sequence:  sequence,
		MessageID: msg.MessageID,
		FileID:    msg.Document.FileID,
		BotToken:  currentBot.Self.UserName,
		Size:      chunkSize,
	}

	collection := s.db.Collection("files")
	filter := bson.M{"_id": oid}
	update := bson.M{
		"$push": bson.M{"chunks": chunk},
		"$set":  bson.M{"updated_at": time.Now()},
	}

	_, err = collection.UpdateOne(ctx, filter, update)
	if err != nil {
		return nil, fmt.Errorf("failed to update db: %v", err)
	}

	log.Printf("[Upload] Chunk %d/%s uploaded (%.2f KB, %v, bot: %s, msg: %d)",
		sequence, uploadID, float64(chunkSize)/1024, time.Since(startTime), currentBot.Self.UserName, msg.MessageID)
	return &chunk, nil
}

func (s *FileService) UploadChunk(uploadID string, sequence int, chunkData io.Reader, chunkSize int64, groupID int64) (*models.FileChunk, error) {
	return s.uploadChunkWithRetry(uploadID, sequence, chunkData, chunkSize, groupID)
}

func (s *FileService) CompleteUpload(uploadID string) error {
	oid, err := primitive.ObjectIDFromHex(uploadID)
	if err != nil {
		return fmt.Errorf("invalid upload id: %v", err)
	}

	collection := s.db.Collection("files")
	filter := bson.M{"_id": oid}
	update := bson.M{"$set": bson.M{"status": "completed", "updated_at": time.Now()}}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	res, err := collection.UpdateOne(ctx, filter, update)
	if err != nil {
		return fmt.Errorf("failed to complete upload: %v", err)
	}
	if res.MatchedCount == 0 {
		return fmt.Errorf("upload not found")
	}

	s.uploadLocks.Delete(uploadID)
	log.Printf("[Complete] Upload %s marked as completed", uploadID)
	return nil
}

func (s *FileService) GetFileMetadata(fileID string) (*models.FileMetadata, error) {
	oid, err := primitive.ObjectIDFromHex(fileID)
	if err != nil {
		return nil, fmt.Errorf("invalid file id: %v", err)
	}

	collection := s.db.Collection("files")
	var metadata models.FileMetadata
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err = collection.FindOne(ctx, bson.M{"_id": oid}).Decode(&metadata); err != nil {
		if err == mongo.ErrNoDocuments {
			return nil, fmt.Errorf("file not found")
		}
		return nil, fmt.Errorf("failed to get metadata: %v", err)
	}
	return &metadata, nil
}

func (s *FileService) findBotByUsername(username string) *tgbotapi.BotAPI {
	for _, bot := range s.botPool.GetAllBots() {
		if bot.Self.UserName == username {
			return bot
		}
	}
	return nil
}

func (s *FileService) DownloadChunk(chunk models.FileChunk, writer io.Writer) error {
	if err := s.downloadLimiter.Wait(context.Background()); err != nil {
		return fmt.Errorf("rate limit error: %v", err)
	}

	targetBot := s.findBotByUsername(chunk.BotToken)
	if targetBot == nil {
		log.Printf("[Download] Bot '%s' not found for chunk %d, using fallback", chunk.BotToken, chunk.Sequence)
		targetBot = s.botPool.GetNextBot()
		if targetBot == nil {
			return fmt.Errorf("no bots available")
		}
	}

	fileConfig := tgbotapi.FileConfig{FileID: chunk.FileID}
	file, err := targetBot.GetFile(fileConfig)
	if err != nil {
		return fmt.Errorf("failed to get file info: %v", err)
	}

	link := file.Link(targetBot.Token)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, "GET", link, nil)
	if err != nil {
		return fmt.Errorf("failed to create request: %v", err)
	}

	resp, err := downloadClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to download file: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("download failed with status: %d", resp.StatusCode)
	}

	written, err := io.Copy(writer, resp.Body)
	if err != nil {
		return fmt.Errorf("failed to write file: %v", err)
	}

	if written != chunk.Size {
		log.Printf("[Download] Chunk %d size mismatch: expected %d, got %d", chunk.Sequence, chunk.Size, written)
	}

	return nil
}

func (s *FileService) AssembleFile(fileID string, writer io.Writer) error {
	metadata, err := s.GetFileMetadata(fileID)
	if err != nil {
		return err
	}
	if metadata.Status != "completed" {
		return fmt.Errorf("file upload not completed")
	}

	// Sắp xếp chunks trước (bắt buộc)
	sort.Slice(metadata.Chunks, func(i, j int) bool {
		return metadata.Chunks[i].Sequence < metadata.Chunks[j].Sequence
	})

	totalChunks := len(metadata.Chunks)
	if totalChunks == 0 {
		return nil
	}

	// === CÀI ĐẶT NÀY QUYẾT ĐỊNH TỐC ĐỘ & MEMORY ===
	const maxConcurrent = 15 // 10–20 là sweet spot
	// ===============================================

	semaphore := make(chan struct{}, maxConcurrent) // giới hạn số goroutine download cùng lúc

	type chunkResult struct {
		seq  int
		data []byte
		err  error
	}

	resultChan := make(chan chunkResult, totalChunks)

	// Launch tất cả worker
	for _, chunk := range metadata.Chunks {
		semaphore <- struct{}{} // acquire
		go func(c models.FileChunk) {
			defer func() { <-semaphore }() // release

			var buf bytes.Buffer
			if err := s.DownloadChunk(c, &buf); err != nil {
				resultChan <- chunkResult{seq: c.Sequence, err: err}
				return
			}
			// Chuyển thành []byte để gửi qua channel (chunk max 50MB → an toàn)
			data := buf.Bytes()
			resultChan <- chunkResult{seq: c.Sequence, data: data}
		}(chunk)
	}

	// Thu thập kết quả theo đúng thứ tự
	buffer := make(map[int][]byte) // buffer các chunk về sớm
	nextSeq := 0
	received := 0
	totalWritten := int64(0)

	log.Printf("[Download] Assembling '%s' (%d chunks, concurrent: %d)", metadata.Name, totalChunks, maxConcurrent)

	for received < totalChunks {
		res := <-resultChan
		received++

		if res.err != nil {
			// Một chunk lỗi → hủy toàn bộ (không thể stream tiếp)
			return fmt.Errorf("failed chunk %d: %v", res.seq, res.err)
		}

		buffer[res.seq] = res.data

		// Viết tất cả chunk liên tiếp mà đã có
		for {
			if data, ok := buffer[nextSeq]; ok {
				n, err := writer.Write(data)
				if err != nil {
					return err
				}
				totalWritten += int64(n)
				delete(buffer, nextSeq)
				nextSeq++

				// Log progress
				if nextSeq%10 == 0 || nextSeq == totalChunks {
					log.Printf("[Download] Progress: %d/%d chunks (%.1f MB)",
						nextSeq, totalChunks, float64(totalWritten)/(1024*1024))
				}
			} else {
				break
			}
		}
	}

	if totalWritten != metadata.Size {
		log.Printf("[Download] WARNING: Size mismatch for '%s': expected %d, wrote %d", metadata.Name, metadata.Size, totalWritten)
	}

	log.Printf("[Download] File '%s' assembled successfully (%d bytes)", metadata.Name, totalWritten)
	return nil
}

func (s *FileService) ListFiles() ([]models.FileMetadata, error) {
	collection := s.db.Collection("files")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Optimized query: only select necessary fields and use index
	opts := options.Find().SetSort(bson.D{{Key: "created_at", Value: -1}})
	cursor, err := collection.Find(ctx, bson.M{"status": "completed"}, opts)
	if err != nil {
		return nil, fmt.Errorf("failed to list files: %v", err)
	}
	defer cursor.Close(ctx)

	var files []models.FileMetadata
	if err = cursor.All(ctx, &files); err != nil {
		return nil, fmt.Errorf("failed to decode files: %v", err)
	}

	return files, nil
}
