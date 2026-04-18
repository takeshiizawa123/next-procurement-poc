-- 給与連携用カラム追加
-- employees: MF給与の社員コード+雇用区分
ALTER TABLE employees ADD COLUMN payroll_code VARCHAR(10);
ALTER TABLE employees ADD COLUMN employment_type VARCHAR(20);
CREATE INDEX IF NOT EXISTS employees_payroll_code_idx ON employees (payroll_code);

-- purchase_requests: 出張日当（給与連携対象）
ALTER TABLE purchase_requests ADD COLUMN trip_allowance INTEGER;
