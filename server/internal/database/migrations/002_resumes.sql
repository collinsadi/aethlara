CREATE TABLE resumes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  file_format TEXT NOT NULL CHECK (file_format IN ('pdf', 'md', 'doc', 'docx')),
  file_size_bytes INTEGER NOT NULL,
  r2_object_key TEXT NOT NULL,
  extracted_json JSONB,
  extraction_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (extraction_status IN ('pending', 'processing', 'completed', 'failed')),
  extraction_error TEXT,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ DEFAULT NULL
);

CREATE INDEX idx_resumes_user_id ON resumes(user_id);
CREATE INDEX idx_resumes_deleted_at ON resumes(deleted_at);
CREATE INDEX idx_resumes_user_active ON resumes(user_id) WHERE deleted_at IS NULL;
