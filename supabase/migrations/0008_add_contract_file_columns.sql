-- 契約書PDFのNotion保管リンクを保存するカラム
ALTER TABLE contracts ADD COLUMN contract_file_url TEXT;
ALTER TABLE contracts ADD COLUMN contract_file_name VARCHAR(255);
