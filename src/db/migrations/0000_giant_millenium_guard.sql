CREATE TYPE "public"."invoice_kind" AS ENUM('適格', '非適格', '番号なし');--> statement-breakpoint
CREATE TYPE "public"."invoice_verification" AS ENUM('verified', 'not_found', 'no_number', 'error');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('会社カード', '請求書払い', '立替');--> statement-breakpoint
CREATE TYPE "public"."prediction_status" AS ENUM('pending', 'matched', 'unmatched', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."prediction_type" AS ENUM('purchase', 'trip_transport', 'trip_hotel', 'trip_daily', 'reimbursement');--> statement-breakpoint
CREATE TYPE "public"."purchase_status" AS ENUM('申請済', '承認済', '発注済', '検収済', '証憑完了', '計上済', '支払済', '差戻し', '取消');--> statement-breakpoint
CREATE TYPE "public"."request_type" AS ENUM('購入前', '購入済');--> statement-breakpoint
CREATE TYPE "public"."voucher_status" AS ENUM('none', 'uploaded', 'verified', 'mf_auto');--> statement-breakpoint
CREATE TABLE "employees" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"slack_id" varchar(30) NOT NULL,
	"slack_aliases" text,
	"email" varchar(255),
	"department_code" varchar(20) NOT NULL,
	"department_name" varchar(100) NOT NULL,
	"dept_head_slack_id" varchar(30),
	"card_last4" varchar(4),
	"card_holder_name" varchar(100),
	"mf_office_member_id" varchar(50),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employees_slack_id_unique" UNIQUE("slack_id")
);
--> statement-breakpoint
CREATE TABLE "journal_rows" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" date NOT NULL,
	"remark" text,
	"account" varchar(100),
	"tax_type" varchar(50),
	"amount" integer,
	"department" varchar(100),
	"counterparty" varchar(200),
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_stats" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"counterparty_accounts" jsonb,
	"dept_account_tax" jsonb,
	"remark_accounts" jsonb,
	"total_journals" integer,
	"total_rows" integer,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mf_accounts" (
	"mf_id" varchar(30) PRIMARY KEY NOT NULL,
	"code" varchar(20) NOT NULL,
	"name" varchar(200) NOT NULL,
	"search_key" varchar(200),
	"tax_id" integer,
	"available" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mf_counterparties" (
	"mf_id" varchar(30) PRIMARY KEY NOT NULL,
	"code" varchar(20) NOT NULL,
	"name" varchar(200) NOT NULL,
	"search_key" varchar(200),
	"invoice_registration_number" varchar(20),
	"alias" text,
	"available" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mf_departments" (
	"mf_id" varchar(30) PRIMARY KEY NOT NULL,
	"code" varchar(20) NOT NULL,
	"name" varchar(200) NOT NULL,
	"search_key" varchar(200),
	"available" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mf_masters_cache" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"accounts" jsonb,
	"taxes" jsonb,
	"sub_accounts" jsonb,
	"projects" jsonb,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mf_oauth_tokens" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text NOT NULL,
	"token_type" varchar(30) DEFAULT 'Bearer' NOT NULL,
	"scope" text,
	"expires_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mf_projects" (
	"mf_id" varchar(30) PRIMARY KEY NOT NULL,
	"code" varchar(20) NOT NULL,
	"name" varchar(200) NOT NULL,
	"search_key" varchar(200),
	"available" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mf_sub_accounts" (
	"mf_id" varchar(30) PRIMARY KEY NOT NULL,
	"code" varchar(20) NOT NULL,
	"account_id" integer,
	"name" varchar(200) NOT NULL,
	"search_key" varchar(200),
	"available" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mf_taxes" (
	"mf_id" varchar(30) PRIMARY KEY NOT NULL,
	"code" varchar(20) NOT NULL,
	"name" varchar(100) NOT NULL,
	"abbreviation" varchar(10),
	"tax_rate" integer,
	"available" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "predicted_transactions" (
	"id" varchar(30) PRIMARY KEY NOT NULL,
	"po_number" varchar(30),
	"type" "prediction_type" NOT NULL,
	"card_last4" varchar(4),
	"mf_office_member_id" varchar(50),
	"predicted_amount" integer NOT NULL,
	"predicted_date" date NOT NULL,
	"supplier" varchar(200),
	"applicant" varchar(100),
	"applicant_slack_id" varchar(30),
	"status" "prediction_status" DEFAULT 'pending' NOT NULL,
	"matched_journal_id" integer,
	"matched_at" timestamp with time zone,
	"amount_diff" integer,
	"mf_ex_transaction_id" varchar(50),
	"is_estimate" boolean DEFAULT false NOT NULL,
	"is_post_report" boolean DEFAULT false NOT NULL,
	"emergency_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_drafts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(30) NOT NULL,
	"draft" jsonb NOT NULL,
	"saved_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_requests" (
	"po_number" varchar(30) PRIMARY KEY NOT NULL,
	"status" "purchase_status" DEFAULT '申請済' NOT NULL,
	"request_type" "request_type" NOT NULL,
	"applicant_slack_id" varchar(30) NOT NULL,
	"applicant_name" varchar(100) NOT NULL,
	"department" varchar(100) NOT NULL,
	"approver_slack_id" varchar(30),
	"approver_name" varchar(100),
	"inspector_slack_id" varchar(30),
	"inspector_name" varchar(100),
	"item_name" varchar(500) NOT NULL,
	"unit_price" integer NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"total_amount" integer NOT NULL,
	"payment_method" "payment_method" NOT NULL,
	"purpose" text,
	"supplier_name" varchar(200),
	"supplier_url" text,
	"hubspot_deal_id" varchar(50),
	"budget_number" varchar(50),
	"katana_po_number" varchar(50),
	"account_title" varchar(100),
	"mf_account_code" varchar(20),
	"mf_tax_code" varchar(20),
	"mf_department_code" varchar(20),
	"mf_project_code" varchar(20),
	"mf_counterparty_code" varchar(20),
	"mf_sub_account_code" varchar(20),
	"mf_remark" text,
	"voucher_status" "voucher_status" DEFAULT 'none' NOT NULL,
	"voucher_amount" integer,
	"voucher_file_url" text,
	"voucher_uploaded_at" timestamp with time zone,
	"delivery_note_file_url" text,
	"registration_number" varchar(20),
	"is_qualified_invoice" "invoice_kind",
	"invoice_verification_status" "invoice_verification",
	"slack_channel_id" varchar(30),
	"slack_message_ts" varchar(50),
	"slack_thread_ts" varchar(50),
	"stage1_journal_id" integer,
	"matched_journal_id" integer,
	"application_date" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_at" timestamp with time zone,
	"ordered_at" timestamp with time zone,
	"inspected_at" timestamp with time zone,
	"voucher_completed_at" timestamp with time zone,
	"purchase_date" date,
	"inspected_quantity" integer,
	"remarks" text,
	"is_estimate" boolean DEFAULT false NOT NULL,
	"is_post_report" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "slack_event_log" (
	"event_id" varchar(100) PRIMARY KEY NOT NULL,
	"event_type" varchar(50),
	"payload" jsonb,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "employees_slack_id_idx" ON "employees" USING btree ("slack_id");--> statement-breakpoint
CREATE INDEX "employees_email_idx" ON "employees" USING btree ("email");--> statement-breakpoint
CREATE INDEX "employees_card_last4_idx" ON "employees" USING btree ("card_last4");--> statement-breakpoint
CREATE INDEX "employees_mf_office_member_idx" ON "employees" USING btree ("mf_office_member_id");--> statement-breakpoint
CREATE INDEX "journal_rows_counterparty_idx" ON "journal_rows" USING btree ("counterparty");--> statement-breakpoint
CREATE INDEX "journal_rows_department_idx" ON "journal_rows" USING btree ("department");--> statement-breakpoint
CREATE INDEX "journal_rows_date_idx" ON "journal_rows" USING btree ("date");--> statement-breakpoint
CREATE INDEX "mf_accounts_code_idx" ON "mf_accounts" USING btree ("code");--> statement-breakpoint
CREATE INDEX "mf_counterparties_code_idx" ON "mf_counterparties" USING btree ("code");--> statement-breakpoint
CREATE INDEX "mf_counterparties_name_idx" ON "mf_counterparties" USING btree ("name");--> statement-breakpoint
CREATE INDEX "mf_departments_code_idx" ON "mf_departments" USING btree ("code");--> statement-breakpoint
CREATE INDEX "mf_projects_code_idx" ON "mf_projects" USING btree ("code");--> statement-breakpoint
CREATE INDEX "mf_sub_accounts_code_idx" ON "mf_sub_accounts" USING btree ("code");--> statement-breakpoint
CREATE INDEX "mf_sub_accounts_account_id_idx" ON "mf_sub_accounts" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "mf_taxes_code_idx" ON "mf_taxes" USING btree ("code");--> statement-breakpoint
CREATE INDEX "predicted_transactions_status_idx" ON "predicted_transactions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "predicted_transactions_po_number_idx" ON "predicted_transactions" USING btree ("po_number");--> statement-breakpoint
CREATE INDEX "predicted_transactions_card_last4_idx" ON "predicted_transactions" USING btree ("card_last4");--> statement-breakpoint
CREATE INDEX "predicted_transactions_office_member_idx" ON "predicted_transactions" USING btree ("mf_office_member_id");--> statement-breakpoint
CREATE INDEX "predicted_transactions_predicted_date_idx" ON "predicted_transactions" USING btree ("predicted_date");--> statement-breakpoint
CREATE INDEX "purchase_drafts_user_id_idx" ON "purchase_drafts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "purchase_requests_status_idx" ON "purchase_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "purchase_requests_applicant_idx" ON "purchase_requests" USING btree ("applicant_slack_id");--> statement-breakpoint
CREATE INDEX "purchase_requests_approver_idx" ON "purchase_requests" USING btree ("approver_slack_id");--> statement-breakpoint
CREATE INDEX "purchase_requests_application_date_idx" ON "purchase_requests" USING btree ("application_date");--> statement-breakpoint
CREATE INDEX "purchase_requests_slack_ts_idx" ON "purchase_requests" USING btree ("slack_message_ts");--> statement-breakpoint
CREATE INDEX "slack_event_log_processed_at_idx" ON "slack_event_log" USING btree ("processed_at");