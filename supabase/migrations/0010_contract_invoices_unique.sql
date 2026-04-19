-- 契約請求書の二重計上防止: contract_id + billing_month でUNIQUE制約
-- 既存の重複レコードがある場合は新しいほうを残して削除してから制約追加

-- 重複削除（念のため、同一contract+月の複数行があれば最新のidのみ残す）
DELETE FROM contract_invoices a
USING contract_invoices b
WHERE a.id < b.id
  AND a.contract_id = b.contract_id
  AND a.billing_month = b.billing_month;

ALTER TABLE contract_invoices
  ADD CONSTRAINT contract_invoices_contract_month_unique
  UNIQUE (contract_id, billing_month);
