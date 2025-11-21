package services

import (
	"context"
	"fmt"
	"io"
	"log"
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
)

type FileService struct {
	botPool     *bot.BotPool
	db          *mongo.Database
	uploadLocks sync.Map
}

var AppFileService *FileService

func NewFileService(botPool *bot.BotPool, db *mongo.Database) *FileService {
	return &FileService{
		botPool:     botPool,
		db:          db,
		uploadLocks: sync.Map{},
	}
}

func (s *FileService) InitUpload(name string, size int64, mimeType string) (*models.FileMetadata, error) {
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
	return &metadata, nil
}

func (s *FileService) UploadChunk(uploadID string, sequence int, chunkData io.Reader, chunkSize int64, groupID int64) (*models.FileChunk, error) {
	startTime := time.Now()
	oid, err := primitive.ObjectIDFromHex(uploadID)
	if err != nil {
		return nil, fmt.Errorf("invalid upload id: %v", err)
	}

	lockInterface, _ := s.uploadLocks.LoadOrStore(uploadID, &sync.Mutex{})
	lock := lockInterface.(*sync.Mutex)
	lock.Lock()
	defer lock.Unlock()

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
		if strings.Contains(err.Error(), "Too Many Requests") || strings.Contains(err.Error(), "retry after") {
			retryAfter := 30
			fmt.Sscanf(err.Error(), "retry after %d", &retryAfter)
			log.Printf("[RATE LIMIT] Bot %s hit rate limit on chunk %d, retry after %d seconds", currentBot.Self.UserName, sequence, retryAfter)
			return nil, fmt.Errorf("rate limit: bot %s needs to wait %d seconds", currentBot.Self.UserName, retryAfter)
		}
		return nil, fmt.Errorf("telegram upload failed: %v", err)
	}

	if msg.Document == nil {
		return nil, fmt.Errorf("no document in message")
	}

	chunk := models.FileChunk{
		Sequence:  sequence,
		MessageID: msg.MessageID,
		FileID:    msg.Document.FileID,
		BotToken:  currentBot.Token[:20],
		Size:      chunkSize,
	}

	collection := s.db.Collection("files")
	filter := bson.M{"_id": oid}
	update := bson.M{
		"$push": bson.M{"chunks": chunk},
		"$set":  bson.M{"updated_at": time.Now()},
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	_, err = collection.UpdateOne(ctx, filter, update)
	if err != nil {
		return nil, fmt.Errorf("failed to update db: %v", err)
	}

	log.Printf("[%s] Chunk %d uploaded successfully (total time: %v, MsgID: %d)", uploadID, sequence, time.Since(startTime), msg.MessageID)
	return &chunk, nil
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
	log.Printf("[%s] Upload completed", uploadID)
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

func (s *FileService) DownloadChunk(chunk models.FileChunk, writer io.Writer) error {
	targetBot := s.findBotByTokenPrefix(chunk.BotToken)
	if targetBot == nil {
		log.Printf("Bot not found for chunk %d, using fallback", chunk.Sequence)
		targetBot = s.botPool.GetNextBot()
		if targetBot == nil {
			return fmt.Errorf("no bots available")
		}
	}

	file, err := targetBot.GetFile(tgbotapi.FileConfig{FileID: chunk.FileID})
	if err != nil {
		return fmt.Errorf("failed to get file info: %v", err)
	}

	link := file.Link(targetBot.Token)
	resp, err := http.Get(link)
	if err != nil {
		return fmt.Errorf("failed to download file: %v", err)
	}
	defer resp.Body.Close()

	written, err := io.Copy(writer, resp.Body)
	if err != nil {
		return fmt.Errorf("failed to write file: %v", err)
	}

	if written != chunk.Size {
		log.Printf("Chunk %d size mismatch: expected %d, got %d", chunk.Sequence, chunk.Size, written)
	}
	log.Printf("Chunk %d downloaded (%d bytes)", chunk.Sequence, written)
	return nil
}

func (s *FileService) findBotByTokenPrefix(prefix string) *tgbotapi.BotAPI {
	for _, bot := range s.botPool.GetAllBots() {
		if len(bot.Token) >= 20 && bot.Token[:20] == prefix {
			return bot
		}
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

	sort.Slice(metadata.Chunks, func(i, j int) bool {
		return metadata.Chunks[i].Sequence < metadata.Chunks[j].Sequence
	})

	log.Printf("[DOWNLOAD] Assembling '%s' (%d chunks)", metadata.Name, len(metadata.Chunks))
	totalWritten := int64(0)

	for i, chunk := range metadata.Chunks {
		if err := s.DownloadChunk(chunk, writer); err != nil {
			return fmt.Errorf("failed chunk %d: %v", chunk.Sequence, err)
		}
		totalWritten += chunk.Size
		log.Printf("[DOWNLOAD] Chunk %d/%d done (total: %d bytes)", i+1, len(metadata.Chunks), totalWritten)
	}

	if totalWritten != metadata.Size {
		log.Printf("[WARNING] Size mismatch: expected %d, wrote %d", metadata.Size, totalWritten)
	}
	log.Printf("[DOWNLOAD] File assembled (%d bytes)", totalWritten)
	return nil
}

func (s *FileService) ListFiles() ([]models.FileMetadata, error) {
	log.Printf("[ListFiles] Database object: %v", s.db.Name())

	collection := s.db.Collection("files")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	log.Printf("[ListFiles] Checking total count of ALL documents in 'files' collection...")
	totalCount, err := collection.CountDocuments(ctx, bson.M{})
	if err != nil {
		log.Printf("[ListFiles] Error counting total documents: %v", err)
	} else {
		log.Printf("[ListFiles] Total documents in 'files': %d", totalCount)
	}

	completedCount, err := collection.CountDocuments(ctx, bson.M{"status": "completed"})
	if err != nil {
		log.Printf("[ListFiles] Error counting completed documents: %v", err)
	} else {
		log.Printf("[ListFiles] Documents with status='completed': %d", completedCount)
	}

	log.Printf("[ListFiles] Fetching ALL documents to check their status...")
	allCursor, err := collection.Find(ctx, bson.M{})
	if err == nil {
		var allDocs []models.FileMetadata
		if err := allCursor.All(ctx, &allDocs); err == nil {
			log.Printf("[ListFiles] Found %d total documents", len(allDocs))
			for i, doc := range allDocs {
				log.Printf("[ListFiles] Doc %d: ID=%s, Name=%s, Status='%s'", i+1, doc.ID.Hex(), doc.Name, doc.Status)
			}
		}
		allCursor.Close(ctx)
	}

	log.Printf("[ListFiles] Now querying with status='completed' filter...")
	cursor, err := collection.Find(ctx, bson.M{"status": "completed"})
	if err != nil {
		log.Printf("[ListFiles] Error querying: %v", err)
		return nil, fmt.Errorf("failed to list files: %v", err)
	}
	defer cursor.Close(ctx)

	var files []models.FileMetadata
	if err := cursor.All(ctx, &files); err != nil {
		log.Printf("[ListFiles] Error decoding: %v", err)
		return nil, fmt.Errorf("failed to decode files: %v", err)
	}
	log.Printf("[ListFiles] Found %d completed files", len(files))
	for i, f := range files {
		log.Printf("[ListFiles] File %d: ID=%s, Name=%s, Size=%d, Status=%s", i+1, f.ID.Hex(), f.Name, f.Size, f.Status)
	}
	return files, nil
}
