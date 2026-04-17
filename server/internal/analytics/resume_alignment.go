package analytics

import (
	"context"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// DashboardData is the full analytics payload for GET /analytics/dashboard.
type DashboardData struct {
	TotalJobsThisMonth     int              `json:"total_jobs_this_month"`
	AverageMatchRate       float64          `json:"average_match_rate"`
	TotalResumes           int              `json:"total_resumes"`
	AppliedJobs            int              `json:"applied_jobs"`
	JobsByStatus           map[string]int   `json:"jobs_by_status"`
	MatchScoreDistribution MatchScoreDist   `json:"match_score_distribution"`
	TopCompanies           []CompanyCount   `json:"top_companies"`
	MonthlyTrend           []MonthlyCount   `json:"monthly_trend"`
	ComputedAt             time.Time        `json:"computed_at"`
}

type MatchScoreDist struct {
	Low    int `json:"low"`
	Medium int `json:"medium"`
	High   int `json:"high"`
}

type CompanyCount struct {
	Company string `json:"company"`
	Count   int    `json:"count"`
}

type MonthlyCount struct {
	Month string `json:"month"`
	Count int    `json:"count"`
}

// Repository executes all analytics queries.
type Repository interface {
	GetDashboard(ctx context.Context, userID string) (*DashboardData, error)
}

type pgxRepository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) Repository {
	return &pgxRepository{db: db}
}

func (r *pgxRepository) GetDashboard(ctx context.Context, userID string) (*DashboardData, error) {
	d := &DashboardData{
		ComputedAt:   time.Now(),
		JobsByStatus: make(map[string]int),
	}

	// Initialise all known statuses to 0 so the response is always complete
	for _, s := range []string{"not_applied", "applied", "interview", "offer", "rejected", "withdrawn"} {
		d.JobsByStatus[s] = 0
	}

	// total_jobs_this_month
	if err := r.db.QueryRow(ctx, `
		SELECT COUNT(*) FROM jobs
		WHERE user_id = $1
		  AND created_at >= date_trunc('month', NOW())
		  AND deleted_at IS NULL`, userID,
	).Scan(&d.TotalJobsThisMonth); err != nil {
		return nil, err
	}

	// average_match_rate
	if err := r.db.QueryRow(ctx, `
		SELECT COALESCE(AVG(match_score)::float8, 0)
		FROM jobs
		WHERE user_id = $1
		  AND alignment_status = 'completed'
		  AND deleted_at IS NULL`, userID,
	).Scan(&d.AverageMatchRate); err != nil {
		return nil, err
	}

	// total_resumes
	if err := r.db.QueryRow(ctx, `
		SELECT COUNT(*) FROM resumes
		WHERE user_id = $1 AND deleted_at IS NULL`, userID,
	).Scan(&d.TotalResumes); err != nil {
		return nil, err
	}

	// applied_jobs (applied + interview + offer)
	if err := r.db.QueryRow(ctx, `
		SELECT COUNT(*) FROM jobs
		WHERE user_id = $1
		  AND status IN ('applied', 'interview', 'offer')
		  AND deleted_at IS NULL`, userID,
	).Scan(&d.AppliedJobs); err != nil {
		return nil, err
	}

	// jobs_by_status
	rows, err := r.db.Query(ctx, `
		SELECT status, COUNT(*) FROM jobs
		WHERE user_id = $1 AND deleted_at IS NULL
		GROUP BY status`, userID,
	)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var st string
		var cnt int
		if err := rows.Scan(&st, &cnt); err != nil {
			rows.Close()
			return nil, err
		}
		d.JobsByStatus[st] = cnt
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// match_score_distribution
	if err := r.db.QueryRow(ctx, `
		SELECT
		  COUNT(*) FILTER (WHERE match_score BETWEEN 1  AND 40)  AS low,
		  COUNT(*) FILTER (WHERE match_score BETWEEN 41 AND 70)  AS medium,
		  COUNT(*) FILTER (WHERE match_score BETWEEN 71 AND 100) AS high
		FROM jobs
		WHERE user_id = $1
		  AND alignment_status = 'completed'
		  AND deleted_at IS NULL`, userID,
	).Scan(&d.MatchScoreDistribution.Low, &d.MatchScoreDistribution.Medium, &d.MatchScoreDistribution.High); err != nil {
		return nil, err
	}

	// top_companies (top 5)
	topRows, err := r.db.Query(ctx, `
		SELECT company, COUNT(*) AS cnt FROM jobs
		WHERE user_id = $1 AND deleted_at IS NULL AND company <> ''
		GROUP BY company
		ORDER BY cnt DESC
		LIMIT 5`, userID,
	)
	if err != nil {
		return nil, err
	}
	for topRows.Next() {
		var cc CompanyCount
		if err := topRows.Scan(&cc.Company, &cc.Count); err != nil {
			topRows.Close()
			return nil, err
		}
		d.TopCompanies = append(d.TopCompanies, cc)
	}
	topRows.Close()
	if err := topRows.Err(); err != nil {
		return nil, err
	}
	if d.TopCompanies == nil {
		d.TopCompanies = []CompanyCount{}
	}

	// monthly_trend (last 6 months)
	trendRows, err := r.db.Query(ctx, `
		SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS month,
		       COUNT(*) AS cnt
		FROM jobs
		WHERE user_id = $1
		  AND deleted_at IS NULL
		  AND created_at >= NOW() - INTERVAL '6 months'
		GROUP BY month
		ORDER BY month DESC`, userID,
	)
	if err != nil {
		return nil, err
	}
	for trendRows.Next() {
		var mc MonthlyCount
		if err := trendRows.Scan(&mc.Month, &mc.Count); err != nil {
			trendRows.Close()
			return nil, err
		}
		d.MonthlyTrend = append(d.MonthlyTrend, mc)
	}
	trendRows.Close()
	if err := trendRows.Err(); err != nil {
		return nil, err
	}
	if d.MonthlyTrend == nil {
		d.MonthlyTrend = []MonthlyCount{}
	}

	return d, nil
}

// ── Service with 5-minute in-memory cache ────────────────────────────────────

type Service interface {
	Dashboard(ctx context.Context, userID string) (*DashboardData, error)
	InvalidateCache(userID string)
}

type cacheEntry struct {
	data       *DashboardData
	computedAt time.Time
}

type service struct {
	repo Repository
	mu   sync.RWMutex
	cache map[string]*cacheEntry
	ttl  time.Duration
}

func NewService(repo Repository) Service {
	return &service{
		repo:  repo,
		cache: make(map[string]*cacheEntry),
		ttl:   5 * time.Minute,
	}
}

func (s *service) Dashboard(ctx context.Context, userID string) (*DashboardData, error) {
	s.mu.RLock()
	entry, ok := s.cache[userID]
	s.mu.RUnlock()

	if ok && time.Since(entry.computedAt) < s.ttl {
		return entry.data, nil
	}

	data, err := s.repo.GetDashboard(ctx, userID)
	if err != nil {
		return nil, err
	}

	s.mu.Lock()
	s.cache[userID] = &cacheEntry{data: data, computedAt: time.Now()}
	s.mu.Unlock()

	return data, nil
}

func (s *service) InvalidateCache(userID string) {
	s.mu.Lock()
	delete(s.cache, userID)
	s.mu.Unlock()
}
