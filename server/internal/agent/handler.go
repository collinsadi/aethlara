package agent

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/collinsadi/aethlara/internal/agent/sources"
	"github.com/collinsadi/aethlara/internal/ai"
	"github.com/collinsadi/aethlara/internal/email"
	"github.com/collinsadi/aethlara/internal/job"
	"github.com/collinsadi/aethlara/internal/logger"
	"github.com/collinsadi/aethlara/internal/middleware"
	"github.com/collinsadi/aethlara/pkg/response"
)

type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

func decode(w http.ResponseWriter, r *http.Request, maxBytes int64, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, maxBytes)
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		response.Error(w, http.StatusBadRequest, response.CodeInvalidInput, "Invalid request body.")
		return false
	}
	return true
}

func userID(w http.ResponseWriter, r *http.Request) (string, bool) {
	id, ok := middleware.UserIDFromContext(r.Context())
	if !ok {
		response.Error(w, http.StatusUnauthorized, response.CodeUnauthorized, "Authentication required.")
	}
	return id, ok
}

func intParam(r *http.Request, key string, def, lo, hi int) int {
	v, err := strconv.Atoi(r.URL.Query().Get(key))
	if err != nil {
		return def
	}
	return clamp(v, lo, hi)
}

// fail maps service errors onto the response envelope.
func (h *Handler) fail(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		response.Error(w, http.StatusNotFound, response.CodeNotFound, "Not found.")
	case errors.Is(err, ErrInvalidInput):
		response.Error(w, http.StatusBadRequest, response.CodeInvalidInput, err.Error())
	case errors.Is(err, ErrRunInProgress):
		response.Error(w, http.StatusConflict, "RUN_IN_PROGRESS", "A run is already in progress.")
	case errors.Is(err, ErrNoResume):
		response.Error(w, http.StatusUnprocessableEntity, "RESUME_REQUIRED", "Upload a resume (and wait for it to finish processing) first.")
	case errors.Is(err, ErrMailboxTaken):
		response.Error(w, http.StatusConflict, "MAILBOX_TAKEN", "That mailbox name is taken. Try another.")
	case errors.Is(err, ErrMailboxOff):
		response.Error(w, http.StatusUnprocessableEntity, "MAILBOX_DISABLED", "Agent mailboxes are not configured on this server (AGENT_MAIL_DOMAIN).")
	case errors.Is(err, ErrNotClaimable):
		response.Error(w, http.StatusConflict, "NOT_CLAIMABLE", "This application is not waiting on the extension.")
	case errors.Is(err, ai.ErrNoAPIKey):
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write(middleware.APIKeyRequiredBody)
	case errors.Is(err, ai.ErrUnsupported):
		response.Error(w, http.StatusUnprocessableEntity, "UNSUPPORTED", "Your AI provider does not support this.")
	case errors.Is(err, job.ErrAIPipelineTimeout):
		response.Error(w, http.StatusGatewayTimeout, "AI_TIMEOUT", "The AI took too long to respond. Please try again.")
	default:
		logger.FromContext(r.Context()).Error("agent handler error",
			"component", "agent", "error", logger.TruncateError(err, 200), "error_type", ai.ClassifyError(err))
		response.Error(w, http.StatusInternalServerError, response.CodeInternalError, "An unexpected error occurred.")
	}
}

// ── Overview / profile ────────────────────────────────────────────────────────

func (h *Handler) Overview(w http.ResponseWriter, r *http.Request) {
	uid, ok := userID(w, r)
	if !ok {
		return
	}
	o, err := h.svc.Overview(r.Context(), uid)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	response.Success(w, http.StatusOK, map[string]any{
		"profile": toProfileDTO(o.Profile, h.svc.cfg.AgentMailDomain),
		"setup": map[string]any{
			"ai_provider":          strPtr(o.Setup.AIProvider),
			"has_ai_key":           o.Setup.HasAIKey,
			"web_search_available": o.Setup.WebSearchAvailable,
			"has_resume":           o.Setup.HasResume,
			"has_preferences":      o.Setup.HasPreferences,
			"mailbox_enabled":      o.Setup.MailboxEnabled,
			"inbound_enabled":      o.Setup.InboundEnabled,
			"extension_connected":  o.Setup.ExtensionConnected,
		},
		"counts": map[string]any{
			"leads":            o.Leads,
			"applications":     o.Applications,
			"unread_important": o.UnreadImportant,
			"submitted_today":  o.SubmittedToday,
		},
		"running_run":   toRunDTO(o.RunningRun),
		"last_run":      toRunDTO(o.LastRun),
		"recent_events": toEventDTOs(o.RecentEvents),
	}, "")
}

func (h *Handler) GetProfile(w http.ResponseWriter, r *http.Request) {
	uid, ok := userID(w, r)
	if !ok {
		return
	}
	p, err := h.svc.EnsureProfile(r.Context(), uid)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	response.Success(w, http.StatusOK, toProfileDTO(p, h.svc.cfg.AgentMailDomain), "")
}

func (h *Handler) UpdateProfile(w http.ResponseWriter, r *http.Request) {
	uid, ok := userID(w, r)
	if !ok {
		return
	}
	var body struct {
		Enabled            *bool               `json:"enabled"`
		ResumeID           *string             `json:"resume_id"`
		MailboxLocalPart   *string             `json:"mailbox_local_part"`
		SearchPrefs        *SearchPrefs        `json:"search_prefs"`
		ApplicationProfile *ApplicationProfile `json:"application_profile"`
		ApplySettings      *ApplySettings      `json:"apply_settings"`
		RunIntervalHours   *int                `json:"run_interval_hours"`
	}
	if !decode(w, r, 256<<10, &body) {
		return
	}
	p, err := h.svc.UpdateProfile(r.Context(), uid, ProfileUpdate{
		Enabled: body.Enabled, ResumeID: body.ResumeID, MailboxLocalPart: body.MailboxLocalPart,
		SearchPrefs: body.SearchPrefs, ApplicationProfile: body.ApplicationProfile,
		ApplySettings: body.ApplySettings, RunIntervalHours: body.RunIntervalHours,
	})
	if err != nil {
		h.fail(w, r, err)
		return
	}
	response.Success(w, http.StatusOK, toProfileDTO(p, h.svc.cfg.AgentMailDomain), "Autopilot settings saved.")
}

func (h *Handler) Sources(w http.ResponseWriter, r *http.Request) {
	response.Success(w, http.StatusOK, map[string]any{
		"sources":           sources.Catalog(),
		"starter_watchlist": sources.StarterWatchlist(),
	}, "")
}

// ── Runs / events ─────────────────────────────────────────────────────────────

func (h *Handler) StartRun(w http.ResponseWriter, r *http.Request) {
	uid, ok := userID(w, r)
	if !ok {
		return
	}
	run, err := h.svc.StartManualRun(r.Context(), uid)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	response.Success(w, http.StatusAccepted, toRunDTO(run), "Run started.")
}

func (h *Handler) ListRuns(w http.ResponseWriter, r *http.Request) {
	uid, ok := userID(w, r)
	if !ok {
		return
	}
	runs, err := h.svc.ListRuns(r.Context(), uid, intParam(r, "limit", 20, 1, 100))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	out := make([]*runDTO, 0, len(runs))
	for i := range runs {
		out = append(out, toRunDTO(&runs[i]))
	}
	response.Success(w, http.StatusOK, out, "")
}

func (h *Handler) GetRun(w http.ResponseWriter, r *http.Request) {
	uid, ok := userID(w, r)
	if !ok {
		return
	}
	run, err := h.svc.GetRun(r.Context(), uid, chi.URLParam(r, "id"))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	response.Success(w, http.StatusOK, toRunDTO(run), "")
}

func (h *Handler) ListEvents(w http.ResponseWriter, r *http.Request) {
	uid, ok := userID(w, r)
	if !ok {
		return
	}
	before, _ := strconv.ParseInt(r.URL.Query().Get("before"), 10, 64)
	evs, err := h.svc.ListEvents(r.Context(), uid, before, intParam(r, "limit", 30, 1, 100))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	response.Success(w, http.StatusOK, toEventDTOs(evs), "")
}

// ── Leads ─────────────────────────────────────────────────────────────────────

func (h *Handler) ListLeads(w http.ResponseWriter, r *http.Request) {
	uid, ok := userID(w, r)
	if !ok {
		return
	}
	qv := r.URL.Query()
	q := LeadQuery{
		Source:   qv.Get("source"),
		Search:   clipText(qv.Get("search"), 200),
		Sort:     qv.Get("sort"),
		Page:     intParam(r, "page", 1, 1, 10000),
		PageSize: intParam(r, "page_size", 20, 1, 100),
	}
	valid := map[string]bool{LeadNew: true, LeadApproved: true, LeadDismissed: true, LeadApplying: true,
		LeadApplied: true, LeadFailed: true, LeadExpired: true}
	for _, s := range strings.Split(qv.Get("status"), ",") {
		if s = strings.TrimSpace(s); valid[s] {
			q.Statuses = append(q.Statuses, s)
		}
	}
	if v, err := strconv.Atoi(qv.Get("min_score")); err == nil {
		v = clamp(v, 0, 100)
		q.MinScore = &v
	}
	if v := qv.Get("remote"); v == "true" || v == "false" {
		b := v == "true"
		q.Remote = &b
	}
	leads, total, err := h.svc.ListLeads(r.Context(), uid, q)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	items := make([]leadDTO, 0, len(leads))
	for i := range leads {
		items = append(items, toLeadDTO(&leads[i], false))
	}
	pages := (total + q.PageSize - 1) / q.PageSize
	response.Success(w, http.StatusOK, map[string]any{
		"items": items,
		"pagination": map[string]any{
			"page": q.Page, "page_size": q.PageSize, "total_items": total, "total_pages": max(pages, 1),
			"has_next": q.Page < pages, "has_prev": q.Page > 1,
		},
	}, "")
}

func (h *Handler) GetLead(w http.ResponseWriter, r *http.Request) {
	uid, ok := userID(w, r)
	if !ok {
		return
	}
	lead, app, err := h.svc.GetLead(r.Context(), uid, chi.URLParam(r, "id"))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	var appDTO *applicationDTO
	if app != nil {
		d := toApplicationDTO(app, true)
		appDTO = &d
	}
	response.Success(w, http.StatusOK, map[string]any{"lead": toLeadDTO(lead, true), "application": appDTO}, "")
}

func (h *Handler) DecideLead(w http.ResponseWriter, r *http.Request) {
	uid, ok := userID(w, r)
	if !ok {
		return
	}
	var body struct {
		Decision string `json:"decision"`
	}
	if !decode(w, r, 4<<10, &body) {
		return
	}
	lead, app, err := h.svc.DecideLead(r.Context(), uid, chi.URLParam(r, "id"), body.Decision)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	var appDTO *applicationDTO
	if app != nil {
		d := toApplicationDTO(app, false)
		appDTO = &d
	}
	response.Success(w, http.StatusOK, map[string]any{"lead": toLeadDTO(lead, false), "application": appDTO}, "")
}

func (h *Handler) DecideLeads(w http.ResponseWriter, r *http.Request) {
	uid, ok := userID(w, r)
	if !ok {
		return
	}
	var body struct {
		IDs      []string `json:"ids"`
		Decision string   `json:"decision"`
	}
	if !decode(w, r, 64<<10, &body) {
		return
	}
	if len(body.IDs) == 0 || len(body.IDs) > 100 {
		response.Error(w, http.StatusBadRequest, response.CodeInvalidInput, "ids must contain 1-100 lead ids.")
		return
	}
	results := make([]map[string]any, 0, len(body.IDs))
	for _, id := range body.IDs {
		_, _, err := h.svc.DecideLead(r.Context(), uid, id, body.Decision)
		entry := map[string]any{"id": id, "ok": err == nil}
		if err != nil {
			entry["error"] = clipText(err.Error(), 200)
		}
		results = append(results, entry)
	}
	response.Success(w, http.StatusOK, map[string]any{"results": results}, "")
}

func (h *Handler) AddLead(w http.ResponseWriter, r *http.Request) {
	uid, ok := userID(w, r)
	if !ok {
		return
	}
	var body struct {
		URL      string `json:"url"`
		PageText string `json:"page_text"`
		Approve  bool   `json:"approve"`
		Source   string `json:"source"`
	}
	if !decode(w, r, 2<<20, &body) {
		return
	}
	lead, app, err := h.svc.AddLead(r.Context(), uid, AddLeadRequest{
		URL: strings.TrimSpace(body.URL), PageText: body.PageText, Approve: body.Approve, Source: body.Source,
	})
	if err != nil {
		h.fail(w, r, err)
		return
	}
	var appDTO *applicationDTO
	if app != nil {
		d := toApplicationDTO(app, false)
		appDTO = &d
	}
	response.Success(w, http.StatusCreated, map[string]any{"lead": toLeadDTO(lead, false), "application": appDTO}, "Job added.")
}

// ── Applications ──────────────────────────────────────────────────────────────

func (h *Handler) ListApplications(w http.ResponseWriter, r *http.Request) {
	uid, ok := userID(w, r)
	if !ok {
		return
	}
	valid := map[string]bool{AppQueued: true, AppPreparing: true, AppReady: true, AppInProgress: true,
		AppNeedsInput: true, AppSubmitted: true, AppFailed: true, AppCancelled: true}
	var statuses []string
	for _, s := range strings.Split(r.URL.Query().Get("status"), ",") {
		if s = strings.TrimSpace(s); valid[s] {
			statuses = append(statuses, s)
		}
	}
	page, pageSize := intParam(r, "page", 1, 1, 10000), intParam(r, "page_size", 30, 1, 100)
	apps, total, err := h.svc.ListApplications(r.Context(), uid, statuses, page, pageSize)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	items := make([]applicationDTO, 0, len(apps))
	for i := range apps {
		items = append(items, toApplicationDTO(&apps[i], false))
	}
	pages := (total + pageSize - 1) / pageSize
	response.Success(w, http.StatusOK, map[string]any{
		"items": items,
		"pagination": map[string]any{
			"page": page, "page_size": pageSize, "total_items": total, "total_pages": max(pages, 1),
			"has_next": page < pages, "has_prev": page > 1,
		},
	}, "")
}

func (h *Handler) GetApplication(w http.ResponseWriter, r *http.Request) {
	uid, ok := userID(w, r)
	if !ok {
		return
	}
	app, err := h.svc.GetApplication(r.Context(), uid, chi.URLParam(r, "id"))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	response.Success(w, http.StatusOK, toApplicationDTO(app, true), "")
}

func (h *Handler) ClaimApplication(w http.ResponseWriter, r *http.Request) {
	uid, ok := userID(w, r)
	if !ok {
		return
	}
	pkt, err := h.svc.ClaimNext(r.Context(), uid)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	if pkt == nil {
		response.Success(w, http.StatusOK, nil, "Nothing to apply to right now.")
		return
	}
	response.Success(w, http.StatusOK, toPacketDTO(pkt), "")
}

func (h *Handler) GetPacket(w http.ResponseWriter, r *http.Request) {
	uid, ok := userID(w, r)
	if !ok {
		return
	}
	pkt, err := h.svc.PacketFor(r.Context(), uid, chi.URLParam(r, "id"))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	response.Success(w, http.StatusOK, toPacketDTO(pkt), "")
}

func (h *Handler) DownloadResume(w http.ResponseWriter, r *http.Request) {
	uid, ok := userID(w, r)
	if !ok {
		return
	}
	data, name, contentType, err := h.svc.ResumeForApplication(r.Context(), uid, chi.URLParam(r, "id"))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeFile(w, data, name, contentType)
}

func (h *Handler) DownloadCoverLetter(w http.ResponseWriter, r *http.Request) {
	uid, ok := userID(w, r)
	if !ok {
		return
	}
	data, err := h.svc.CoverLetterPDF(r.Context(), uid, chi.URLParam(r, "id"))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeFile(w, data, "Cover_Letter.pdf", "application/pdf")
}

func writeFile(w http.ResponseWriter, data []byte, name, contentType string) {
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	safe := strings.Map(func(r rune) rune {
		if r == '"' || r == '\\' || r < 32 || r > 126 {
			return '_'
		}
		return r
	}, name)
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Disposition", `attachment; filename="`+safe+`"`)
	w.Header().Set("X-File-Name", safe)
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Length", strconv.Itoa(len(data)))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

func (h *Handler) FillApplication(w http.ResponseWriter, r *http.Request) {
	uid, ok := userID(w, r)
	if !ok {
		return
	}
	var body struct {
		PageURL string      `json:"page_url"`
		Fields  []FormField `json:"fields"`
	}
	if !decode(w, r, 1<<20, &body) {
		return
	}
	res, err := h.svc.FillFields(r.Context(), uid, chi.URLParam(r, "id"), body.PageURL, body.Fields)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	response.Success(w, http.StatusOK, res, "")
}

func (h *Handler) ReportResult(w http.ResponseWriter, r *http.Request) {
	uid, ok := userID(w, r)
	if !ok {
		return
	}
	var body struct {
		Status    string     `json:"status"`
		Reason    string     `json:"reason"`
		Message   string     `json:"message"`
		Questions []Question `json:"questions"`
		PageURL   string     `json:"page_url"`
		FinalURL  string     `json:"final_url"`
		Filled    int        `json:"filled"`
	}
	if !decode(w, r, 256<<10, &body) {
		return
	}
	app, err := h.svc.ReportResult(r.Context(), uid, chi.URLParam(r, "id"), ResultReport{
		Status: body.Status, Reason: body.Reason, Message: body.Message, Questions: body.Questions,
		PageURL: body.PageURL, FinalURL: body.FinalURL, Filled: body.Filled,
	})
	if err != nil {
		h.fail(w, r, err)
		return
	}
	response.Success(w, http.StatusOK, toApplicationDTO(app, false), "")
}

func (h *Handler) SaveApplicationAnswers(w http.ResponseWriter, r *http.Request) {
	uid, ok := userID(w, r)
	if !ok {
		return
	}
	var body struct {
		Answers []QA `json:"answers"`
	}
	if !decode(w, r, 256<<10, &body) {
		return
	}
	app, err := h.svc.SaveAnswers(r.Context(), uid, chi.URLParam(r, "id"), body.Answers)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	response.Success(w, http.StatusOK, toApplicationDTO(app, false), "Answers saved. The agent will retry this application.")
}

func (h *Handler) RetryApplication(w http.ResponseWriter, r *http.Request) {
	uid, ok := userID(w, r)
	if !ok {
		return
	}
	app, err := h.svc.RetryApplication(r.Context(), uid, chi.URLParam(r, "id"))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	response.Success(w, http.StatusOK, toApplicationDTO(app, false), "")
}

func (h *Handler) CancelApplication(w http.ResponseWriter, r *http.Request) {
	uid, ok := userID(w, r)
	if !ok {
		return
	}
	app, err := h.svc.CancelApplication(r.Context(), uid, chi.URLParam(r, "id"))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	response.Success(w, http.StatusOK, toApplicationDTO(app, false), "")
}

// ── Inbox ─────────────────────────────────────────────────────────────────────

func (h *Handler) ListInbox(w http.ResponseWriter, r *http.Request) {
	uid, ok := userID(w, r)
	if !ok {
		return
	}
	page, pageSize := intParam(r, "page", 1, 1, 10000), intParam(r, "page_size", 30, 1, 100)
	msgs, total, err := h.svc.ListInbox(r.Context(), uid, clipText(r.URL.Query().Get("category"), 30), page, pageSize)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	items := make([]messageDTO, 0, len(msgs))
	for i := range msgs {
		items = append(items, toMessageDTO(&msgs[i], false))
	}
	pages := (total + pageSize - 1) / pageSize
	response.Success(w, http.StatusOK, map[string]any{
		"items": items,
		"pagination": map[string]any{
			"page": page, "page_size": pageSize, "total_items": total, "total_pages": max(pages, 1),
			"has_next": page < pages, "has_prev": page > 1,
		},
	}, "")
}

func (h *Handler) GetMessage(w http.ResponseWriter, r *http.Request) {
	uid, ok := userID(w, r)
	if !ok {
		return
	}
	m, err := h.svc.GetMessage(r.Context(), uid, chi.URLParam(r, "id"))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	response.Success(w, http.StatusOK, toMessageDTO(m, true), "")
}

func (h *Handler) MarkMessageRead(w http.ResponseWriter, r *http.Request) {
	uid, ok := userID(w, r)
	if !ok {
		return
	}
	var body struct {
		Read *bool `json:"read"`
	}
	if !decode(w, r, 4<<10, &body) {
		return
	}
	read := body.Read == nil || *body.Read
	if err := h.svc.MarkRead(r.Context(), uid, chi.URLParam(r, "id"), read); err != nil {
		h.fail(w, r, err)
		return
	}
	response.Success(w, http.StatusOK, map[string]any{"read": read}, "")
}

func (h *Handler) Verifications(w http.ResponseWriter, r *http.Request) {
	uid, ok := userID(w, r)
	if !ok {
		return
	}
	since := time.Now().Add(-15 * time.Minute)
	if v := r.URL.Query().Get("since"); v != "" {
		if t, err := time.Parse(time.RFC3339, v); err == nil && t.After(time.Now().Add(-24*time.Hour)) {
			since = t
		}
	}
	vs, err := h.svc.RecentVerifications(r.Context(), uid, since)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	out := make([]verificationDTO, 0, len(vs))
	for _, v := range vs {
		out = append(out, verificationDTO{MessageID: v.MessageID, From: v.From, Subject: v.Subject,
			Code: v.Code, Link: v.Link, ReceivedAt: v.ReceivedAt})
	}
	response.Success(w, http.StatusOK, out, "")
}

// ── Answers ───────────────────────────────────────────────────────────────────

func (h *Handler) ListAnswers(w http.ResponseWriter, r *http.Request) {
	uid, ok := userID(w, r)
	if !ok {
		return
	}
	as, err := h.svc.ListAnswers(r.Context(), uid)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	response.Success(w, http.StatusOK, toAnswerDTOs(as), "")
}

func (h *Handler) UpsertAnswer(w http.ResponseWriter, r *http.Request) {
	uid, ok := userID(w, r)
	if !ok {
		return
	}
	var body QA
	if !decode(w, r, 16<<10, &body) {
		return
	}
	a, err := h.svc.UpsertAnswer(r.Context(), uid, body.Question, body.Answer)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	response.Success(w, http.StatusOK, toAnswerDTOs([]Answer{*a})[0], "")
}

func (h *Handler) DeleteAnswer(w http.ResponseWriter, r *http.Request) {
	uid, ok := userID(w, r)
	if !ok {
		return
	}
	if err := h.svc.DeleteAnswer(r.Context(), uid, chi.URLParam(r, "id")); err != nil {
		h.fail(w, r, err)
		return
	}
	response.Success(w, http.StatusOK, nil, "Answer deleted.")
}

// ── Resend webhook (public) ───────────────────────────────────────────────────

func (h *Handler) ResendWebhook(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<20))
	if err != nil {
		response.Error(w, http.StatusBadRequest, response.CodeInvalidInput, "Invalid body.")
		return
	}
	err = h.svc.HandleResendWebhook(r.Context(), r.Header, body)
	switch {
	case err == nil:
		response.Success(w, http.StatusOK, map[string]any{"received": true}, "")
	case errors.Is(err, ErrWebhookDisable):
		response.Error(w, http.StatusServiceUnavailable, "INBOUND_DISABLED", "Inbound mail is not configured.")
	case errors.Is(err, email.ErrWebhookSignature):
		response.Error(w, http.StatusUnauthorized, "INVALID_SIGNATURE", "Webhook signature verification failed.")
	case errors.Is(err, ErrInvalidInput):
		response.Error(w, http.StatusBadRequest, response.CodeInvalidInput, "Malformed webhook.")
	default:
		logger.FromContext(r.Context()).Error("resend webhook processing failed",
			"component", "agent", "error", logger.TruncateError(err, 200))
		response.Error(w, http.StatusInternalServerError, response.CodeInternalError, "Webhook processing failed.")
	}
}
