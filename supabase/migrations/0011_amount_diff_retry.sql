-- 金額差異再承認の試行回数を記録（3回超で強制エスカレーション）
ALTER TABLE purchase_requests ADD COLUMN amount_diff_retry_count INTEGER NOT NULL DEFAULT 0;
