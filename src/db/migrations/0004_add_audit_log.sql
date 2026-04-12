CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  table_name VARCHAR(50) NOT NULL,
  record_id VARCHAR(50) NOT NULL,
  action VARCHAR(20) NOT NULL,
  changed_by VARCHAR(100),
  field_name VARCHAR(100),
  old_value TEXT,
  new_value TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS audit_log_table_record_idx ON audit_log (table_name, record_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS audit_log_created_at_idx ON audit_log (created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS audit_log_changed_by_idx ON audit_log (changed_by);
