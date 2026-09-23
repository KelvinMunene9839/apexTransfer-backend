-- Current sql file was generated after introspecting the database
-- If you want to run this migration please uncomment this code before executing migrations
/*
CREATE TABLE "internal_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text DEFAULT generate_reference('IFT'::text) NOT NULL,
	"branch_id" uuid NOT NULL,
	"from_account" text NOT NULL,
	"to_account" text NOT NULL,
	"from_currency" text NOT NULL,
	"to_currency" text NOT NULL,
	"amount" numeric(20, 4) NOT NULL,
	"converted_amount" numeric(20, 4) NOT NULL,
	"fee_amount" numeric(20, 4) DEFAULT '0' NOT NULL,
	"amount_rwf" numeric(20, 2) DEFAULT '0' NOT NULL,
	"fee_rwf" numeric(20, 2) DEFAULT '0' NOT NULL,
	"note" text,
	"initiated_by" uuid,
	"voided" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "internal_transfers_reference_key" UNIQUE("reference"),
	CONSTRAINT "internal_transfers_amount_check" CHECK (amount > (0)::numeric)
);
--> statement-breakpoint
ALTER TABLE "internal_transfers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "money_gram_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text NOT NULL,
	"type" text NOT NULL,
	"currency" text NOT NULL,
	"amount" numeric(20, 2) NOT NULL,
	"rate_applied" numeric(18, 6),
	"equivalent_rwf" numeric(20, 2) NOT NULL,
	"amount_paid" numeric(20, 2) NOT NULL,
	"source_account" text NOT NULL,
	"dest_account" text NOT NULL,
	"pay_currency" text DEFAULT 'single' NOT NULL,
	"pay_rwf" numeric(20, 2),
	"pay_fx" numeric(20, 2),
	"branch_id" uuid NOT NULL,
	"teller_id" uuid,
	"customer_name" text,
	"notes" text,
	"status" text DEFAULT 'completed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "money_gram_transactions_reference_key" UNIQUE("reference"),
	CONSTRAINT "money_gram_transactions_amount_check" CHECK (amount > (0)::numeric),
	CONSTRAINT "money_gram_transactions_currency_check" CHECK (currency = ANY (ARRAY['USD'::text, 'RWF'::text])),
	CONSTRAINT "money_gram_transactions_pay_currency_check" CHECK (pay_currency = ANY (ARRAY['single'::text, 'split'::text, 'usd'::text])),
	CONSTRAINT "money_gram_transactions_type_check" CHECK (type = ANY (ARRAY['receive'::text, 'send'::text]))
);
--> statement-breakpoint
ALTER TABLE "money_gram_transactions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ria_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text NOT NULL,
	"type" text NOT NULL,
	"amount" numeric(20, 2) NOT NULL,
	"amount_paid" numeric(20, 2) NOT NULL,
	"source_account" text NOT NULL,
	"dest_account" text NOT NULL,
	"branch_id" uuid NOT NULL,
	"teller_id" uuid,
	"customer_name" text,
	"notes" text,
	"status" text DEFAULT 'completed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ria_transactions_reference_key" UNIQUE("reference"),
	CONSTRAINT "ria_transactions_amount_check" CHECK (amount > (0)::numeric),
	CONSTRAINT "ria_transactions_type_check" CHECK (type = ANY (ARRAY['receive'::text, 'send'::text]))
);
--> statement-breakpoint
ALTER TABLE "ria_transactions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "float_channel_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text NOT NULL,
	"channel" text NOT NULL,
	"type" text NOT NULL,
	"amount" numeric(20, 2) NOT NULL,
	"source_account" text NOT NULL,
	"dest_account" text NOT NULL,
	"branch_id" uuid NOT NULL,
	"teller_id" uuid,
	"notes" text,
	"status" text DEFAULT 'completed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"currency" text DEFAULT 'RWF' NOT NULL,
	CONSTRAINT "float_channel_transactions_reference_key" UNIQUE("reference"),
	CONSTRAINT "float_channel_transactions_amount_check" CHECK (amount > (0)::numeric),
	CONSTRAINT "float_channel_transactions_channel_check" CHECK (channel = ANY (ARRAY['bk'::text, 'equity'::text, 'amin'::text])),
	CONSTRAINT "float_channel_transactions_type_check" CHECK (type = ANY (ARRAY['deposit'::text, 'withdraw'::text]))
);
--> statement-breakpoint
ALTER TABLE "float_channel_transactions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "currency_pairs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"base_currency" text NOT NULL,
	"quote_currency" text DEFAULT 'RWF' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"mid_rate" numeric(18, 6),
	"threshold_amount" numeric(20, 2),
	"threshold_buy" numeric(20, 2),
	"threshold_sell" numeric(20, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "currency_pairs_code_key" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "currency_pairs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"full_name" text,
	"role" text NOT NULL,
	"branch_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "profiles_role_check" CHECK (role = ANY (ARRAY['admin'::text, 'auditor'::text, 'accountant'::text, 'teller'::text, 'super_teller'::text, 'branch_manager'::text]))
);
--> statement-breakpoint
ALTER TABLE "profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "account_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"transaction_id" uuid,
	"shift_id" uuid,
	"direction" text NOT NULL,
	"amount_rwf" numeric(20, 4) NOT NULL,
	"amount_foreign" numeric(20, 4),
	"currency" text,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source_type" text DEFAULT 'float' NOT NULL,
	"voided" boolean DEFAULT false NOT NULL,
	CONSTRAINT "account_movements_direction_amount_foreign_check" CHECK ((amount_foreign IS NULL) OR ((direction = 'in'::text) AND (amount_foreign >= (0)::numeric)) OR ((direction = 'out'::text) AND (amount_foreign <= (0)::numeric)))) NOT VALID),
	CONSTRAINT "account_movements_direction_check" CHECK (direction = ANY (ARRAY['in'::text, 'out'::text])),
	CONSTRAINT "account_movements_source_type_check" CHECK (source_type = ANY (ARRAY['float'::text, 'equity'::text]))
);
--> statement-breakpoint
ALTER TABLE "account_movements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payment_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"branch_id" uuid,
	"balance_rwf" numeric(20, 4) DEFAULT '0' NOT NULL,
	"balance_fx" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"currencies" text[] DEFAULT '{""}' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"type" text,
	"catalog_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payment_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "branches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"phone" text,
	"email" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "branches_code_key" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "branches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "currencies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"symbol" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "currencies_code_key" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "currencies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "exchange_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pair_id" uuid NOT NULL,
	"buy" numeric(18, 6) NOT NULL,
	"sell" numeric(18, 6) NOT NULL,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "exchange_rates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "system_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb DEFAULT '""'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
ALTER TABLE "system_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "account_catalog" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"currencies" text[] DEFAULT '{""}' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_catalog_name_key" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "account_catalog" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fee_expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid,
	"tx_ref" text NOT NULL,
	"fee_type" text NOT NULL,
	"amount_fx" numeric(20, 4) DEFAULT '0' NOT NULL,
	"amount_rwf" numeric(20, 2) NOT NULL,
	"buy_rate" numeric(18, 6) NOT NULL,
	"sell_rate" numeric(18, 6) NOT NULL,
	"currency" text NOT NULL,
	"teller_id" uuid,
	"branch_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fee_expenses_fee_type_check" CHECK (fee_type = ANY (ARRAY['explicit'::text, 'implicit'::text]))
);
--> statement-breakpoint
ALTER TABLE "fee_expenses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "shifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"teller_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by" uuid,
	"opening_float" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"closing_calculated" jsonb,
	"closing_declared" jsonb,
	"declared_balances" jsonb,
	"discrepancy" jsonb,
	"rejection_reason" text,
	CONSTRAINT "shifts_status_check" CHECK (status = ANY (ARRAY['open'::text, 'pending_close'::text, 'discrepancy_flagged'::text, 'closed'::text, 'rejected'::text]))
);
--> statement-breakpoint
ALTER TABLE "shifts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "float_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"teller_id" uuid,
	"transaction_id" uuid,
	"shift_id" uuid,
	"currency" text NOT NULL,
	"amount" numeric(18, 4) NOT NULL,
	"movement_type" text NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"wac_rate_snapshot" numeric(18, 6),
	CONSTRAINT "float_movements_movement_type_check" CHECK (movement_type = ANY (ARRAY['dispatch'::text, 'return'::text, 'incoming'::text, 'sell-out'::text, 'buy-in'::text, 'adjustment'::text]))
);
--> statement-breakpoint
ALTER TABLE "float_movements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "petit_cash_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"teller_id" uuid,
	"branch_id" uuid,
	"shift_id" uuid,
	"direction" text NOT NULL,
	"category" text NOT NULL,
	"amount_rwf" numeric(20, 2) NOT NULL,
	"description" text,
	"payment_account" text,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"account_code" text,
	"currency" text,
	"amount_foreign" numeric(20, 4),
	"voided" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"reject_reason" text,
	CONSTRAINT "petit_cash_entries_direction_check" CHECK (direction = ANY (ARRAY['in'::text, 'out'::text])),
	CONSTRAINT "petit_cash_entries_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text]))
);
--> statement-breakpoint
ALTER TABLE "petit_cash_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text DEFAULT generate_reference('TXN'::text) NOT NULL,
	"type" text NOT NULL,
	"pair_id" uuid,
	"amount_foreign" numeric(20, 6) NOT NULL,
	"rate_applied" numeric(18, 6) NOT NULL,
	"equivalent_rwf" numeric(20, 2) NOT NULL,
	"customer_name" text,
	"customer_phone" text,
	"customer_email" text,
	"teller_id" uuid,
	"branch_id" uuid,
	"shift_id" uuid,
	"payment_status" text NOT NULL,
	"pending_reason" text,
	"source_account" text,
	"dest_account" text,
	"amount_paid" numeric(20, 2) DEFAULT '0' NOT NULL,
	"special_rate_requested" boolean DEFAULT false NOT NULL,
	"voided" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"wac_cost_rate" numeric(18, 6),
	"tx_fee_foreign" numeric(20, 4) DEFAULT '0' NOT NULL,
	"tx_fee_currency" text,
	"tx_fee_rwf" numeric(20, 4) DEFAULT '0' NOT NULL,
	"rejection_reason" text,
	"recommended_rate" numeric(18, 6),
	"recommendation_status" text DEFAULT 'none' NOT NULL,
	"recommended_by" uuid,
	"quote_currency" text,
	"equivalent_quote" numeric(20, 6),
	"wac_cost_currency" text,
	"fee_account" text,
	CONSTRAINT "transactions_reference_key" UNIQUE("reference"),
	CONSTRAINT "transactions_amount_foreign_positive" CHECK (amount_foreign > (0)::numeric),
	CONSTRAINT "transactions_equivalent_rwf_positive" CHECK ((equivalent_rwf > (0)::numeric) OR ((quote_currency IS NOT NULL) AND (quote_currency <> 'RWF'::text))),
	CONSTRAINT "transactions_payment_status_check" CHECK (payment_status = ANY (ARRAY['completed'::text, 'pending'::text, 'awaiting_payment'::text, 'customer_not_yet_paid'::text, 'pending_approval'::text, 'rejected'::text, 'voided'::text])),
	CONSTRAINT "transactions_recommendation_status_check" CHECK (recommendation_status = ANY (ARRAY['none'::text, 'pending'::text, 'accepted'::text, 'declined'::text])),
	CONSTRAINT "transactions_type_check" CHECK (type = ANY (ARRAY['buy'::text, 'sell'::text]))
);
--> statement-breakpoint
ALTER TABLE "transactions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid,
	"branch_id" uuid,
	"party_name" text,
	"party_phone" text,
	"party_email" text,
	"entry_type" text NOT NULL,
	"amount_foreign" numeric(20, 6),
	"amount_rwf" numeric(20, 2) NOT NULL,
	"currency" text,
	"status" text DEFAULT 'outstanding' NOT NULL,
	"expected_by" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"quote_currency" text,
	"amount_quote" numeric(20, 6),
	CONSTRAINT "ledger_entries_entry_type_check" CHECK (entry_type = ANY (ARRAY['debtor'::text, 'creditor'::text])),
	CONSTRAINT "ledger_entries_status_check" CHECK (status = ANY (ARRAY['outstanding'::text, 'partial'::text, 'settled'::text, 'voided'::text]))
);
--> statement-breakpoint
ALTER TABLE "ledger_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "inter_branch_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text DEFAULT generate_reference('IBR'::text) NOT NULL,
	"from_branch_id" uuid,
	"to_branch_id" uuid,
	"currency" text NOT NULL,
	"amount" numeric(20, 4) NOT NULL,
	"from_account_name" text,
	"to_account_name" text,
	"description" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inter_branch_transfers_reference_key" UNIQUE("reference"),
	CONSTRAINT "inter_branch_transfers_amount_check" CHECK (amount > (0)::numeric)
);
--> statement-breakpoint
ALTER TABLE "inter_branch_transfers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"read" boolean DEFAULT false NOT NULL,
	"recipient_id" uuid,
	"sender_id" uuid,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sender_id" uuid,
	"sender_branch" uuid,
	"recipient_id" uuid,
	"recipient_branch" uuid,
	"body" text NOT NULL,
	"is_broadcast" boolean DEFAULT false NOT NULL,
	"read_by" uuid[] DEFAULT '{""}' NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor" uuid,
	"action" text NOT NULL,
	"object_type" text,
	"object_id" uuid,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "wac_inventory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"currency" text NOT NULL,
	"quantity" numeric(18, 4) DEFAULT '0' NOT NULL,
	"total_cost_rwf" numeric(18, 4) DEFAULT '0' NOT NULL,
	"wac_rate" numeric(18, 6) DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cost_currency" text DEFAULT 'RWF' NOT NULL,
	CONSTRAINT "wac_inventory_branch_currency_cost_key" UNIQUE("branch_id","currency","cost_currency"),
	CONSTRAINT "wac_inventory_quantity_check" CHECK (quantity >= (0)::numeric),
	CONSTRAINT "wac_inventory_total_cost_rwf_check" CHECK (total_cost_rwf >= (0)::numeric)
);
--> statement-breakpoint
ALTER TABLE "wac_inventory" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "western_union_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text NOT NULL,
	"type" text NOT NULL,
	"currency" text NOT NULL,
	"amount" numeric(20, 2) NOT NULL,
	"rate_applied" numeric(18, 6),
	"equivalent_rwf" numeric(20, 2) NOT NULL,
	"amount_paid" numeric(20, 2) NOT NULL,
	"source_account" text NOT NULL,
	"branch_id" uuid NOT NULL,
	"teller_id" uuid,
	"customer_name" text,
	"notes" text,
	"status" text DEFAULT 'completed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dest_account" text NOT NULL,
	"pay_currency" text DEFAULT 'single' NOT NULL,
	"pay_rwf" numeric(20, 2),
	"pay_fx" numeric(20, 2),
	CONSTRAINT "western_union_transactions_reference_key" UNIQUE("reference"),
	CONSTRAINT "western_union_transactions_amount_check" CHECK (amount > (0)::numeric),
	CONSTRAINT "western_union_transactions_currency_check" CHECK (currency = ANY (ARRAY['USD'::text, 'RWF'::text])),
	CONSTRAINT "western_union_transactions_pay_currency_check" CHECK (pay_currency = ANY (ARRAY['single'::text, 'split'::text, 'usd'::text])),
	CONSTRAINT "western_union_transactions_type_check" CHECK (type = ANY (ARRAY['pickup'::text, 'send'::text]))
);
--> statement-breakpoint
ALTER TABLE "western_union_transactions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "inter_branch_txns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text DEFAULT generate_reference('IBT'::text) NOT NULL,
	"type" text NOT NULL,
	"from_branch_id" uuid NOT NULL,
	"to_branch_id" uuid NOT NULL,
	"pair_id" uuid NOT NULL,
	"currency" text NOT NULL,
	"amount_foreign" numeric(20, 4) NOT NULL,
	"rate_applied" numeric(18, 6),
	"equivalent_rwf" numeric(20, 2),
	"our_account" text DEFAULT 'Cash' NOT NULL,
	"initiated_by" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"amount_paid" numeric(20, 2),
	"fee_collected" numeric(20, 2),
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"special_rate_requested" boolean DEFAULT false NOT NULL,
	"standard_rate" numeric(18, 6),
	"admin_reviewed_by" uuid,
	"admin_reviewed_at" timestamp with time zone,
	"pay_currency" text DEFAULT 'rwf',
	"pay_rwf" numeric(20, 2),
	"pay_fx" numeric(20, 2),
	"pay_account_fx" text,
	"fee_foreign" numeric(20, 4),
	"fee_currency" text,
	"fee_rwf" numeric(20, 2),
	"to_account" text,
	"voided" boolean DEFAULT false NOT NULL,
	"rejection_reason" text,
	"recommended_rate" numeric(18, 6),
	"recommendation_status" text DEFAULT 'none' NOT NULL,
	"wac_cost_rate" numeric(18, 6),
	"threshold_rate_applied" boolean DEFAULT false NOT NULL,
	"quote_currency" text,
	"equivalent_quote" numeric(20, 6),
	"wac_cost_currency" text,
	"quote_account" text,
	CONSTRAINT "inter_branch_txns_reference_key" UNIQUE("reference"),
	CONSTRAINT "inter_branch_txns_amount_foreign_check" CHECK (amount_foreign > (0)::numeric),
	CONSTRAINT "inter_branch_txns_recommendation_status_check" CHECK (recommendation_status = ANY (ARRAY['none'::text, 'pending'::text, 'accepted'::text, 'declined'::text])),
	CONSTRAINT "inter_branch_txns_status_check" CHECK (status = ANY (ARRAY['pending_admin'::text, 'pending'::text, 'approved'::text, 'declined'::text])),
	CONSTRAINT "inter_branch_txns_type_check" CHECK (type = ANY (ARRAY['buy'::text, 'sell'::text]))
);
--> statement-breakpoint
ALTER TABLE "inter_branch_txns" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "branch_float_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text DEFAULT generate_reference('BFT'::text) NOT NULL,
	"from_branch_id" uuid NOT NULL,
	"to_branch_id" uuid NOT NULL,
	"currency" text NOT NULL,
	"amount" numeric(18, 4) NOT NULL,
	"from_account" text NOT NULL,
	"to_account" text,
	"initiated_by" uuid,
	"completed_by" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"fee_amount" numeric(20, 4),
	"voided" boolean DEFAULT false NOT NULL,
	"wac_rate_snapshot" numeric(18, 6),
	CONSTRAINT "branch_float_transfers_reference_key" UNIQUE("reference"),
	CONSTRAINT "branch_float_transfers_amount_check" CHECK (amount > (0)::numeric),
	CONSTRAINT "branch_float_transfers_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'completed'::text, 'rejected'::text]))
);
--> statement-breakpoint
ALTER TABLE "branch_float_transfers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tx_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_type" text NOT NULL,
	"tx_ref" text,
	"tx_id" uuid,
	"teller_id" uuid,
	"branch_id" uuid,
	"shift_id" uuid,
	"reason" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"field_changes" jsonb,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"entity_type" text DEFAULT 'transaction' NOT NULL,
	"internal_transfer_id" uuid,
	"inter_branch_txn_id" uuid,
	"branch_float_transfer_id" uuid,
	"petit_cash_entry_id" uuid,
	"western_union_transaction_id" uuid,
	"money_gram_transaction_id" uuid,
	"ria_transaction_id" uuid,
	"float_channel_transaction_id" uuid,
	CONSTRAINT "tx_requests_entity_type_check" CHECK (entity_type = ANY (ARRAY['transaction'::text, 'internal_transfer'::text, 'inter_branch_txn'::text, 'branch_float_transfer'::text, 'petit_cash_entry'::text, 'western_union_transaction'::text, 'money_gram_transaction'::text, 'ria_transaction'::text, 'float_channel_transaction'::text])),
	CONSTRAINT "tx_requests_request_type_check" CHECK (request_type = ANY (ARRAY['edit'::text, 'delete'::text, 'special_rate'::text, 'add'::text])),
	CONSTRAINT "tx_requests_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text]))
);
--> statement-breakpoint
ALTER TABLE "tx_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "super_teller_accounts" (
	"super_teller_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "super_teller_accounts_pkey" PRIMARY KEY("super_teller_id","account_id")
);
--> statement-breakpoint
ALTER TABLE "super_teller_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "teller_schedules" (
	"teller_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"day_of_week" integer NOT NULL,
	"effective_from" date,
	"effective_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teller_schedules_pkey" PRIMARY KEY("teller_id","day_of_week"),
	CONSTRAINT "teller_schedules_day_of_week_check" CHECK ((day_of_week >= 0) AND (day_of_week <= 6))
);
--> statement-breakpoint
ALTER TABLE "teller_schedules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "internal_transfers" ADD CONSTRAINT "internal_transfers_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_transfers" ADD CONSTRAINT "internal_transfers_initiated_by_fkey" FOREIGN KEY ("initiated_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_gram_transactions" ADD CONSTRAINT "money_gram_transactions_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_gram_transactions" ADD CONSTRAINT "money_gram_transactions_teller_id_fkey" FOREIGN KEY ("teller_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ria_transactions" ADD CONSTRAINT "ria_transactions_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ria_transactions" ADD CONSTRAINT "ria_transactions_teller_id_fkey" FOREIGN KEY ("teller_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "float_channel_transactions" ADD CONSTRAINT "float_channel_transactions_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "float_channel_transactions" ADD CONSTRAINT "float_channel_transactions_teller_id_fkey" FOREIGN KEY ("teller_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_movements" ADD CONSTRAINT "account_movements_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."payment_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_movements" ADD CONSTRAINT "account_movements_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_movements" ADD CONSTRAINT "account_movements_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_accounts" ADD CONSTRAINT "payment_accounts_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_accounts" ADD CONSTRAINT "payment_accounts_catalog_id_fkey" FOREIGN KEY ("catalog_id") REFERENCES "public"."account_catalog"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_pair_id_fkey" FOREIGN KEY ("pair_id") REFERENCES "public"."currency_pairs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_expenses" ADD CONSTRAINT "fee_expenses_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_expenses" ADD CONSTRAINT "fee_expenses_teller_id_fkey" FOREIGN KEY ("teller_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_expenses" ADD CONSTRAINT "fee_expenses_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_closed_by_fkey" FOREIGN KEY ("closed_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_teller_id_fkey" FOREIGN KEY ("teller_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "float_movements" ADD CONSTRAINT "float_movements_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "float_movements" ADD CONSTRAINT "float_movements_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "float_movements" ADD CONSTRAINT "float_movements_teller_id_fkey" FOREIGN KEY ("teller_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "float_movements" ADD CONSTRAINT "float_movements_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "petit_cash_entries" ADD CONSTRAINT "petit_cash_entries_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "petit_cash_entries" ADD CONSTRAINT "petit_cash_entries_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "petit_cash_entries" ADD CONSTRAINT "petit_cash_entries_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "petit_cash_entries" ADD CONSTRAINT "petit_cash_entries_teller_id_fkey" FOREIGN KEY ("teller_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_pair_id_fkey" FOREIGN KEY ("pair_id") REFERENCES "public"."currency_pairs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_recommended_by_fkey" FOREIGN KEY ("recommended_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_teller_id_fkey" FOREIGN KEY ("teller_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inter_branch_transfers" ADD CONSTRAINT "inter_branch_transfers_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inter_branch_transfers" ADD CONSTRAINT "inter_branch_transfers_from_branch_id_fkey" FOREIGN KEY ("from_branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inter_branch_transfers" ADD CONSTRAINT "inter_branch_transfers_to_branch_id_fkey" FOREIGN KEY ("to_branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_recipient_branch_fkey" FOREIGN KEY ("recipient_branch") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_branch_fkey" FOREIGN KEY ("sender_branch") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_fkey" FOREIGN KEY ("actor") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wac_inventory" ADD CONSTRAINT "wac_inventory_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "western_union_transactions" ADD CONSTRAINT "western_union_transactions_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "western_union_transactions" ADD CONSTRAINT "western_union_transactions_teller_id_fkey" FOREIGN KEY ("teller_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inter_branch_txns" ADD CONSTRAINT "inter_branch_txns_admin_reviewed_by_fkey" FOREIGN KEY ("admin_reviewed_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inter_branch_txns" ADD CONSTRAINT "inter_branch_txns_from_branch_id_fkey" FOREIGN KEY ("from_branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inter_branch_txns" ADD CONSTRAINT "inter_branch_txns_initiated_by_fkey" FOREIGN KEY ("initiated_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inter_branch_txns" ADD CONSTRAINT "inter_branch_txns_pair_id_fkey" FOREIGN KEY ("pair_id") REFERENCES "public"."currency_pairs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inter_branch_txns" ADD CONSTRAINT "inter_branch_txns_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inter_branch_txns" ADD CONSTRAINT "inter_branch_txns_to_branch_id_fkey" FOREIGN KEY ("to_branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_float_transfers" ADD CONSTRAINT "branch_float_transfers_completed_by_fkey" FOREIGN KEY ("completed_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_float_transfers" ADD CONSTRAINT "branch_float_transfers_from_branch_id_fkey" FOREIGN KEY ("from_branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_float_transfers" ADD CONSTRAINT "branch_float_transfers_initiated_by_fkey" FOREIGN KEY ("initiated_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_float_transfers" ADD CONSTRAINT "branch_float_transfers_to_branch_id_fkey" FOREIGN KEY ("to_branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tx_requests" ADD CONSTRAINT "tx_requests_branch_float_transfer_id_fkey" FOREIGN KEY ("branch_float_transfer_id") REFERENCES "public"."branch_float_transfers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tx_requests" ADD CONSTRAINT "tx_requests_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tx_requests" ADD CONSTRAINT "tx_requests_float_channel_transaction_id_fkey" FOREIGN KEY ("float_channel_transaction_id") REFERENCES "public"."float_channel_transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tx_requests" ADD CONSTRAINT "tx_requests_inter_branch_txn_id_fkey" FOREIGN KEY ("inter_branch_txn_id") REFERENCES "public"."inter_branch_txns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tx_requests" ADD CONSTRAINT "tx_requests_internal_transfer_id_fkey" FOREIGN KEY ("internal_transfer_id") REFERENCES "public"."internal_transfers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tx_requests" ADD CONSTRAINT "tx_requests_money_gram_transaction_id_fkey" FOREIGN KEY ("money_gram_transaction_id") REFERENCES "public"."money_gram_transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tx_requests" ADD CONSTRAINT "tx_requests_petit_cash_entry_id_fkey" FOREIGN KEY ("petit_cash_entry_id") REFERENCES "public"."petit_cash_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tx_requests" ADD CONSTRAINT "tx_requests_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tx_requests" ADD CONSTRAINT "tx_requests_ria_transaction_id_fkey" FOREIGN KEY ("ria_transaction_id") REFERENCES "public"."ria_transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tx_requests" ADD CONSTRAINT "tx_requests_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tx_requests" ADD CONSTRAINT "tx_requests_teller_id_fkey" FOREIGN KEY ("teller_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tx_requests" ADD CONSTRAINT "tx_requests_tx_id_fkey" FOREIGN KEY ("tx_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tx_requests" ADD CONSTRAINT "tx_requests_western_union_transaction_id_fkey" FOREIGN KEY ("western_union_transaction_id") REFERENCES "public"."western_union_transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "super_teller_accounts" ADD CONSTRAINT "super_teller_accounts_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."payment_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "super_teller_accounts" ADD CONSTRAINT "super_teller_accounts_super_teller_id_fkey" FOREIGN KEY ("super_teller_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teller_schedules" ADD CONSTRAINT "teller_schedules_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teller_schedules" ADD CONSTRAINT "teller_schedules_teller_id_fkey" FOREIGN KEY ("teller_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ift_branch" ON "internal_transfers" USING btree ("branch_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_ift_teller" ON "internal_transfers" USING btree ("initiated_by" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_mg_branch" ON "money_gram_transactions" USING btree ("branch_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_mg_created" ON "money_gram_transactions" USING btree ("created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_mg_teller" ON "money_gram_transactions" USING btree ("teller_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_ria_branch" ON "ria_transactions" USING btree ("branch_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_ria_created" ON "ria_transactions" USING btree ("created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_ria_teller" ON "ria_transactions" USING btree ("teller_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_fct_branch" ON "float_channel_transactions" USING btree ("branch_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_fct_channel" ON "float_channel_transactions" USING btree ("channel" text_ops);--> statement-breakpoint
CREATE INDEX "idx_fct_created" ON "float_channel_transactions" USING btree ("created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_fct_teller" ON "float_channel_transactions" USING btree ("teller_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_am_account" ON "account_movements" USING btree ("account_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_am_created" ON "account_movements" USING btree ("created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_am_tx" ON "account_movements" USING btree ("transaction_id" uuid_ops) WHERE (transaction_id IS NOT NULL);--> statement-breakpoint
CREATE UNIQUE INDEX "pa_name_branch_idx" ON "payment_accounts" USING btree ("name" text_ops,"branch_id" text_ops) WHERE (branch_id IS NOT NULL);--> statement-breakpoint
CREATE UNIQUE INDEX "pa_name_global_idx" ON "payment_accounts" USING btree ("name" text_ops) WHERE (branch_id IS NULL);--> statement-breakpoint
CREATE INDEX "idx_rates_active" ON "exchange_rates" USING btree ("pair_id" uuid_ops,"active" bool_ops,"effective_from" timestamptz_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "idx_rates_one_active_per_pair" ON "exchange_rates" USING btree ("pair_id" uuid_ops) WHERE (active = true);--> statement-breakpoint
CREATE INDEX "idx_rates_pair" ON "exchange_rates" USING btree ("pair_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_shifts_branch" ON "shifts" USING btree ("branch_id" uuid_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "idx_shifts_one_active_per_teller" ON "shifts" USING btree ("teller_id" uuid_ops) WHERE (status = ANY (ARRAY['open'::text, 'pending_close'::text, 'rejected'::text]));--> statement-breakpoint
CREATE UNIQUE INDEX "idx_shifts_one_open_per_branch" ON "shifts" USING btree ("branch_id" uuid_ops) WHERE (status = 'open'::text);--> statement-breakpoint
CREATE INDEX "idx_shifts_opened" ON "shifts" USING btree ("opened_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_shifts_status" ON "shifts" USING btree ("status" text_ops);--> statement-breakpoint
CREATE INDEX "idx_shifts_teller" ON "shifts" USING btree ("teller_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_float_branch" ON "float_movements" USING btree ("branch_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_float_created" ON "float_movements" USING btree ("created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_petit_branch" ON "petit_cash_entries" USING btree ("branch_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_petit_shift" ON "petit_cash_entries" USING btree ("shift_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_petit_teller" ON "petit_cash_entries" USING btree ("teller_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_txn_branch" ON "transactions" USING btree ("branch_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_txn_created" ON "transactions" USING btree ("created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_txn_shift" ON "transactions" USING btree ("shift_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_txn_status" ON "transactions" USING btree ("payment_status" text_ops);--> statement-breakpoint
CREATE INDEX "idx_txn_teller" ON "transactions" USING btree ("teller_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_ledger_branch" ON "ledger_entries" USING btree ("branch_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_ledger_status" ON "ledger_entries" USING btree ("status" text_ops);--> statement-breakpoint
CREATE INDEX "idx_itr_from" ON "inter_branch_transfers" USING btree ("from_branch_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_itr_to" ON "inter_branch_transfers" USING btree ("to_branch_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_notif_created" ON "notifications" USING btree ("created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_notif_read" ON "notifications" USING btree ("read" bool_ops);--> statement-breakpoint
CREATE INDEX "idx_notif_recipient" ON "notifications" USING btree ("recipient_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_msg_r_branch" ON "messages" USING btree ("recipient_branch" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_msg_recipient" ON "messages" USING btree ("recipient_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_msg_sender" ON "messages" USING btree ("sender_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_msg_sent" ON "messages" USING btree ("sent_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_audit_actor" ON "audit_logs" USING btree ("actor" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_audit_created" ON "audit_logs" USING btree ("created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_wu_branch" ON "western_union_transactions" USING btree ("branch_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_wu_created" ON "western_union_transactions" USING btree ("created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_wu_teller" ON "western_union_transactions" USING btree ("teller_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_ibt_from" ON "inter_branch_txns" USING btree ("from_branch_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_ibt_status" ON "inter_branch_txns" USING btree ("status" text_ops);--> statement-breakpoint
CREATE INDEX "idx_ibt_to" ON "inter_branch_txns" USING btree ("to_branch_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_bft_from" ON "branch_float_transfers" USING btree ("from_branch_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_bft_status" ON "branch_float_transfers" USING btree ("status" text_ops);--> statement-breakpoint
CREATE INDEX "idx_bft_to" ON "branch_float_transfers" USING btree ("to_branch_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_txreq_branch" ON "tx_requests" USING btree ("branch_id" uuid_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "idx_txreq_one_pending_per_ref" ON "tx_requests" USING btree ("tx_ref" text_ops) WHERE ((status = 'pending'::text) AND (request_type = ANY (ARRAY['edit'::text, 'delete'::text])) AND (tx_ref IS NOT NULL));--> statement-breakpoint
CREATE INDEX "idx_txreq_status" ON "tx_requests" USING btree ("status" text_ops);--> statement-breakpoint
CREATE INDEX "idx_sta_teller" ON "super_teller_accounts" USING btree ("super_teller_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_sched_branch" ON "teller_schedules" USING btree ("branch_id" uuid_ops);--> statement-breakpoint
CREATE POLICY "it_select" ON "internal_transfers" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((is_admin() OR is_accountant() OR is_super_teller() OR (current_profile_branch_id() = branch_id)));--> statement-breakpoint
CREATE POLICY "it_insert" ON "internal_transfers" AS PERMISSIVE FOR INSERT TO "authenticated";--> statement-breakpoint
CREATE POLICY "it_update" ON "internal_transfers" AS PERMISSIVE FOR UPDATE TO "authenticated";--> statement-breakpoint
CREATE POLICY "it_delete" ON "internal_transfers" AS PERMISSIVE FOR DELETE TO "authenticated";--> statement-breakpoint
CREATE POLICY "mg_accountant_insert" ON "money_gram_transactions" AS PERMISSIVE FOR INSERT TO public WITH CHECK (is_accountant());--> statement-breakpoint
CREATE POLICY "mg_admin_all" ON "money_gram_transactions" AS PERMISSIVE FOR ALL TO public;--> statement-breakpoint
CREATE POLICY "mg_teller_insert" ON "money_gram_transactions" AS PERMISSIVE FOR INSERT TO public;--> statement-breakpoint
CREATE POLICY "mg_read" ON "money_gram_transactions" AS PERMISSIVE FOR SELECT TO public;--> statement-breakpoint
CREATE POLICY "mg_update" ON "money_gram_transactions" AS PERMISSIVE FOR UPDATE TO public;--> statement-breakpoint
CREATE POLICY "ria_accountant_insert" ON "ria_transactions" AS PERMISSIVE FOR INSERT TO public WITH CHECK (is_accountant());--> statement-breakpoint
CREATE POLICY "ria_admin_all" ON "ria_transactions" AS PERMISSIVE FOR ALL TO public;--> statement-breakpoint
CREATE POLICY "ria_teller_insert" ON "ria_transactions" AS PERMISSIVE FOR INSERT TO public;--> statement-breakpoint
CREATE POLICY "ria_read" ON "ria_transactions" AS PERMISSIVE FOR SELECT TO public;--> statement-breakpoint
CREATE POLICY "ria_update" ON "ria_transactions" AS PERMISSIVE FOR UPDATE TO public;--> statement-breakpoint
CREATE POLICY "fct_accountant_insert" ON "float_channel_transactions" AS PERMISSIVE FOR INSERT TO public WITH CHECK (is_accountant());--> statement-breakpoint
CREATE POLICY "fct_update" ON "float_channel_transactions" AS PERMISSIVE FOR UPDATE TO public;--> statement-breakpoint
CREATE POLICY "fct_admin_all" ON "float_channel_transactions" AS PERMISSIVE FOR ALL TO public;--> statement-breakpoint
CREATE POLICY "fct_teller_insert" ON "float_channel_transactions" AS PERMISSIVE FOR INSERT TO public;--> statement-breakpoint
CREATE POLICY "fct_read" ON "float_channel_transactions" AS PERMISSIVE FOR SELECT TO public;--> statement-breakpoint
CREATE POLICY "pairs_read" ON "currency_pairs" AS PERMISSIVE FOR SELECT TO public USING (true);--> statement-breakpoint
CREATE POLICY "pairs_admin_all" ON "currency_pairs" AS PERMISSIVE FOR ALL TO public;--> statement-breakpoint
CREATE POLICY "profiles_self" ON "profiles" AS PERMISSIVE FOR SELECT TO public USING ((id = auth.uid()));--> statement-breakpoint
CREATE POLICY "profiles_admin_all" ON "profiles" AS PERMISSIVE FOR ALL TO public;--> statement-breakpoint
CREATE POLICY "profiles_read_authed" ON "profiles" AS PERMISSIVE FOR SELECT TO "authenticated";--> statement-breakpoint
CREATE POLICY "am_update" ON "account_movements" AS PERMISSIVE FOR UPDATE TO public USING ((is_admin() OR is_accountant())) WITH CHECK ((is_admin() OR is_accountant()));--> statement-breakpoint
CREATE POLICY "am_write" ON "account_movements" AS PERMISSIVE FOR INSERT TO "authenticated";--> statement-breakpoint
CREATE POLICY "am_read" ON "account_movements" AS PERMISSIVE FOR SELECT TO "authenticated";--> statement-breakpoint
CREATE POLICY "pa_insert" ON "payment_accounts" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((is_admin() OR is_accountant() OR is_super_teller()));--> statement-breakpoint
CREATE POLICY "pa_delete" ON "payment_accounts" AS PERMISSIVE FOR DELETE TO "authenticated";--> statement-breakpoint
CREATE POLICY "payment_accounts update" ON "payment_accounts" AS PERMISSIVE FOR UPDATE TO "authenticated";--> statement-breakpoint
CREATE POLICY "pa_read" ON "payment_accounts" AS PERMISSIVE FOR SELECT TO "authenticated";--> statement-breakpoint
CREATE POLICY "branches_read" ON "branches" AS PERMISSIVE FOR SELECT TO public USING (true);--> statement-breakpoint
CREATE POLICY "branches_admin_all" ON "branches" AS PERMISSIVE FOR ALL TO public;--> statement-breakpoint
CREATE POLICY "currencies_read" ON "currencies" AS PERMISSIVE FOR SELECT TO public USING (true);--> statement-breakpoint
CREATE POLICY "currencies_admin_all" ON "currencies" AS PERMISSIVE FOR ALL TO public;--> statement-breakpoint
CREATE POLICY "rates_read" ON "exchange_rates" AS PERMISSIVE FOR SELECT TO public USING (true);--> statement-breakpoint
CREATE POLICY "rates_admin" ON "exchange_rates" AS PERMISSIVE FOR ALL TO public;--> statement-breakpoint
CREATE POLICY "settings_read" ON "system_settings" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "settings_admin" ON "system_settings" AS PERMISSIVE FOR ALL TO "authenticated";--> statement-breakpoint
CREATE POLICY "catalog_read" ON "account_catalog" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "catalog_admin" ON "account_catalog" AS PERMISSIVE FOR ALL TO "authenticated";--> statement-breakpoint
CREATE POLICY "fee_access" ON "fee_expenses" AS PERMISSIVE FOR ALL TO public USING (((teller_id = auth.uid()) OR is_admin() OR is_accountant() OR is_auditor() OR is_branch_manager()));--> statement-breakpoint
CREATE POLICY "shifts_own_teller" ON "shifts" AS PERMISSIVE FOR ALL TO public USING (((teller_id = auth.uid()) OR is_admin() OR is_accountant() OR (is_branch_manager() AND (branch_id = current_profile_branch_id())))) WITH CHECK (((teller_id = auth.uid()) OR is_admin() OR is_accountant()));--> statement-breakpoint
CREATE POLICY "float_movements teller read" ON "float_movements" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((current_profile_role() = ANY (ARRAY['admin'::text, 'accountant'::text, 'auditor'::text, 'branch_manager'::text, 'super_teller'::text])) OR (branch_id = current_profile_branch_id())));--> statement-breakpoint
CREATE POLICY "float_read" ON "float_movements" AS PERMISSIVE FOR SELECT TO public;--> statement-breakpoint
CREATE POLICY "float_insert_admin" ON "float_movements" AS PERMISSIVE FOR INSERT TO public;--> statement-breakpoint
CREATE POLICY "petit_insert_admin" ON "petit_cash_entries" AS PERMISSIVE FOR INSERT TO public WITH CHECK ((is_admin() OR is_accountant()));--> statement-breakpoint
CREATE POLICY "petit_read" ON "petit_cash_entries" AS PERMISSIVE FOR SELECT TO public;--> statement-breakpoint
CREATE POLICY "petit_delete" ON "petit_cash_entries" AS PERMISSIVE FOR DELETE TO public;--> statement-breakpoint
CREATE POLICY "petit_insert" ON "petit_cash_entries" AS PERMISSIVE FOR INSERT TO public;--> statement-breakpoint
CREATE POLICY "petit_update" ON "petit_cash_entries" AS PERMISSIVE FOR UPDATE TO public;--> statement-breakpoint
CREATE POLICY "txn_accountant_insert" ON "transactions" AS PERMISSIVE FOR INSERT TO public WITH CHECK (is_accountant());--> statement-breakpoint
CREATE POLICY "txn_admin_all" ON "transactions" AS PERMISSIVE FOR ALL TO public;--> statement-breakpoint
CREATE POLICY "txn_teller_insert" ON "transactions" AS PERMISSIVE FOR INSERT TO public;--> statement-breakpoint
CREATE POLICY "txn_read" ON "transactions" AS PERMISSIVE FOR SELECT TO public;--> statement-breakpoint
CREATE POLICY "txn_update" ON "transactions" AS PERMISSIVE FOR UPDATE TO public;--> statement-breakpoint
CREATE POLICY "ledger_entries branch_manager insert" ON "ledger_entries" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((current_profile_role() = ANY (ARRAY['admin'::text, 'accountant'::text, 'branch_manager'::text, 'teller'::text, 'super_teller'::text])));--> statement-breakpoint
CREATE POLICY "ledger_admin" ON "ledger_entries" AS PERMISSIVE FOR ALL TO public;--> statement-breakpoint
CREATE POLICY "ledger_read" ON "ledger_entries" AS PERMISSIVE FOR SELECT TO public;--> statement-breakpoint
CREATE POLICY "ledger_insert" ON "ledger_entries" AS PERMISSIVE FOR INSERT TO public;--> statement-breakpoint
CREATE POLICY "ledger_update" ON "ledger_entries" AS PERMISSIVE FOR UPDATE TO public;--> statement-breakpoint
CREATE POLICY "ibr_select" ON "inter_branch_transfers" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "ibr_write" ON "inter_branch_transfers" AS PERMISSIVE FOR ALL TO "authenticated";--> statement-breakpoint
CREATE POLICY "notif_select" ON "notifications" AS PERMISSIVE FOR SELECT TO public USING (((recipient_id IS NULL) OR (recipient_id = auth.uid())));--> statement-breakpoint
CREATE POLICY "notif_insert" ON "notifications" AS PERMISSIVE FOR INSERT TO "authenticated";--> statement-breakpoint
CREATE POLICY "notif_update" ON "notifications" AS PERMISSIVE FOR UPDATE TO public;--> statement-breakpoint
CREATE POLICY "msg_insert" ON "messages" AS PERMISSIVE FOR INSERT TO public WITH CHECK ((sender_id = auth.uid()));--> statement-breakpoint
CREATE POLICY "msg_read" ON "messages" AS PERMISSIVE FOR SELECT TO public;--> statement-breakpoint
CREATE POLICY "audit_read" ON "audit_logs" AS PERMISSIVE FOR SELECT TO public USING ((is_admin() OR is_auditor()));--> statement-breakpoint
CREATE POLICY "wac_inventory read" ON "wac_inventory" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "wac_inventory write" ON "wac_inventory" AS PERMISSIVE FOR ALL TO "authenticated";--> statement-breakpoint
CREATE POLICY "wu_accountant_insert" ON "western_union_transactions" AS PERMISSIVE FOR INSERT TO public WITH CHECK (is_accountant());--> statement-breakpoint
CREATE POLICY "wu_admin_all" ON "western_union_transactions" AS PERMISSIVE FOR ALL TO public;--> statement-breakpoint
CREATE POLICY "wu_teller_insert" ON "western_union_transactions" AS PERMISSIVE FOR INSERT TO public;--> statement-breakpoint
CREATE POLICY "wu_update" ON "western_union_transactions" AS PERMISSIVE FOR UPDATE TO public;--> statement-breakpoint
CREATE POLICY "wu_read" ON "western_union_transactions" AS PERMISSIVE FOR SELECT TO "authenticated";--> statement-breakpoint
CREATE POLICY "ibt_insert" ON "inter_branch_txns" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((is_admin() OR is_accountant() OR is_super_teller() OR ((current_profile_branch_id() = from_branch_id) AND (current_profile_role() <> 'auditor'::text))));--> statement-breakpoint
CREATE POLICY "ibt_update" ON "inter_branch_txns" AS PERMISSIVE FOR UPDATE TO "authenticated";--> statement-breakpoint
CREATE POLICY "ibt_delete" ON "inter_branch_txns" AS PERMISSIVE FOR DELETE TO "authenticated";--> statement-breakpoint
CREATE POLICY "ibt_select" ON "inter_branch_txns" AS PERMISSIVE FOR SELECT TO "authenticated";--> statement-breakpoint
CREATE POLICY "bft_select" ON "branch_float_transfers" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "bft_insert" ON "branch_float_transfers" AS PERMISSIVE FOR INSERT TO "authenticated";--> statement-breakpoint
CREATE POLICY "bft_update" ON "branch_float_transfers" AS PERMISSIVE FOR UPDATE TO "authenticated";--> statement-breakpoint
CREATE POLICY "bft_delete" ON "branch_float_transfers" AS PERMISSIVE FOR DELETE TO "authenticated";--> statement-breakpoint
CREATE POLICY "txreq_select" ON "tx_requests" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((teller_id = auth.uid()) OR is_admin() OR is_accountant() OR is_auditor() OR is_super_teller()));--> statement-breakpoint
CREATE POLICY "txreq_insert" ON "tx_requests" AS PERMISSIVE FOR INSERT TO "authenticated";--> statement-breakpoint
CREATE POLICY "txreq_update" ON "tx_requests" AS PERMISSIVE FOR UPDATE TO "authenticated";--> statement-breakpoint
CREATE POLICY "sta_select" ON "super_teller_accounts" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "sta_admin_write" ON "super_teller_accounts" AS PERMISSIVE FOR ALL TO "authenticated";--> statement-breakpoint
CREATE POLICY "schedules_read" ON "teller_schedules" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "schedules_admin" ON "teller_schedules" AS PERMISSIVE FOR ALL TO "authenticated";
*/