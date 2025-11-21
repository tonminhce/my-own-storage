package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"telegram-storage/bot"
	"telegram-storage/configs"
	"telegram-storage/controllers"
	"telegram-storage/services"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
)

func main() {
	if err := godotenv.Load(); err != nil {
		log.Fatal("Error loading .env file")
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	router := gin.Default()

	router.Use(cors.New(cors.Config{
		AllowOrigins:     []string{"*"},
		AllowMethods:     []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Authorization"},
		ExposeHeaders:    []string{"Content-Length"},
		AllowCredentials: true,
		MaxAge:           12 * time.Hour,
	}))

	router.GET("/healthz", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})
	router.GET("/readyz", func(c *gin.Context) {
		if services.AppFileService == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"status": "not ready"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"status": "ready"})
	})

	client := configs.ConnectDB(ctx)
	db := client.Database("telegram_storage")

	botTokensStr := os.Getenv("BOT_TOKENS")
	var botTokens []string
	if botTokensStr != "" {
		botTokens = strings.Split(botTokensStr, ",")
		for i := range botTokens {
			botTokens[i] = strings.TrimSpace(botTokens[i])
		}
	} else {
		log.Println("[WARN] BOT_TOKENS not found, falling back to BOT_1_TOKEN, BOT_2_TOKEN, etc.")
		botTokens = []string{
			os.Getenv("BOT_1_TOKEN"),
			os.Getenv("BOT_2_TOKEN"),
			os.Getenv("BOT_3_TOKEN"),
			os.Getenv("BOT_4_TOKEN"),
			os.Getenv("BOT_5_TOKEN"),
			os.Getenv("BOT_6_TOKEN"),
			os.Getenv("BOT_7_TOKEN"),
		}
	}

	botPool, err := bot.NewBotPool(botTokens)
	if err != nil {
		log.Fatalf("Failed to initialize bot pool: %v", err)
	}
	log.Printf("Bot pool initialized with %d bots", len(botPool.GetAllBots()))

	if err := configs.SetupIndexes(db); err != nil {
		log.Printf("[WARN] Failed to setup indexes: %v (continuing anyway)", err)
	}

	services.AppFileService = services.NewFileService(botPool, db)
	log.Println("FileService initialized")

	router.POST("/init", controllers.InitNewUpload)
	router.POST("/upload", controllers.UploadChunk)
	router.POST("/complete", controllers.CompleteUpload)
	router.GET("/files", controllers.ListFiles)
	router.GET("/download/:fileID", controllers.GetFile)

	srv := &http.Server{
		Addr:    ":80",
		Handler: router,
	}

	go func() {
		log.Println("Server starting on :80")
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server failed to start: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("Shutting down server...")

	cancel()

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Printf("Server forced to shutdown: %v", err)
	}

	if err := client.Disconnect(shutdownCtx); err != nil {
		log.Printf("Error disconnecting from MongoDB: %v", err)
	}

	log.Println("Server exited gracefully")
}
