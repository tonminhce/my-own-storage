package bot

import (
	"net/http"
	"sync/atomic"
	"time"

	tgbotapi "github.com/go-telegram-bot-api/telegram-bot-api/v5"
)

type BotPool struct {
	bots    []*tgbotapi.BotAPI
	current uint64
}

func NewBotPool(tokens []string) (*BotPool, error) {
	var bots []*tgbotapi.BotAPI

	// Custom HTTP Client with long timeout for uploads
	client := &http.Client{
		Timeout: 10 * time.Minute, // Allow slow uploads
		Transport: &http.Transport{
			MaxIdleConns:        100,
			MaxIdleConnsPerHost: 100,
			IdleConnTimeout:     90 * time.Second,
		},
	}

	for _, t := range tokens {
		if t == "" {
			continue
		}
		b, err := tgbotapi.NewBotAPIWithClient(t, tgbotapi.APIEndpoint, client)
		if err != nil {
			return nil, err
		}
		bots = append(bots, b)
	}
	return &BotPool{bots: bots}, nil
}

func (p *BotPool) GetNextBot() *tgbotapi.BotAPI {
	if len(p.bots) == 0 {
		return nil
	}
	idx := atomic.AddUint64(&p.current, 1)
	return p.bots[(idx-1)%uint64(len(p.bots))]
}

func (p *BotPool) GetAllBots() []*tgbotapi.BotAPI {
	return p.bots
}
