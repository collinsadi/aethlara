export interface User {
  id: string;
  full_name: string;
  email: string;
  billing_plan: string;
  is_verified: boolean;
  last_login_at: string | null;
  created_at: string;
}

export interface ResumeItem {
  id: string;
  name: string;
  file_format: string;
  file_size_bytes: number;
  extraction_status: "completed" | "processing" | "failed";
  uploaded_at: string;
}

export interface ResumePreviewUrlResult {
  url: string;
  expires_at: string;
}

/**
 * Legacy Resume type used by mock-data / Dashboard / JobDetail pages.
 * Will be removed once those pages migrate to the API-backed ResumeItem.
 */
export interface LegacyResume {
  id: string;
  name: string;
  rawText: string;
  structuredData: LegacyResumeStructuredData;
  createdAt: string;
  updatedAt: string;
}

export interface LegacyResumeStructuredData {
  fullName: string;
  email: string;
  phone?: string;
  summary: string;
  experience: { title: string; company: string; period: string; description: string }[];
  education: { degree: string; school: string; year: string }[];
  skills: string[];
}

export interface Job {
  id: string;
  title: string;
  company: string;
  location?: string;
  jobDescription: string;
  matchScore: number;
  status: ApplicationStatus;
  /** Order within the tracker column (same `status`). Lower = higher on the board. */
  kanbanOrder?: number;
  createdAt: string;
  updatedAt: string;
  resumeId?: string;
}

export type ApplicationStatus =
  | "not_applied"
  | "applied"
  | "interview"
  | "offer"
  | "rejected";

export interface ChatMessage {
  id: string;
  jobId: string;
  role: "user" | "ai";
  content: string;
  timestamp: string;
}

export interface ChatHistory {
  jobId: string;
  messages: ChatMessage[];
}

export const APPLICATION_STATUS_LABELS: Record<ApplicationStatus, string> = {
  not_applied: "Not Applied",
  applied: "Applied",
  interview: "Interview",
  offer: "Offer",
  rejected: "Rejected",
};

export const APPLICATION_STATUS_COLORS: Record<ApplicationStatus, string> = {
  not_applied: "bg-muted text-muted-foreground",
  applied: "bg-brand/15 text-brand",
  interview:
    "bg-neutral-200 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200",
  offer: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-400",
  rejected: "bg-red-500/15 text-red-600 dark:text-red-400",
};

// ─── Jobs (API-backed) ──────────────────────────────────────────────────────

export type JobStatus =
  | 'not_applied'
  | 'applied'
  | 'interview'
  | 'offer'
  | 'rejected'
  | 'withdrawn'

export type InputMethod = 'url' | 'text'
export type ExtractionStatus = 'pending' | 'processing' | 'completed' | 'failed'
export type AlignmentStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'misaligned'

/** Status transitions that mirror backend validation exactly. Must stay in sync. */
export const ALLOWED_TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  not_applied: ['applied'],
  applied:     ['interview', 'rejected', 'withdrawn'],
  interview:   ['offer', 'rejected', 'withdrawn'],
  offer:       ['withdrawn'],
  rejected:    [],
  withdrawn:   [],
}

export interface ApiJob {
  id: string
  job_title: string
  company: string
  location: string | null
  is_remote: boolean
  employment_type: string | null
  experience_level: string | null
  match_score: number | null
  status: JobStatus
  resume_id: string
  input_method: InputMethod
  job_url: string | null
  extraction_status: ExtractionStatus
  alignment_status: AlignmentStatus
  pdf_generated_at: string | null
  created_at: string
  applied_at: string | null
}

export interface MatchBreakdown {
  skills_match: number
  experience_match: number
  education_match: number
  overall_notes: string
}

export interface ApiJobDetail extends ApiJob {
  salary: { min: number | null; max: number | null; currency: string; period: string }
  match_breakdown: MatchBreakdown | null
  gaps: string[]
  notes: string | null
  updated_at: string
}

export interface JobStatusUpdate {
  id: string
  status: JobStatus
  applied_at: string | null
  updated_at: string
}

export interface JobPreviewUrl {
  url: string
  expires_at: string
}

export interface Pagination {
  page: number
  page_size: number
  total_items: number
  total_pages: number
  has_next: boolean
  has_prev: boolean
}

export interface PaginatedJobs {
  items: ApiJob[]
  pagination: Pagination
}

// ─── Analytics ──────────────────────────────────────────────────────────────

export interface DashboardAnalytics {
  total_jobs_this_month: number
  average_match_rate: number
  total_resumes: number
  applied_jobs: number
  jobs_by_status: Record<JobStatus, number>
  match_score_distribution: { low: number; medium: number; high: number }
  top_companies: { company: string; count: number }[]
  monthly_trend: { month: string; count: number }[]
  computed_at: string
}

/** API envelope shapes matching the Go backend */
export interface ApiSuccessResponse<T = unknown> {
  data?: T;
  message?: string;
}

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
  };
}

export interface ApiError {
  code: string;
  message: string;
  status: number;
  requestId?: string;
}

export interface TokenPairResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  user: User;
}
