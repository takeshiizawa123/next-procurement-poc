-- 勘定科目修正履歴テーブル（仕訳推定の学習ループ用）
CREATE TABLE IF NOT EXISTS account_corrections (
  id SERIAL PRIMARY KEY,
  po_number VARCHAR(30) NOT NULL,
  item_name VARCHAR(500) NOT NULL,
  supplier_name VARCHAR(200),
  department VARCHAR(100),
  total_amount INTEGER,
  estimated_account VARCHAR(100) NOT NULL,
  estimated_tax_type VARCHAR(50),
  estimated_confidence VARCHAR(10),
  corrected_account VARCHAR(100) NOT NULL,
  corrected_tax_type VARCHAR(50),
  corrected_by VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS account_corrections_supplier_idx ON account_corrections (supplier_name);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS account_corrections_item_idx ON account_corrections (item_name);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS account_corrections_created_at_idx ON account_corrections (created_at);
