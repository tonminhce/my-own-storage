package models

import (
	"time"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

type FileChunk struct {
	Sequence  int    `bson:"sequence" json:"sequence"`
	MessageID int    `bson:"message_id" json:"message_id"`
	FileID    string `bson:"file_id" json:"file_id"`
	BotToken  string `bson:"bot_token" json:"bot_token"`
	Size      int64  `bson:"size" json:"size"`
}

type FileMetadata struct {
	ID        primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	Name      string             `bson:"name" json:"name"`
	Size      int64              `bson:"size" json:"size"`
	MimeType  string             `bson:"mime_type" json:"mime_type"`
	Status    string             `bson:"status" json:"status"`
	Chunks    []FileChunk        `bson:"chunks" json:"chunks"`
	CreatedAt time.Time          `bson:"created_at" json:"created_at"`
	UpdatedAt time.Time          `bson:"updated_at" json:"updated_at"`
}
