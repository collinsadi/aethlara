package apikey

import "errors"

var (
	ErrInvalidFormat = errors.New("invalid API key format")
	ErrDecrypt       = errors.New("failed to decrypt API key")
)
