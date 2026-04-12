CREATE TABLE IF NOT EXISTS dead_letter_queue (
  id SERIAL PRIMARY KEY,
  task_id VARCHAR(100) NOT NULL,
  task_type VARCHAR(50) NOT NULL,
  error_message TEXT NOT NULL,
  retry_count INTEGER NOT NULL,
  payload JSONB,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS dlq_task_type_idx ON dead_letter_queue (task_type);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS dlq_created_at_idx ON dead_letter_queue (created_at);
