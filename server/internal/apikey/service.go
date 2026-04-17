// Package apikey is the single place in the codebase responsible for
// encrypting and decrypting user API keys.  Nothing outside this package
// ever sees a plaintext key except internal/ai/openrouter.go, which calls
// Decrypt exactly once per request.
package apikey

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"io"
	"strings"
	"unicode"
)

// Service handles AES-256-GCM encrypt/decrypt and key-format validation.
type Service struct {
	key        []byte // 32 bytes
	previewLen int
}

// New creates a Service. key must be exactly 32 bytes.
func New(key []byte, previewLen int) (*Service, error) {
	if len(key) != 32 {
		return nil, fmt.Errorf("encryption key must be 32 bytes, got %d", len(key))
	}
	if previewLen <= 0 {
		previewLen = 8
	}
	cp := make([]byte, 32)
	copy(cp, key)
	return &Service{key: cp, previewLen: previewLen}, nil
}

// Encrypt encrypts plaintext with AES-256-GCM using a fresh random nonce.
// Returns base64(nonce || ciphertext).
func (s *Service) Encrypt(plaintext string) (string, error) {
	block, err := aes.NewCipher(s.key)
	if err != nil {
		return "", fmt.Errorf("create cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("create gcm: %w", err)
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", fmt.Errorf("generate nonce: %w", err)
	}

	ciphertext := gcm.Seal(nonce, nonce, []byte(plaintext), nil)
	return base64.StdEncoding.EncodeToString(ciphertext), nil
}

// Decrypt reverses Encrypt. Called only from internal/ai/openrouter.go.
func (s *Service) Decrypt(blob string) (string, error) {
	data, err := base64.StdEncoding.DecodeString(blob)
	if err != nil {
		return "", ErrDecrypt
	}

	block, err := aes.NewCipher(s.key)
	if err != nil {
		return "", ErrDecrypt
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", ErrDecrypt
	}

	nonceSize := gcm.NonceSize()
	if len(data) < nonceSize {
		return "", ErrDecrypt
	}
	nonce, ciphertext := data[:nonceSize], data[nonceSize:]

	plaintext, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", ErrDecrypt
	}
	return string(plaintext), nil
}

// ExtractPrefix returns the first previewLen characters of a plaintext key.
func (s *Service) ExtractPrefix(plaintext string) string {
	runes := []rune(plaintext)
	if len(runes) <= s.previewLen {
		return plaintext
	}
	return string(runes[:s.previewLen])
}

// ValidateFormat checks that the key looks like an OpenRouter key.
func (s *Service) ValidateFormat(plaintext string) error {
	if !strings.HasPrefix(plaintext, "sk-or-") {
		return fmt.Errorf("%w: must start with 'sk-or-'", ErrInvalidFormat)
	}
	if len(plaintext) < 20 {
		return fmt.Errorf("%w: too short (minimum 20 characters)", ErrInvalidFormat)
	}
	if len(plaintext) > 200 {
		return fmt.Errorf("%w: too long (maximum 200 characters)", ErrInvalidFormat)
	}
	for _, r := range plaintext {
		if unicode.IsSpace(r) || r == 0 {
			return fmt.Errorf("%w: must not contain whitespace or null bytes", ErrInvalidFormat)
		}
	}
	return nil
}
