-- Allow jobs created from the Chrome extension (CreateFromPreview uses input_method = 'extension').
ALTER TABLE jobs DROP CONSTRAINT jobs_input_method_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_input_method_check CHECK (input_method IN ('url', 'text', 'extension'));
