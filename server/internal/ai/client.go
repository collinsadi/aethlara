// Package ai is the ONLY place in the codebase that talks to AI providers
// (OpenRouter and Anthropic).
//
// Architectural invariant (non-negotiable):
//   - There is NO platform-level API key for any provider.
//   - Every call resolves a credential (provider + key + model preferences)
//     per request from the user's encrypted record via the injected
//     CredentialProvider.
//   - Decrypted keys live only inside a single call's stack frame and are
//     dropped before the function returns.
//   - If a user has no valid key for their active provider, ErrNoAPIKey is
//     returned and callers MUST propagate it as 403 API_KEY_REQUIRED.
//
// Observability invariant:
//   - We log only structured, non-sensitive fields (provider, model,
//     prompt_version, ai_stage, token counts, latency, classified error
//     type, truncated error message).
//   - We never log: user prompt content, model response content, API keys,
//     resume text, job text, email, or any other PII.
package ai

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/collinsadi/aethlara/internal/logger"
	"github.com/collinsadi/aethlara/pkg/sanitise"
)

const (
	errMessageMaxRunes = 200
	logComponent       = "ai"

	defaultSmartMaxTokens = 16000
	defaultFastMaxTokens  = 8000
)

// Provider identifies an upstream AI provider.
type Provider string

const (
	ProviderOpenRouter Provider = "openrouter"
	ProviderAnthropic  Provider = "anthropic"
)

// ParseProvider validates a provider name coming from user input or the DB.
func ParseProvider(s string) (Provider, bool) {
	switch Provider(strings.ToLower(strings.TrimSpace(s))) {
	case ProviderOpenRouter:
		return ProviderOpenRouter, true
	case ProviderAnthropic:
		return ProviderAnthropic, true
	default:
		return "", false
	}
}

// Label is the human-readable provider name used in user-facing messages.
func (p Provider) Label() string {
	switch p {
	case ProviderAnthropic:
		return "Anthropic"
	default:
		return "OpenRouter"
	}
}

// Tier selects which of the user's two models handles a call.
//   - TierSmart: tailoring, cover letters, form filling, chat (default).
//   - TierFast:  bulk lead scoring and email triage.
type Tier string

const (
	TierSmart Tier = "smart"
	TierFast  Tier = "fast"
)

// Effort is a provider-neutral hint for how much reasoning a call deserves.
// Anthropic maps it to output_config.effort on models that support it;
// OpenRouter ignores it.
type Effort string

const (
	EffortLow    Effort = "low"
	EffortMedium Effort = "medium"
	EffortHigh   Effort = "high"
)

// Role constants for chat messages.
const (
	RoleSystem    = "system"
	RoleUser      = "user"
	RoleAssistant = "assistant"
)

// Stage labels attached to AI calls for observability. These are the ONLY
// values that should be passed as Request.Stage / ChatRequest.Stage so the
// log schema stays stable and dashboards remain queryable.
const (
	StageJobExtraction    = "job_extraction"
	StageResumeAlignment  = "resume_alignment"
	StageResumeExtraction = "resume_extraction"
	StageChat             = "chat"
	StageAutofill         = "autofill"
	StageKeyValidation    = "key_validation"
	StageLeadScoring      = "lead_scoring"
	StageJobSearch        = "job_search"
	StageCoverLetter      = "cover_letter"
	StageApplicationFill  = "application_fill"
	StageEmailTriage      = "email_triage"
	StageSearchExtraction = "search_extraction"
	StageColdEmail        = "cold_email"
	StagePostingSearch    = "posting_search"
	StageContactSearch    = "contact_search"
)

// Credential is a user's resolved provider configuration for one call.
type Credential struct {
	Provider   Provider
	APIKey     string // plaintext — never log, never persist
	SmartModel string // empty = server default for Provider
	FastModel  string // empty = server default for Provider
}

// CredentialProvider resolves a user's active provider and decrypted key.
// Satisfied by settings.Service. Implementations MUST return ErrNoAPIKey when
// no usable key exists — the Client relies on this for uniform handling.
type CredentialProvider interface {
	GetCredential(ctx context.Context, userID string) (*Credential, error)
}

// Config holds server-level provider settings. It carries NO API keys.
type Config struct {
	OpenRouterBaseURL   string
	OpenRouterModel     string
	OpenRouterFastModel string
	AnthropicBaseURL    string
	AnthropicModel      string
	AnthropicFastModel  string
}

// Message is a single turn in a conversation sent to the model.
type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// Request is a single-turn convenience request (one system prompt + one user
// message). Use ChatRequest for multi-turn conversations.
type Request struct {
	UserID        string // REQUIRED — enforces per-user key resolution
	SystemPrompt  string
	UserMessage   string
	PromptVersion string
	// Stage is an observability label (see the Stage* constants). Not sent
	// to the provider.
	Stage string
	// Tier picks the user's smart (default) or fast model.
	Tier Tier
	// Effort overrides the tier's default reasoning effort.
	Effort Effort
	// MaxTokens overrides the tier default.
	MaxTokens int
	// JSON marks the response as a JSON document: code fences and stray
	// prose around the JSON value are stripped before it is returned.
	JSON bool
	// JSONSchema, when set, constrains the output to this schema on
	// providers/models that support structured outputs. Implies JSON.
	JSONSchema map[string]any
	// CacheSystem marks the system prompt cacheable (Anthropic prompt
	// caching). Use it when the same system prompt is sent many times within
	// a few minutes, e.g. scoring a batch of leads against one resume.
	CacheSystem bool
	// Temperature is only forwarded to OpenRouter models that still accept
	// sampling parameters (never to Anthropic models).
	Temperature *float64
}

// ChatRequest is the full multi-turn form used by the chat module.
type ChatRequest struct {
	UserID        string    // REQUIRED — enforces per-user key resolution
	SystemPrompt  string    // injected as the system prompt
	Messages      []Message // conversation history, oldest first
	PromptVersion string
	Stage         string
	Tier          Tier
	Effort        Effort
	MaxTokens     int
	Temperature   *float64
}

// WebSearchRequest runs a model turn with the provider's server-side web
// search tool. Only Anthropic supports it; other providers return
// ErrUnsupported.
type WebSearchRequest struct {
	UserID         string
	SystemPrompt   string
	UserMessage    string
	PromptVersion  string
	Stage          string
	MaxSearches    int
	BlockedDomains []string
	MaxTokens      int
}

// Response carries the model output plus instrumentation.
type Response struct {
	Content         string
	TokensIn        int
	TokensOut       int
	CacheReadTokens int
	LatencyMS       int64
	Model           string
	Provider        Provider
	FinishReason    string
}

// call is the provider-neutral request handed to a backend.
type call struct {
	apiKey         string
	model          string
	system         string
	messages       []Message
	maxTokens      int
	effort         Effort
	schema         map[string]any
	cacheSystem    bool
	temperature    *float64
	maxSearches    int
	blockedDomains []string
	log            *slog.Logger
}

type backend interface {
	complete(ctx context.Context, c call) (*Response, error)
	webSearch(ctx context.Context, c call) (*Response, error)
	validateKey(ctx context.Context, apiKey, model string) error
}

// Client executes AI calls on behalf of a user. It holds NO API keys —
// every call resolves one per user.
type Client struct {
	creds    CredentialProvider
	cfg      Config
	backends map[Provider]backend
}

// NewClient constructs a Client. Note: there is deliberately no fallback key
// parameter — we refuse to allow one at construction time.
func NewClient(cfg Config) *Client {
	httpClient := &http.Client{Timeout: 5 * time.Minute}
	return &Client{
		cfg: cfg,
		backends: map[Provider]backend{
			ProviderOpenRouter: newOpenRouterBackend(cfg.OpenRouterBaseURL),
			ProviderAnthropic:  newAnthropicBackend(cfg.AnthropicBaseURL, httpClient),
		},
	}
}

// SetCredentialProvider injects the per-user credential provider after
// construction. Called once from main after the settings service is wired.
func (c *Client) SetCredentialProvider(p CredentialProvider) {
	c.creds = p
}

// DefaultModels returns the server's default smart and fast models for p.
func (c *Client) DefaultModels(p Provider) (smart, fast string) {
	if p == ProviderAnthropic {
		return c.cfg.AnthropicModel, c.cfg.AnthropicFastModel
	}
	return c.cfg.OpenRouterModel, c.cfg.OpenRouterFastModel
}

// ActiveProvider reports which provider the user's calls go through. Returns
// ErrNoAPIKey when the user has no usable key.
func (c *Client) ActiveProvider(ctx context.Context, userID string) (Provider, error) {
	cred, err := c.resolve(ctx, userID)
	if err != nil {
		return "", err
	}
	p := cred.Provider
	cred.APIKey = ""
	return p, nil
}

// SupportsWebSearch reports whether the user's active provider can run
// server-side web search (Anthropic only).
func (c *Client) SupportsWebSearch(ctx context.Context, userID string) bool {
	p, err := c.ActiveProvider(ctx, userID)
	return err == nil && p == ProviderAnthropic
}

// Complete runs a single-turn completion for the given user.
func (c *Client) Complete(ctx context.Context, req Request) (*Response, error) {
	if req.UserID == "" {
		return nil, ErrNoAPIKey
	}
	cred, err := c.resolve(ctx, req.UserID)
	if err != nil {
		return nil, err
	}
	model := c.modelFor(cred, req.Tier)
	cl := call{
		apiKey:      cred.APIKey,
		model:       model,
		system:      req.SystemPrompt,
		messages:    []Message{{Role: RoleUser, Content: req.UserMessage}},
		maxTokens:   pickMaxTokens(req.MaxTokens, req.Tier),
		effort:      pickEffort(req.Effort, req.Tier),
		schema:      req.JSONSchema,
		cacheSystem: req.CacheSystem,
		temperature: req.Temperature,
	}
	cred.APIKey = ""

	resp, err := c.run(ctx, cred.Provider, "Complete", req.PromptVersion, req.Stage, cl, false)
	if err != nil {
		return nil, err
	}
	if req.JSON || req.JSONSchema != nil {
		if cleaned, ok := ExtractJSON(resp.Content); ok {
			resp.Content = cleaned
		}
	}
	return resp, nil
}

// Chat runs a multi-turn completion for the given user.
func (c *Client) Chat(ctx context.Context, req ChatRequest) (*Response, error) {
	if req.UserID == "" {
		return nil, ErrNoAPIKey
	}
	cred, err := c.resolve(ctx, req.UserID)
	if err != nil {
		return nil, err
	}
	cl := call{
		apiKey:      cred.APIKey,
		model:       c.modelFor(cred, req.Tier),
		system:      req.SystemPrompt,
		messages:    req.Messages,
		maxTokens:   pickMaxTokens(req.MaxTokens, req.Tier),
		effort:      pickEffort(req.Effort, req.Tier),
		temperature: req.Temperature,
	}
	cred.APIKey = ""
	return c.run(ctx, cred.Provider, "Chat", req.PromptVersion, req.Stage, cl, false)
}

// WebSearch runs one model turn with server-side web search. Returns
// ErrUnsupported when the user's active provider has no web search tool.
func (c *Client) WebSearch(ctx context.Context, req WebSearchRequest) (*Response, error) {
	if req.UserID == "" {
		return nil, ErrNoAPIKey
	}
	cred, err := c.resolve(ctx, req.UserID)
	if err != nil {
		return nil, err
	}
	if cred.Provider != ProviderAnthropic {
		cred.APIKey = ""
		return nil, ErrUnsupported
	}
	maxSearches := req.MaxSearches
	if maxSearches <= 0 {
		maxSearches = 5
	}
	cl := call{
		apiKey:         cred.APIKey,
		model:          c.modelFor(cred, TierSmart),
		system:         req.SystemPrompt,
		messages:       []Message{{Role: RoleUser, Content: req.UserMessage}},
		maxTokens:      pickMaxTokens(req.MaxTokens, TierSmart),
		effort:         EffortMedium,
		maxSearches:    maxSearches,
		blockedDomains: req.BlockedDomains,
	}
	cred.APIKey = ""
	return c.run(ctx, cred.Provider, "WebSearch", req.PromptVersion, req.Stage, cl, true)
}

// ValidateKey checks that plainKey is accepted by provider. Used ONLY by the
// settings service before a key is stored; the key is never persisted here.
func (c *Client) ValidateKey(ctx context.Context, provider Provider, plainKey string) error {
	b, ok := c.backends[provider]
	if !ok {
		return fmt.Errorf("unknown provider %q", provider)
	}
	_, fast := c.DefaultModels(provider)
	log := logger.FromContext(ctx).With(
		"component", logComponent,
		"operation", "ValidateKey",
		"provider", string(provider),
		"ai_stage", StageKeyValidation,
	)
	start := time.Now()
	err := b.validateKey(ctx, plainKey, fast)
	if err != nil {
		log.Warn("ai key validation failed",
			"error", logger.TruncateError(err, errMessageMaxRunes),
			"error_type", ClassifyError(err),
			"latency_ms", time.Since(start).Milliseconds(),
		)
		return err
	}
	log.Info("ai key validation completed", "latency_ms", time.Since(start).Milliseconds())
	return nil
}

func (c *Client) run(ctx context.Context, provider Provider, op, promptVersion, stage string, cl call, webSearch bool) (*Response, error) {
	b, ok := c.backends[provider]
	if !ok {
		return nil, fmt.Errorf("unknown provider %q", provider)
	}

	log := logger.FromContext(ctx).With(
		"component", logComponent,
		"operation", op,
		"provider", string(provider),
		"model", cl.model,
		"prompt_version", promptVersion,
		"ai_stage", stage,
	)
	cl.log = log
	log.Debug("ai request started")

	start := time.Now()
	var (
		resp *Response
		err  error
	)
	if webSearch {
		resp, err = b.webSearch(ctx, cl)
	} else {
		resp, err = b.complete(ctx, cl)
	}
	cl.apiKey = ""
	latency := time.Since(start).Milliseconds()

	if err != nil {
		log.Error("ai request failed",
			"error", logger.TruncateError(err, errMessageMaxRunes),
			"error_type", ClassifyError(err),
			"latency_ms", latency,
		)
		return nil, err
	}
	if strings.TrimSpace(resp.Content) == "" {
		log.Error("ai request failed",
			"error", "empty response",
			"error_type", "empty_response",
			"latency_ms", latency,
		)
		return nil, fmt.Errorf("empty response from AI model")
	}

	log.LogAttrs(ctx, slog.LevelInfo, "ai request completed",
		slog.Int("tokens_in", resp.TokensIn),
		slog.Int("tokens_out", resp.TokensOut),
		slog.Int("cache_read_tokens", resp.CacheReadTokens),
		slog.String("finish_reason", resp.FinishReason),
		slog.Int64("latency_ms", latency),
	)

	resp.Content = sanitise.ResumeText(resp.Content)
	resp.LatencyMS = latency
	resp.Provider = provider
	if resp.Model == "" {
		resp.Model = cl.model
	}
	return resp, nil
}

func (c *Client) resolve(ctx context.Context, userID string) (*Credential, error) {
	if c.creds == nil {
		// Defence-in-depth: misconfiguration should never leak into production.
		return nil, ErrNoAPIKey
	}
	cred, err := c.creds.GetCredential(ctx, userID)
	if err != nil {
		// Never log decrypted material here.
		if errors.Is(err, ErrNoAPIKey) {
			return nil, ErrNoAPIKey
		}
		return nil, fmt.Errorf("resolve credential: %w", err)
	}
	if cred == nil || cred.APIKey == "" {
		return nil, ErrNoAPIKey
	}
	if _, ok := c.backends[cred.Provider]; !ok {
		cred.APIKey = ""
		return nil, ErrNoAPIKey
	}
	return cred, nil
}

func (c *Client) modelFor(cred *Credential, tier Tier) string {
	smart, fast := c.DefaultModels(cred.Provider)
	if tier == TierFast {
		if cred.FastModel != "" {
			return cred.FastModel
		}
		return fast
	}
	if cred.SmartModel != "" {
		return cred.SmartModel
	}
	return smart
}

func pickMaxTokens(n int, tier Tier) int {
	if n > 0 {
		return n
	}
	if tier == TierFast {
		return defaultFastMaxTokens
	}
	return defaultSmartMaxTokens
}

func pickEffort(e Effort, tier Tier) Effort {
	if e != "" {
		return e
	}
	if tier == TierFast {
		return EffortLow
	}
	return EffortMedium
}
