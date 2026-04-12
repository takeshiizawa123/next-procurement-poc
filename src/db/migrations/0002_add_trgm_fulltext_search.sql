-- pg_trgm拡張を有効化（曖昧検索用）
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
-- 品目名のGINインデックス（部分一致検索）
CREATE INDEX IF NOT EXISTS purchase_requests_item_name_trgm_idx
  ON purchase_requests USING GIN (item_name gin_trgm_ops);
--> statement-breakpoint
-- 購入先名のGINインデックス（部分一致検索）
CREATE INDEX IF NOT EXISTS purchase_requests_supplier_name_trgm_idx
  ON purchase_requests USING GIN (supplier_name gin_trgm_ops);
--> statement-breakpoint
-- 申請者名のGINインデックス
CREATE INDEX IF NOT EXISTS purchase_requests_applicant_name_trgm_idx
  ON purchase_requests USING GIN (applicant_name gin_trgm_ops);
