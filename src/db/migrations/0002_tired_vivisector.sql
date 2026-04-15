CREATE TYPE "public"."billing_type" AS ENUM('固定', '従量', 'カード自動');--> statement-breakpoint
CREATE TYPE "public"."contract_category" AS ENUM('派遣', '外注', 'SaaS', '顧問', '賃貸', '保守', '清掃', 'その他');--> statement-breakpoint
CREATE TYPE "public"."contract_invoice_status" AS ENUM('未受領', '受領済', '承認済', '仕訳済', '見積計上');--> statement-breakpoint
CREATE TABLE "account_corrections" (
	"id" serial PRIMARY KEY NOT NULL,
	"po_number" varchar(30) NOT NULL,
	"item_name" varchar(500) NOT NULL,
	"supplier_name" varchar(200),
	"department" varchar(100),
	"total_amount" integer,
	"estimated_account" varchar(100) NOT NULL,
	"estimated_tax_type" varchar(50),
	"estimated_confidence" varchar(10),
	"corrected_account" varchar(100) NOT NULL,
	"corrected_tax_type" varchar(50),
	"corrected_by" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"table_name" varchar(50) NOT NULL,
	"record_id" varchar(50) NOT NULL,
	"action" varchar(20) NOT NULL,
	"changed_by" varchar(100),
	"field_name" varchar(100),
	"old_value" text,
	"new_value" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contract_invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"contract_id" integer NOT NULL,
	"billing_month" varchar(7) NOT NULL,
	"invoice_amount" integer,
	"expected_amount" integer,
	"amount_diff" integer,
	"status" "contract_invoice_status" DEFAULT '未受領' NOT NULL,
	"approved_by" varchar(100),
	"approved_at" timestamp with time zone,
	"voucher_file_url" text,
	"voucher_uploaded_at" timestamp with time zone,
	"journal_id" integer,
	"accrual_journal_id" integer,
	"reversal_journal_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contracts" (
	"id" serial PRIMARY KEY NOT NULL,
	"contract_number" varchar(30) NOT NULL,
	"category" "contract_category" NOT NULL,
	"billing_type" "billing_type" NOT NULL,
	"supplier_name" varchar(200) NOT NULL,
	"supplier_contact" varchar(200),
	"monthly_amount" integer,
	"annual_amount" integer,
	"budget_amount" integer,
	"contract_start_date" date NOT NULL,
	"contract_end_date" date,
	"renewal_type" varchar(20) DEFAULT '自動更新' NOT NULL,
	"renewal_alert_days" integer DEFAULT 60 NOT NULL,
	"account_title" varchar(100) NOT NULL,
	"mf_account_code" varchar(20),
	"mf_tax_code" varchar(20),
	"mf_department_code" varchar(20),
	"mf_counterparty_code" varchar(20),
	"department" varchar(100) NOT NULL,
	"requester_slack_id" varchar(30),
	"approver_slack_id" varchar(30),
	"auto_approve" boolean DEFAULT false NOT NULL,
	"auto_accrue" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contracts_contract_number_unique" UNIQUE("contract_number")
);
--> statement-breakpoint
CREATE TABLE "dead_letter_queue" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_id" varchar(100) NOT NULL,
	"task_type" varchar(50) NOT NULL,
	"error_message" text NOT NULL,
	"retry_count" integer NOT NULL,
	"payload" jsonb,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "account_corrections_supplier_idx" ON "account_corrections" USING btree ("supplier_name");--> statement-breakpoint
CREATE INDEX "account_corrections_item_idx" ON "account_corrections" USING btree ("item_name");--> statement-breakpoint
CREATE INDEX "account_corrections_created_at_idx" ON "account_corrections" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_log_table_record_idx" ON "audit_log" USING btree ("table_name","record_id");--> statement-breakpoint
CREATE INDEX "audit_log_created_at_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_log_changed_by_idx" ON "audit_log" USING btree ("changed_by");--> statement-breakpoint
CREATE INDEX "contract_invoices_contract_idx" ON "contract_invoices" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "contract_invoices_month_idx" ON "contract_invoices" USING btree ("billing_month");--> statement-breakpoint
CREATE INDEX "contract_invoices_status_idx" ON "contract_invoices" USING btree ("status");--> statement-breakpoint
CREATE INDEX "contracts_active_idx" ON "contracts" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "contracts_end_date_idx" ON "contracts" USING btree ("contract_end_date");--> statement-breakpoint
CREATE INDEX "contracts_category_idx" ON "contracts" USING btree ("category");--> statement-breakpoint
CREATE INDEX "contracts_supplier_idx" ON "contracts" USING btree ("supplier_name");--> statement-breakpoint
CREATE INDEX "dlq_task_type_idx" ON "dead_letter_queue" USING btree ("task_type");--> statement-breakpoint
CREATE INDEX "dlq_created_at_idx" ON "dead_letter_queue" USING btree ("created_at");