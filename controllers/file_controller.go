package controllers

import (
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strconv"

	"telegram-storage/services"

	"github.com/gin-gonic/gin"
)

func InitNewUpload(c *gin.Context) {

	var req struct {
		Name     string `json:"name" binding:"required"`
		Size     int64  `json:"size" binding:"required"`
		MimeType string `json:"mime_type"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	metadata, err := services.AppFileService.InitUpload(req.Name, req.Size, req.MimeType)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, metadata)
}

func UploadChunk(c *gin.Context) {
	uploadID := c.PostForm("upload_id")
	sequenceStr := c.PostForm("sequence")
	fileHeader, err := c.FormFile("file")
	if uploadID == "" || sequenceStr == "" || err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing upload_id, sequence, or file"})
		return
	}
	sequence, err := strconv.Atoi(sequenceStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid sequence"})
		return
	}

	file, err := fileHeader.Open()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to open file"})
		return
	}
	defer file.Close()

	groupIDStr := os.Getenv("TELEGRAM_GROUP_ID")
	if groupIDStr == "" {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "TELEGRAM_GROUP_ID not configured"})
		return
	}
	groupID, err := strconv.ParseInt(groupIDStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "invalid TELEGRAM_GROUP_ID"})
		return
	}

	chunk, err := services.AppFileService.UploadChunk(uploadID, sequence, file, fileHeader.Size, groupID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, chunk)
}

func CompleteUpload(c *gin.Context) {
	var req struct {
		UploadID string `json:"upload_id" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	err := services.AppFileService.CompleteUpload(req.UploadID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "completed"})
}

func ListFiles(c *gin.Context) {
	files, err := services.AppFileService.ListFiles()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, files)
}

func GetFile(c *gin.Context) {
	fileID := c.Param("fileID")

	metadata, err := services.AppFileService.GetFileMetadata(fileID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=%s", metadata.Name))
	c.Header("Content-Type", metadata.MimeType)

	c.Stream(func(w io.Writer) bool {
		err := services.AppFileService.AssembleFile(fileID, w)
		if err != nil {
			log.Printf("Error when assembling file: %v", err)
			return false
		}
		return false
	})
}
