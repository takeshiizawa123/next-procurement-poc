-- 契約マスタに支払情報を追加

ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS payment_method VARCHAR(30),
  ADD COLUMN IF NOT EXISTS payment_day INTEGER;

COMMENT ON COLUMN contracts.payment_method IS '支払方法: 振込 | 口座引落 | MFビジネスカード | クレジットカード | その他';
COMMENT ON COLUMN contracts.payment_day IS '毎月の支払日 (1-31、31=月末扱い)';
