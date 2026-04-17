package storage

import (
	"bytes"
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

type R2Client struct {
	s3     *s3.Client
	pre    *s3.PresignClient
	bucket string
	expiry time.Duration
}

func NewR2Client(accountID, accessKeyID, secretAccessKey, bucket string, presignExpiry time.Duration) (*R2Client, error) {
	endpoint := fmt.Sprintf("https://%s.r2.cloudflarestorage.com", accountID)

	cfg, err := awsconfig.LoadDefaultConfig(context.Background(),
		awsconfig.WithRegion("auto"),
		awsconfig.WithCredentialsProvider(
			credentials.NewStaticCredentialsProvider(accessKeyID, secretAccessKey, ""),
		),
	)
	if err != nil {
		return nil, fmt.Errorf("load r2 config: %w", err)
	}

	s3Client := s3.NewFromConfig(cfg, func(o *s3.Options) {
		o.BaseEndpoint = aws.String(endpoint)
		// R2 requires path-style addressing
		o.UsePathStyle = true
	})

	return &R2Client{
		s3:     s3Client,
		pre:    s3.NewPresignClient(s3Client),
		bucket: bucket,
		expiry: presignExpiry,
	}, nil
}

// Upload stores an object in R2. contentType should be the MIME type of the file.
func (c *R2Client) Upload(ctx context.Context, key string, data []byte, contentType string) error {
	_, err := c.s3.PutObject(ctx, &s3.PutObjectInput{
		Bucket:      aws.String(c.bucket),
		Key:         aws.String(key),
		Body:        bytes.NewReader(data),
		ContentType: aws.String(contentType),
	})
	if err != nil {
		return fmt.Errorf("r2 upload %q: %w", key, err)
	}
	return nil
}

// PresignURL generates a short-lived GET URL for the given object key.
func (c *R2Client) PresignURL(ctx context.Context, key string) (url string, expiresAt time.Time, err error) {
	// inline so browsers embed the file in an iframe; attachment would force download-only in many viewers.
	req, err := c.pre.PresignGetObject(ctx, &s3.GetObjectInput{
		Bucket:                     aws.String(c.bucket),
		Key:                        aws.String(key),
		ResponseContentDisposition: aws.String("inline"),
	}, func(o *s3.PresignOptions) {
		o.Expires = c.expiry
	})
	if err != nil {
		return "", time.Time{}, fmt.Errorf("presign %q: %w", key, err)
	}

	expiresAt = time.Now().Add(c.expiry)

	slog.Info("presigned url generated",
		"key", key,
		"expires_at", expiresAt,
	)

	return req.URL, expiresAt, nil
}

// Delete removes an object from R2. Used by cleanup jobs — not called on soft delete.
func (c *R2Client) Delete(ctx context.Context, key string) error {
	_, err := c.s3.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: aws.String(c.bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		return fmt.Errorf("r2 delete %q: %w", key, err)
	}
	return nil
}
