-- 従量系契約の請求書に稼働時間・数量・報告メモを追加
ALTER TABLE contract_invoices ADD COLUMN hours NUMERIC(8,2);
ALTER TABLE contract_invoices ADD COLUMN units NUMERIC(10,2);
ALTER TABLE contract_invoices ADD COLUMN report_notes TEXT;
