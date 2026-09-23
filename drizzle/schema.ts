import { pgTable, index, foreignKey, unique, pgPolicy, check, uuid, text, numeric, boolean, timestamp, uniqueIndex, jsonb, date, primaryKey, integer } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"



export const internalTransfers = pgTable("internal_transfers", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	reference: text().default(generate_reference(\'IFT\'::text)).notNull(),
	branchId: uuid("branch_id").notNull(),
	fromAccount: text("from_account").notNull(),
	toAccount: text("to_account").notNull(),
	fromCurrency: text("from_currency").notNull(),
	toCurrency: text("to_currency").notNull(),
	amount: numeric({ precision: 20, scale:  4 }).notNull(),
	convertedAmount: numeric("converted_amount", { precision: 20, scale:  4 }).notNull(),
	feeAmount: numeric("fee_amount", { precision: 20, scale:  4 }).default('0').notNull(),
	amountRwf: numeric("amount_rwf", { precision: 20, scale:  2 }).default('0').notNull(),
	feeRwf: numeric("fee_rwf", { precision: 20, scale:  2 }).default('0').notNull(),
	note: text(),
	initiatedBy: uuid("initiated_by"),
	voided: boolean().default(false).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_ift_branch").using("btree", table.branchId.asc().nullsLast().op("uuid_ops")),
	index("idx_ift_teller").using("btree", table.initiatedBy.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.branchId],
			foreignColumns: [branches.id],
			name: "internal_transfers_branch_id_fkey"
		}),
	foreignKey({
			columns: [table.initiatedBy],
			foreignColumns: [profiles.id],
			name: "internal_transfers_initiated_by_fkey"
		}).onDelete("set null"),
	unique("internal_transfers_reference_key").on(table.reference),
	pgPolicy("it_select", { as: "permissive", for: "select", to: ["authenticated"], using: sql`(is_admin() OR is_accountant() OR is_super_teller() OR (current_profile_branch_id() = branch_id))` }),
	pgPolicy("it_insert", { as: "permissive", for: "insert", to: ["authenticated"] }),
	pgPolicy("it_update", { as: "permissive", for: "update", to: ["authenticated"] }),
	pgPolicy("it_delete", { as: "permissive", for: "delete", to: ["authenticated"] }),
	check("internal_transfers_amount_check", sql`amount > (0)::numeric`),
]);

export const moneyGramTransactions = pgTable("money_gram_transactions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	reference: text().notNull(),
	type: text().notNull(),
	currency: text().notNull(),
	amount: numeric({ precision: 20, scale:  2 }).notNull(),
	rateApplied: numeric("rate_applied", { precision: 18, scale:  6 }),
	equivalentRwf: numeric("equivalent_rwf", { precision: 20, scale:  2 }).notNull(),
	amountPaid: numeric("amount_paid", { precision: 20, scale:  2 }).notNull(),
	sourceAccount: text("source_account").notNull(),
	destAccount: text("dest_account").notNull(),
	payCurrency: text("pay_currency").default('single').notNull(),
	payRwf: numeric("pay_rwf", { precision: 20, scale:  2 }),
	payFx: numeric("pay_fx", { precision: 20, scale:  2 }),
	branchId: uuid("branch_id").notNull(),
	tellerId: uuid("teller_id"),
	customerName: text("customer_name"),
	notes: text(),
	status: text().default('completed').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_mg_branch").using("btree", table.branchId.asc().nullsLast().op("uuid_ops")),
	index("idx_mg_created").using("btree", table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	index("idx_mg_teller").using("btree", table.tellerId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.branchId],
			foreignColumns: [branches.id],
			name: "money_gram_transactions_branch_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.tellerId],
			foreignColumns: [profiles.id],
			name: "money_gram_transactions_teller_id_fkey"
		}).onDelete("set null"),
	unique("money_gram_transactions_reference_key").on(table.reference),
	pgPolicy("mg_accountant_insert", { as: "permissive", for: "insert", to: ["public"], withCheck: sql`is_accountant()`  }),
	pgPolicy("mg_admin_all", { as: "permissive", for: "all", to: ["public"] }),
	pgPolicy("mg_teller_insert", { as: "permissive", for: "insert", to: ["public"] }),
	pgPolicy("mg_read", { as: "permissive", for: "select", to: ["public"] }),
	pgPolicy("mg_update", { as: "permissive", for: "update", to: ["public"] }),
	check("money_gram_transactions_amount_check", sql`amount > (0)::numeric`),
	check("money_gram_transactions_currency_check", sql`currency = ANY (ARRAY['USD'::text, 'RWF'::text])`),
	check("money_gram_transactions_pay_currency_check", sql`pay_currency = ANY (ARRAY['single'::text, 'split'::text, 'usd'::text])`),
	check("money_gram_transactions_type_check", sql`type = ANY (ARRAY['receive'::text, 'send'::text])`),
]);

export const riaTransactions = pgTable("ria_transactions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	reference: text().notNull(),
	type: text().notNull(),
	amount: numeric({ precision: 20, scale:  2 }).notNull(),
	amountPaid: numeric("amount_paid", { precision: 20, scale:  2 }).notNull(),
	sourceAccount: text("source_account").notNull(),
	destAccount: text("dest_account").notNull(),
	branchId: uuid("branch_id").notNull(),
	tellerId: uuid("teller_id"),
	customerName: text("customer_name"),
	notes: text(),
	status: text().default('completed').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_ria_branch").using("btree", table.branchId.asc().nullsLast().op("uuid_ops")),
	index("idx_ria_created").using("btree", table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	index("idx_ria_teller").using("btree", table.tellerId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.branchId],
			foreignColumns: [branches.id],
			name: "ria_transactions_branch_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.tellerId],
			foreignColumns: [profiles.id],
			name: "ria_transactions_teller_id_fkey"
		}).onDelete("set null"),
	unique("ria_transactions_reference_key").on(table.reference),
	pgPolicy("ria_accountant_insert", { as: "permissive", for: "insert", to: ["public"], withCheck: sql`is_accountant()`  }),
	pgPolicy("ria_admin_all", { as: "permissive", for: "all", to: ["public"] }),
	pgPolicy("ria_teller_insert", { as: "permissive", for: "insert", to: ["public"] }),
	pgPolicy("ria_read", { as: "permissive", for: "select", to: ["public"] }),
	pgPolicy("ria_update", { as: "permissive", for: "update", to: ["public"] }),
	check("ria_transactions_amount_check", sql`amount > (0)::numeric`),
	check("ria_transactions_type_check", sql`type = ANY (ARRAY['receive'::text, 'send'::text])`),
]);

export const floatChannelTransactions = pgTable("float_channel_transactions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	reference: text().notNull(),
	channel: text().notNull(),
	type: text().notNull(),
	amount: numeric({ precision: 20, scale:  2 }).notNull(),
	sourceAccount: text("source_account").notNull(),
	destAccount: text("dest_account").notNull(),
	branchId: uuid("branch_id").notNull(),
	tellerId: uuid("teller_id"),
	notes: text(),
	status: text().default('completed').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	currency: text().default('RWF').notNull(),
}, (table) => [
	index("idx_fct_branch").using("btree", table.branchId.asc().nullsLast().op("uuid_ops")),
	index("idx_fct_channel").using("btree", table.channel.asc().nullsLast().op("text_ops")),
	index("idx_fct_created").using("btree", table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	index("idx_fct_teller").using("btree", table.tellerId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.branchId],
			foreignColumns: [branches.id],
			name: "float_channel_transactions_branch_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.tellerId],
			foreignColumns: [profiles.id],
			name: "float_channel_transactions_teller_id_fkey"
		}).onDelete("set null"),
	unique("float_channel_transactions_reference_key").on(table.reference),
	pgPolicy("fct_accountant_insert", { as: "permissive", for: "insert", to: ["public"], withCheck: sql`is_accountant()`  }),
	pgPolicy("fct_update", { as: "permissive", for: "update", to: ["public"] }),
	pgPolicy("fct_admin_all", { as: "permissive", for: "all", to: ["public"] }),
	pgPolicy("fct_teller_insert", { as: "permissive", for: "insert", to: ["public"] }),
	pgPolicy("fct_read", { as: "permissive", for: "select", to: ["public"] }),
	check("float_channel_transactions_amount_check", sql`amount > (0)::numeric`),
	check("float_channel_transactions_channel_check", sql`channel = ANY (ARRAY['bk'::text, 'equity'::text, 'amin'::text])`),
	check("float_channel_transactions_type_check", sql`type = ANY (ARRAY['deposit'::text, 'withdraw'::text])`),
]);

export const currencyPairs = pgTable("currency_pairs", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	code: text().notNull(),
	baseCurrency: text("base_currency").notNull(),
	quoteCurrency: text("quote_currency").default('RWF').notNull(),
	active: boolean().default(true).notNull(),
	midRate: numeric("mid_rate", { precision: 18, scale:  6 }),
	thresholdAmount: numeric("threshold_amount", { precision: 20, scale:  2 }),
	thresholdBuy: numeric("threshold_buy", { precision: 20, scale:  2 }),
	thresholdSell: numeric("threshold_sell", { precision: 20, scale:  2 }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("currency_pairs_code_key").on(table.code),
	pgPolicy("pairs_read", { as: "permissive", for: "select", to: ["public"], using: sql`true` }),
	pgPolicy("pairs_admin_all", { as: "permissive", for: "all", to: ["public"] }),
]);

export const profiles = pgTable("profiles", {
	id: uuid().primaryKey().notNull(),
	fullName: text("full_name"),
	role: text().notNull(),
	branchId: uuid("branch_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	active: boolean().default(true).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.branchId],
			foreignColumns: [branches.id],
			name: "profiles_branch_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.id],
			foreignColumns: [users.id],
			name: "profiles_id_fkey"
		}).onDelete("cascade"),
	pgPolicy("profiles_self", { as: "permissive", for: "select", to: ["public"], using: sql`(id = auth.uid())` }),
	pgPolicy("profiles_admin_all", { as: "permissive", for: "all", to: ["public"] }),
	pgPolicy("profiles_read_authed", { as: "permissive", for: "select", to: ["authenticated"] }),
	check("profiles_role_check", sql`role = ANY (ARRAY['admin'::text, 'auditor'::text, 'accountant'::text, 'teller'::text, 'super_teller'::text, 'branch_manager'::text])`),
]);

export const accountMovements = pgTable("account_movements", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	accountId: uuid("account_id").notNull(),
	transactionId: uuid("transaction_id"),
	shiftId: uuid("shift_id"),
	direction: text().notNull(),
	amountRwf: numeric("amount_rwf", { precision: 20, scale:  4 }).notNull(),
	amountForeign: numeric("amount_foreign", { precision: 20, scale:  4 }),
	currency: text(),
	description: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	sourceType: text("source_type").default('float').notNull(),
	voided: boolean().default(false).notNull(),
}, (table) => [
	index("idx_am_account").using("btree", table.accountId.asc().nullsLast().op("uuid_ops")),
	index("idx_am_created").using("btree", table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	index("idx_am_tx").using("btree", table.transactionId.asc().nullsLast().op("uuid_ops")).where(sql`(transaction_id IS NOT NULL)`),
	foreignKey({
			columns: [table.accountId],
			foreignColumns: [paymentAccounts.id],
			name: "account_movements_account_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.shiftId],
			foreignColumns: [shifts.id],
			name: "account_movements_shift_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.transactionId],
			foreignColumns: [transactions.id],
			name: "account_movements_transaction_id_fkey"
		}).onDelete("set null"),
	pgPolicy("am_update", { as: "permissive", for: "update", to: ["public"], using: sql`(is_admin() OR is_accountant())`, withCheck: sql`(is_admin() OR is_accountant())`  }),
	pgPolicy("am_write", { as: "permissive", for: "insert", to: ["authenticated"] }),
	pgPolicy("am_read", { as: "permissive", for: "select", to: ["authenticated"] }),
	check("account_movements_direction_amount_foreign_check", sql`(amount_foreign IS NULL) OR ((direction = 'in'::text) AND (amount_foreign >= (0)::numeric)) OR ((direction = 'out'::text) AND (amount_foreign <= (0)::numeric)))) NOT VALID`),
	check("account_movements_direction_check", sql`direction = ANY (ARRAY['in'::text, 'out'::text])`),
	check("account_movements_source_type_check", sql`source_type = ANY (ARRAY['float'::text, 'equity'::text])`),
]);

export const paymentAccounts = pgTable("payment_accounts", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	name: text().notNull(),
	branchId: uuid("branch_id"),
	balanceRwf: numeric("balance_rwf", { precision: 20, scale:  4 }).default('0').notNull(),
	balanceFx: jsonb("balance_fx").default({}).notNull(),
	currencies: text().array().default([""]).notNull(),
	active: boolean().default(true).notNull(),
	type: text(),
	catalogId: uuid("catalog_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("pa_name_branch_idx").using("btree", table.name.asc().nullsLast().op("text_ops"), table.branchId.asc().nullsLast().op("text_ops")).where(sql`(branch_id IS NOT NULL)`),
	uniqueIndex("pa_name_global_idx").using("btree", table.name.asc().nullsLast().op("text_ops")).where(sql`(branch_id IS NULL)`),
	foreignKey({
			columns: [table.branchId],
			foreignColumns: [branches.id],
			name: "payment_accounts_branch_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.catalogId],
			foreignColumns: [accountCatalog.id],
			name: "payment_accounts_catalog_id_fkey"
		}).onDelete("set null"),
	pgPolicy("pa_insert", { as: "permissive", for: "insert", to: ["authenticated"], withCheck: sql`(is_admin() OR is_accountant() OR is_super_teller())`  }),
	pgPolicy("pa_delete", { as: "permissive", for: "delete", to: ["authenticated"] }),
	pgPolicy("payment_accounts update", { as: "permissive", for: "update", to: ["authenticated"] }),
	pgPolicy("pa_read", { as: "permissive", for: "select", to: ["authenticated"] }),
]);

export const branches = pgTable("branches", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	code: text().notNull(),
	name: text().notNull(),
	address: text(),
	phone: text(),
	email: text(),
	active: boolean().default(true).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("branches_code_key").on(table.code),
	pgPolicy("branches_read", { as: "permissive", for: "select", to: ["public"], using: sql`true` }),
	pgPolicy("branches_admin_all", { as: "permissive", for: "all", to: ["public"] }),
]);

export const currencies = pgTable("currencies", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	code: text().notNull(),
	name: text().notNull(),
	symbol: text(),
	active: boolean().default(true).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("currencies_code_key").on(table.code),
	pgPolicy("currencies_read", { as: "permissive", for: "select", to: ["public"], using: sql`true` }),
	pgPolicy("currencies_admin_all", { as: "permissive", for: "all", to: ["public"] }),
]);

export const exchangeRates = pgTable("exchange_rates", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	pairId: uuid("pair_id").notNull(),
	buy: numeric({ precision: 18, scale:  6 }).notNull(),
	sell: numeric({ precision: 18, scale:  6 }).notNull(),
	effectiveFrom: timestamp("effective_from", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	active: boolean().default(true).notNull(),
	createdBy: uuid("created_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_rates_active").using("btree", table.pairId.asc().nullsLast().op("uuid_ops"), table.active.asc().nullsLast().op("bool_ops"), table.effectiveFrom.desc().nullsFirst().op("timestamptz_ops")),
	uniqueIndex("idx_rates_one_active_per_pair").using("btree", table.pairId.asc().nullsLast().op("uuid_ops")).where(sql`(active = true)`),
	index("idx_rates_pair").using("btree", table.pairId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [users.id],
			name: "exchange_rates_created_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.pairId],
			foreignColumns: [currencyPairs.id],
			name: "exchange_rates_pair_id_fkey"
		}).onDelete("cascade"),
	pgPolicy("rates_read", { as: "permissive", for: "select", to: ["public"], using: sql`true` }),
	pgPolicy("rates_admin", { as: "permissive", for: "all", to: ["public"] }),
]);

export const systemSettings = pgTable("system_settings", {
	key: text().primaryKey().notNull(),
	value: jsonb().default("").notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedBy: uuid("updated_by"),
}, (table) => [
	foreignKey({
			columns: [table.updatedBy],
			foreignColumns: [users.id],
			name: "system_settings_updated_by_fkey"
		}).onDelete("set null"),
	pgPolicy("settings_read", { as: "permissive", for: "select", to: ["authenticated"], using: sql`true` }),
	pgPolicy("settings_admin", { as: "permissive", for: "all", to: ["authenticated"] }),
]);

export const accountCatalog = pgTable("account_catalog", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	name: text().notNull(),
	description: text(),
	currencies: text().array().default([""]).notNull(),
	active: boolean().default(true).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("account_catalog_name_key").on(table.name),
	pgPolicy("catalog_read", { as: "permissive", for: "select", to: ["authenticated"], using: sql`true` }),
	pgPolicy("catalog_admin", { as: "permissive", for: "all", to: ["authenticated"] }),
]);

export const feeExpenses = pgTable("fee_expenses", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	transactionId: uuid("transaction_id"),
	txRef: text("tx_ref").notNull(),
	feeType: text("fee_type").notNull(),
	amountFx: numeric("amount_fx", { precision: 20, scale:  4 }).default('0').notNull(),
	amountRwf: numeric("amount_rwf", { precision: 20, scale:  2 }).notNull(),
	buyRate: numeric("buy_rate", { precision: 18, scale:  6 }).notNull(),
	sellRate: numeric("sell_rate", { precision: 18, scale:  6 }).notNull(),
	currency: text().notNull(),
	tellerId: uuid("teller_id"),
	branchId: uuid("branch_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.branchId],
			foreignColumns: [branches.id],
			name: "fee_expenses_branch_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.tellerId],
			foreignColumns: [profiles.id],
			name: "fee_expenses_teller_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.transactionId],
			foreignColumns: [transactions.id],
			name: "fee_expenses_transaction_id_fkey"
		}).onDelete("cascade"),
	pgPolicy("fee_access", { as: "permissive", for: "all", to: ["public"], using: sql`((teller_id = auth.uid()) OR is_admin() OR is_accountant() OR is_auditor() OR is_branch_manager())` }),
	check("fee_expenses_fee_type_check", sql`fee_type = ANY (ARRAY['explicit'::text, 'implicit'::text])`),
]);

export const shifts = pgTable("shifts", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	tellerId: uuid("teller_id").notNull(),
	branchId: uuid("branch_id").notNull(),
	status: text().default('open').notNull(),
	openedAt: timestamp("opened_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	closedAt: timestamp("closed_at", { withTimezone: true, mode: 'string' }),
	closedBy: uuid("closed_by"),
	openingFloat: jsonb("opening_float").default({}).notNull(),
	closingCalculated: jsonb("closing_calculated"),
	closingDeclared: jsonb("closing_declared"),
	declaredBalances: jsonb("declared_balances"),
	discrepancy: jsonb(),
	rejectionReason: text("rejection_reason"),
}, (table) => [
	index("idx_shifts_branch").using("btree", table.branchId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("idx_shifts_one_active_per_teller").using("btree", table.tellerId.asc().nullsLast().op("uuid_ops")).where(sql`(status = ANY (ARRAY['open'::text, 'pending_close'::text, 'rejected'::text]))`),
	uniqueIndex("idx_shifts_one_open_per_branch").using("btree", table.branchId.asc().nullsLast().op("uuid_ops")).where(sql`(status = 'open'::text)`),
	index("idx_shifts_opened").using("btree", table.openedAt.desc().nullsFirst().op("timestamptz_ops")),
	index("idx_shifts_status").using("btree", table.status.asc().nullsLast().op("text_ops")),
	index("idx_shifts_teller").using("btree", table.tellerId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.branchId],
			foreignColumns: [branches.id],
			name: "shifts_branch_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.closedBy],
			foreignColumns: [profiles.id],
			name: "shifts_closed_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.tellerId],
			foreignColumns: [profiles.id],
			name: "shifts_teller_id_fkey"
		}).onDelete("restrict"),
	pgPolicy("shifts_own_teller", { as: "permissive", for: "all", to: ["public"], using: sql`((teller_id = auth.uid()) OR is_admin() OR is_accountant() OR (is_branch_manager() AND (branch_id = current_profile_branch_id())))`, withCheck: sql`((teller_id = auth.uid()) OR is_admin() OR is_accountant())`  }),
	check("shifts_status_check", sql`status = ANY (ARRAY['open'::text, 'pending_close'::text, 'discrepancy_flagged'::text, 'closed'::text, 'rejected'::text])`),
]);

export const floatMovements = pgTable("float_movements", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	branchId: uuid("branch_id").notNull(),
	tellerId: uuid("teller_id"),
	transactionId: uuid("transaction_id"),
	shiftId: uuid("shift_id"),
	currency: text().notNull(),
	amount: numeric({ precision: 18, scale:  4 }).notNull(),
	movementType: text("movement_type").notNull(),
	notes: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	wacRateSnapshot: numeric("wac_rate_snapshot", { precision: 18, scale:  6 }),
}, (table) => [
	index("idx_float_branch").using("btree", table.branchId.asc().nullsLast().op("uuid_ops")),
	index("idx_float_created").using("btree", table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	foreignKey({
			columns: [table.branchId],
			foreignColumns: [branches.id],
			name: "float_movements_branch_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.shiftId],
			foreignColumns: [shifts.id],
			name: "float_movements_shift_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.tellerId],
			foreignColumns: [profiles.id],
			name: "float_movements_teller_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.transactionId],
			foreignColumns: [transactions.id],
			name: "float_movements_transaction_id_fkey"
		}).onDelete("set null"),
	pgPolicy("float_movements teller read", { as: "permissive", for: "select", to: ["authenticated"], using: sql`((current_profile_role() = ANY (ARRAY['admin'::text, 'accountant'::text, 'auditor'::text, 'branch_manager'::text, 'super_teller'::text])) OR (branch_id = current_profile_branch_id()))` }),
	pgPolicy("float_read", { as: "permissive", for: "select", to: ["public"] }),
	pgPolicy("float_insert_admin", { as: "permissive", for: "insert", to: ["public"] }),
	check("float_movements_movement_type_check", sql`movement_type = ANY (ARRAY['dispatch'::text, 'return'::text, 'incoming'::text, 'sell-out'::text, 'buy-in'::text, 'adjustment'::text])`),
]);

export const petitCashEntries = pgTable("petit_cash_entries", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	tellerId: uuid("teller_id"),
	branchId: uuid("branch_id"),
	shiftId: uuid("shift_id"),
	direction: text().notNull(),
	category: text().notNull(),
	amountRwf: numeric("amount_rwf", { precision: 20, scale:  2 }).notNull(),
	description: text(),
	paymentAccount: text("payment_account"),
	recordedAt: timestamp("recorded_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	accountCode: text("account_code"),
	currency: text(),
	amountForeign: numeric("amount_foreign", { precision: 20, scale:  4 }),
	voided: boolean().default(false).notNull(),
	status: text().default('pending').notNull(),
	approvedBy: uuid("approved_by"),
	approvedAt: timestamp("approved_at", { withTimezone: true, mode: 'string' }),
	rejectReason: text("reject_reason"),
}, (table) => [
	index("idx_petit_branch").using("btree", table.branchId.asc().nullsLast().op("uuid_ops")),
	index("idx_petit_shift").using("btree", table.shiftId.asc().nullsLast().op("uuid_ops")),
	index("idx_petit_teller").using("btree", table.tellerId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.approvedBy],
			foreignColumns: [profiles.id],
			name: "petit_cash_entries_approved_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.branchId],
			foreignColumns: [branches.id],
			name: "petit_cash_entries_branch_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.shiftId],
			foreignColumns: [shifts.id],
			name: "petit_cash_entries_shift_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.tellerId],
			foreignColumns: [profiles.id],
			name: "petit_cash_entries_teller_id_fkey"
		}).onDelete("set null"),
	pgPolicy("petit_insert_admin", { as: "permissive", for: "insert", to: ["public"], withCheck: sql`(is_admin() OR is_accountant())`  }),
	pgPolicy("petit_read", { as: "permissive", for: "select", to: ["public"] }),
	pgPolicy("petit_delete", { as: "permissive", for: "delete", to: ["public"] }),
	pgPolicy("petit_insert", { as: "permissive", for: "insert", to: ["public"] }),
	pgPolicy("petit_update", { as: "permissive", for: "update", to: ["public"] }),
	check("petit_cash_entries_direction_check", sql`direction = ANY (ARRAY['in'::text, 'out'::text])`),
	check("petit_cash_entries_status_check", sql`status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])`),
]);

export const transactions = pgTable("transactions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	reference: text().default(generate_reference(\'TXN\'::text)).notNull(),
	type: text().notNull(),
	pairId: uuid("pair_id"),
	amountForeign: numeric("amount_foreign", { precision: 20, scale:  6 }).notNull(),
	rateApplied: numeric("rate_applied", { precision: 18, scale:  6 }).notNull(),
	equivalentRwf: numeric("equivalent_rwf", { precision: 20, scale:  2 }).notNull(),
	customerName: text("customer_name"),
	customerPhone: text("customer_phone"),
	customerEmail: text("customer_email"),
	tellerId: uuid("teller_id"),
	branchId: uuid("branch_id"),
	shiftId: uuid("shift_id"),
	paymentStatus: text("payment_status").notNull(),
	pendingReason: text("pending_reason"),
	sourceAccount: text("source_account"),
	destAccount: text("dest_account"),
	amountPaid: numeric("amount_paid", { precision: 20, scale:  2 }).default('0').notNull(),
	specialRateRequested: boolean("special_rate_requested").default(false).notNull(),
	voided: boolean().default(false).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	wacCostRate: numeric("wac_cost_rate", { precision: 18, scale:  6 }),
	txFeeForeign: numeric("tx_fee_foreign", { precision: 20, scale:  4 }).default('0').notNull(),
	txFeeCurrency: text("tx_fee_currency"),
	txFeeRwf: numeric("tx_fee_rwf", { precision: 20, scale:  4 }).default('0').notNull(),
	rejectionReason: text("rejection_reason"),
	recommendedRate: numeric("recommended_rate", { precision: 18, scale:  6 }),
	recommendationStatus: text("recommendation_status").default('none').notNull(),
	recommendedBy: uuid("recommended_by"),
	quoteCurrency: text("quote_currency"),
	equivalentQuote: numeric("equivalent_quote", { precision: 20, scale:  6 }),
	wacCostCurrency: text("wac_cost_currency"),
	feeAccount: text("fee_account"),
}, (table) => [
	index("idx_txn_branch").using("btree", table.branchId.asc().nullsLast().op("uuid_ops")),
	index("idx_txn_created").using("btree", table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	index("idx_txn_shift").using("btree", table.shiftId.asc().nullsLast().op("uuid_ops")),
	index("idx_txn_status").using("btree", table.paymentStatus.asc().nullsLast().op("text_ops")),
	index("idx_txn_teller").using("btree", table.tellerId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.branchId],
			foreignColumns: [branches.id],
			name: "transactions_branch_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.pairId],
			foreignColumns: [currencyPairs.id],
			name: "transactions_pair_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.recommendedBy],
			foreignColumns: [profiles.id],
			name: "transactions_recommended_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.shiftId],
			foreignColumns: [shifts.id],
			name: "transactions_shift_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.tellerId],
			foreignColumns: [profiles.id],
			name: "transactions_teller_id_fkey"
		}).onDelete("set null"),
	unique("transactions_reference_key").on(table.reference),
	pgPolicy("txn_accountant_insert", { as: "permissive", for: "insert", to: ["public"], withCheck: sql`is_accountant()`  }),
	pgPolicy("txn_admin_all", { as: "permissive", for: "all", to: ["public"] }),
	pgPolicy("txn_teller_insert", { as: "permissive", for: "insert", to: ["public"] }),
	pgPolicy("txn_read", { as: "permissive", for: "select", to: ["public"] }),
	pgPolicy("txn_update", { as: "permissive", for: "update", to: ["public"] }),
	check("transactions_amount_foreign_positive", sql`amount_foreign > (0)::numeric`),
	check("transactions_equivalent_rwf_positive", sql`(equivalent_rwf > (0)::numeric) OR ((quote_currency IS NOT NULL) AND (quote_currency <> 'RWF'::text))`),
	check("transactions_payment_status_check", sql`payment_status = ANY (ARRAY['completed'::text, 'pending'::text, 'awaiting_payment'::text, 'customer_not_yet_paid'::text, 'pending_approval'::text, 'rejected'::text, 'voided'::text])`),
	check("transactions_recommendation_status_check", sql`recommendation_status = ANY (ARRAY['none'::text, 'pending'::text, 'accepted'::text, 'declined'::text])`),
	check("transactions_type_check", sql`type = ANY (ARRAY['buy'::text, 'sell'::text])`),
]);

export const ledgerEntries = pgTable("ledger_entries", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	transactionId: uuid("transaction_id"),
	branchId: uuid("branch_id"),
	partyName: text("party_name"),
	partyPhone: text("party_phone"),
	partyEmail: text("party_email"),
	entryType: text("entry_type").notNull(),
	amountForeign: numeric("amount_foreign", { precision: 20, scale:  6 }),
	amountRwf: numeric("amount_rwf", { precision: 20, scale:  2 }).notNull(),
	currency: text(),
	status: text().default('outstanding').notNull(),
	expectedBy: date("expected_by"),
	notes: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	quoteCurrency: text("quote_currency"),
	amountQuote: numeric("amount_quote", { precision: 20, scale:  6 }),
}, (table) => [
	index("idx_ledger_branch").using("btree", table.branchId.asc().nullsLast().op("uuid_ops")),
	index("idx_ledger_status").using("btree", table.status.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.branchId],
			foreignColumns: [branches.id],
			name: "ledger_entries_branch_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.transactionId],
			foreignColumns: [transactions.id],
			name: "ledger_entries_transaction_id_fkey"
		}).onDelete("set null"),
	pgPolicy("ledger_entries branch_manager insert", { as: "permissive", for: "insert", to: ["authenticated"], withCheck: sql`(current_profile_role() = ANY (ARRAY['admin'::text, 'accountant'::text, 'branch_manager'::text, 'teller'::text, 'super_teller'::text]))`  }),
	pgPolicy("ledger_admin", { as: "permissive", for: "all", to: ["public"] }),
	pgPolicy("ledger_read", { as: "permissive", for: "select", to: ["public"] }),
	pgPolicy("ledger_insert", { as: "permissive", for: "insert", to: ["public"] }),
	pgPolicy("ledger_update", { as: "permissive", for: "update", to: ["public"] }),
	check("ledger_entries_entry_type_check", sql`entry_type = ANY (ARRAY['debtor'::text, 'creditor'::text])`),
	check("ledger_entries_status_check", sql`status = ANY (ARRAY['outstanding'::text, 'partial'::text, 'settled'::text, 'voided'::text])`),
]);

export const interBranchTransfers = pgTable("inter_branch_transfers", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	reference: text().default(generate_reference(\'IBR\'::text)).notNull(),
	fromBranchId: uuid("from_branch_id"),
	toBranchId: uuid("to_branch_id"),
	currency: text().notNull(),
	amount: numeric({ precision: 20, scale:  4 }).notNull(),
	fromAccountName: text("from_account_name"),
	toAccountName: text("to_account_name"),
	description: text(),
	createdBy: uuid("created_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_itr_from").using("btree", table.fromBranchId.asc().nullsLast().op("uuid_ops")),
	index("idx_itr_to").using("btree", table.toBranchId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [profiles.id],
			name: "inter_branch_transfers_created_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.fromBranchId],
			foreignColumns: [branches.id],
			name: "inter_branch_transfers_from_branch_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.toBranchId],
			foreignColumns: [branches.id],
			name: "inter_branch_transfers_to_branch_id_fkey"
		}).onDelete("set null"),
	unique("inter_branch_transfers_reference_key").on(table.reference),
	pgPolicy("ibr_select", { as: "permissive", for: "select", to: ["authenticated"], using: sql`true` }),
	pgPolicy("ibr_write", { as: "permissive", for: "all", to: ["authenticated"] }),
	check("inter_branch_transfers_amount_check", sql`amount > (0)::numeric`),
]);

export const notifications = pgTable("notifications", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	type: text().notNull(),
	title: text().notNull(),
	body: text(),
	read: boolean().default(false).notNull(),
	recipientId: uuid("recipient_id"),
	senderId: uuid("sender_id"),
	data: jsonb(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_notif_created").using("btree", table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	index("idx_notif_read").using("btree", table.read.asc().nullsLast().op("bool_ops")),
	index("idx_notif_recipient").using("btree", table.recipientId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.recipientId],
			foreignColumns: [profiles.id],
			name: "notifications_recipient_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.senderId],
			foreignColumns: [profiles.id],
			name: "notifications_sender_id_fkey"
		}).onDelete("set null"),
	pgPolicy("notif_select", { as: "permissive", for: "select", to: ["public"], using: sql`((recipient_id IS NULL) OR (recipient_id = auth.uid()))` }),
	pgPolicy("notif_insert", { as: "permissive", for: "insert", to: ["authenticated"] }),
	pgPolicy("notif_update", { as: "permissive", for: "update", to: ["public"] }),
]);

export const messages = pgTable("messages", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	senderId: uuid("sender_id"),
	senderBranch: uuid("sender_branch"),
	recipientId: uuid("recipient_id"),
	recipientBranch: uuid("recipient_branch"),
	body: text().notNull(),
	isBroadcast: boolean("is_broadcast").default(false).notNull(),
	readBy: uuid("read_by").array().default([""]).notNull(),
	sentAt: timestamp("sent_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_msg_r_branch").using("btree", table.recipientBranch.asc().nullsLast().op("uuid_ops")),
	index("idx_msg_recipient").using("btree", table.recipientId.asc().nullsLast().op("uuid_ops")),
	index("idx_msg_sender").using("btree", table.senderId.asc().nullsLast().op("uuid_ops")),
	index("idx_msg_sent").using("btree", table.sentAt.desc().nullsFirst().op("timestamptz_ops")),
	foreignKey({
			columns: [table.recipientBranch],
			foreignColumns: [branches.id],
			name: "messages_recipient_branch_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.recipientId],
			foreignColumns: [profiles.id],
			name: "messages_recipient_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.senderBranch],
			foreignColumns: [branches.id],
			name: "messages_sender_branch_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.senderId],
			foreignColumns: [profiles.id],
			name: "messages_sender_id_fkey"
		}).onDelete("set null"),
	pgPolicy("msg_insert", { as: "permissive", for: "insert", to: ["public"], withCheck: sql`(sender_id = auth.uid())`  }),
	pgPolicy("msg_read", { as: "permissive", for: "select", to: ["public"] }),
]);

export const auditLogs = pgTable("audit_logs", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	actor: uuid(),
	action: text().notNull(),
	objectType: text("object_type"),
	objectId: uuid("object_id"),
	details: jsonb(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_audit_actor").using("btree", table.actor.asc().nullsLast().op("uuid_ops")),
	index("idx_audit_created").using("btree", table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	foreignKey({
			columns: [table.actor],
			foreignColumns: [profiles.id],
			name: "audit_logs_actor_fkey"
		}).onDelete("set null"),
	pgPolicy("audit_read", { as: "permissive", for: "select", to: ["public"], using: sql`(is_admin() OR is_auditor())` }),
]);

export const wacInventory = pgTable("wac_inventory", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	branchId: uuid("branch_id").notNull(),
	currency: text().notNull(),
	quantity: numeric({ precision: 18, scale:  4 }).default('0').notNull(),
	totalCostRwf: numeric("total_cost_rwf", { precision: 18, scale:  4 }).default('0').notNull(),
	wacRate: numeric("wac_rate", { precision: 18, scale:  6 }).default('0').notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	costCurrency: text("cost_currency").default('RWF').notNull(),
}, (table) => [
	foreignKey({
			columns: [table.branchId],
			foreignColumns: [branches.id],
			name: "wac_inventory_branch_id_fkey"
		}).onDelete("cascade"),
	unique("wac_inventory_branch_currency_cost_key").on(table.branchId, table.currency, table.costCurrency),
	pgPolicy("wac_inventory read", { as: "permissive", for: "select", to: ["authenticated"], using: sql`true` }),
	pgPolicy("wac_inventory write", { as: "permissive", for: "all", to: ["authenticated"] }),
	check("wac_inventory_quantity_check", sql`quantity >= (0)::numeric`),
	check("wac_inventory_total_cost_rwf_check", sql`total_cost_rwf >= (0)::numeric`),
]);

export const westernUnionTransactions = pgTable("western_union_transactions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	reference: text().notNull(),
	type: text().notNull(),
	currency: text().notNull(),
	amount: numeric({ precision: 20, scale:  2 }).notNull(),
	rateApplied: numeric("rate_applied", { precision: 18, scale:  6 }),
	equivalentRwf: numeric("equivalent_rwf", { precision: 20, scale:  2 }).notNull(),
	amountPaid: numeric("amount_paid", { precision: 20, scale:  2 }).notNull(),
	sourceAccount: text("source_account").notNull(),
	branchId: uuid("branch_id").notNull(),
	tellerId: uuid("teller_id"),
	customerName: text("customer_name"),
	notes: text(),
	status: text().default('completed').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	destAccount: text("dest_account").notNull(),
	payCurrency: text("pay_currency").default('single').notNull(),
	payRwf: numeric("pay_rwf", { precision: 20, scale:  2 }),
	payFx: numeric("pay_fx", { precision: 20, scale:  2 }),
}, (table) => [
	index("idx_wu_branch").using("btree", table.branchId.asc().nullsLast().op("uuid_ops")),
	index("idx_wu_created").using("btree", table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	index("idx_wu_teller").using("btree", table.tellerId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.branchId],
			foreignColumns: [branches.id],
			name: "western_union_transactions_branch_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.tellerId],
			foreignColumns: [profiles.id],
			name: "western_union_transactions_teller_id_fkey"
		}).onDelete("set null"),
	unique("western_union_transactions_reference_key").on(table.reference),
	pgPolicy("wu_accountant_insert", { as: "permissive", for: "insert", to: ["public"], withCheck: sql`is_accountant()`  }),
	pgPolicy("wu_admin_all", { as: "permissive", for: "all", to: ["public"] }),
	pgPolicy("wu_teller_insert", { as: "permissive", for: "insert", to: ["public"] }),
	pgPolicy("wu_update", { as: "permissive", for: "update", to: ["public"] }),
	pgPolicy("wu_read", { as: "permissive", for: "select", to: ["authenticated"] }),
	check("western_union_transactions_amount_check", sql`amount > (0)::numeric`),
	check("western_union_transactions_currency_check", sql`currency = ANY (ARRAY['USD'::text, 'RWF'::text])`),
	check("western_union_transactions_pay_currency_check", sql`pay_currency = ANY (ARRAY['single'::text, 'split'::text, 'usd'::text])`),
	check("western_union_transactions_type_check", sql`type = ANY (ARRAY['pickup'::text, 'send'::text])`),
]);

export const interBranchTxns = pgTable("inter_branch_txns", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	reference: text().default(generate_reference(\'IBT\'::text)).notNull(),
	type: text().notNull(),
	fromBranchId: uuid("from_branch_id").notNull(),
	toBranchId: uuid("to_branch_id").notNull(),
	pairId: uuid("pair_id").notNull(),
	currency: text().notNull(),
	amountForeign: numeric("amount_foreign", { precision: 20, scale:  4 }).notNull(),
	rateApplied: numeric("rate_applied", { precision: 18, scale:  6 }),
	equivalentRwf: numeric("equivalent_rwf", { precision: 20, scale:  2 }),
	ourAccount: text("our_account").default('Cash').notNull(),
	initiatedBy: uuid("initiated_by"),
	status: text().default('pending').notNull(),
	reviewedBy: uuid("reviewed_by"),
	reviewedAt: timestamp("reviewed_at", { withTimezone: true, mode: 'string' }),
	amountPaid: numeric("amount_paid", { precision: 20, scale:  2 }),
	feeCollected: numeric("fee_collected", { precision: 20, scale:  2 }),
	notes: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	specialRateRequested: boolean("special_rate_requested").default(false).notNull(),
	standardRate: numeric("standard_rate", { precision: 18, scale:  6 }),
	adminReviewedBy: uuid("admin_reviewed_by"),
	adminReviewedAt: timestamp("admin_reviewed_at", { withTimezone: true, mode: 'string' }),
	payCurrency: text("pay_currency").default('rwf'),
	payRwf: numeric("pay_rwf", { precision: 20, scale:  2 }),
	payFx: numeric("pay_fx", { precision: 20, scale:  2 }),
	payAccountFx: text("pay_account_fx"),
	feeForeign: numeric("fee_foreign", { precision: 20, scale:  4 }),
	feeCurrency: text("fee_currency"),
	feeRwf: numeric("fee_rwf", { precision: 20, scale:  2 }),
	toAccount: text("to_account"),
	voided: boolean().default(false).notNull(),
	rejectionReason: text("rejection_reason"),
	recommendedRate: numeric("recommended_rate", { precision: 18, scale:  6 }),
	recommendationStatus: text("recommendation_status").default('none').notNull(),
	wacCostRate: numeric("wac_cost_rate", { precision: 18, scale:  6 }),
	thresholdRateApplied: boolean("threshold_rate_applied").default(false).notNull(),
	quoteCurrency: text("quote_currency"),
	equivalentQuote: numeric("equivalent_quote", { precision: 20, scale:  6 }),
	wacCostCurrency: text("wac_cost_currency"),
	quoteAccount: text("quote_account"),
}, (table) => [
	index("idx_ibt_from").using("btree", table.fromBranchId.asc().nullsLast().op("uuid_ops")),
	index("idx_ibt_status").using("btree", table.status.asc().nullsLast().op("text_ops")),
	index("idx_ibt_to").using("btree", table.toBranchId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.adminReviewedBy],
			foreignColumns: [profiles.id],
			name: "inter_branch_txns_admin_reviewed_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.fromBranchId],
			foreignColumns: [branches.id],
			name: "inter_branch_txns_from_branch_id_fkey"
		}),
	foreignKey({
			columns: [table.initiatedBy],
			foreignColumns: [profiles.id],
			name: "inter_branch_txns_initiated_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.pairId],
			foreignColumns: [currencyPairs.id],
			name: "inter_branch_txns_pair_id_fkey"
		}),
	foreignKey({
			columns: [table.reviewedBy],
			foreignColumns: [profiles.id],
			name: "inter_branch_txns_reviewed_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.toBranchId],
			foreignColumns: [branches.id],
			name: "inter_branch_txns_to_branch_id_fkey"
		}),
	unique("inter_branch_txns_reference_key").on(table.reference),
	pgPolicy("ibt_insert", { as: "permissive", for: "insert", to: ["authenticated"], withCheck: sql`(is_admin() OR is_accountant() OR is_super_teller() OR ((current_profile_branch_id() = from_branch_id) AND (current_profile_role() <> 'auditor'::text)))`  }),
	pgPolicy("ibt_update", { as: "permissive", for: "update", to: ["authenticated"] }),
	pgPolicy("ibt_delete", { as: "permissive", for: "delete", to: ["authenticated"] }),
	pgPolicy("ibt_select", { as: "permissive", for: "select", to: ["authenticated"] }),
	check("inter_branch_txns_amount_foreign_check", sql`amount_foreign > (0)::numeric`),
	check("inter_branch_txns_recommendation_status_check", sql`recommendation_status = ANY (ARRAY['none'::text, 'pending'::text, 'accepted'::text, 'declined'::text])`),
	check("inter_branch_txns_status_check", sql`status = ANY (ARRAY['pending_admin'::text, 'pending'::text, 'approved'::text, 'declined'::text])`),
	check("inter_branch_txns_type_check", sql`type = ANY (ARRAY['buy'::text, 'sell'::text])`),
]);

export const branchFloatTransfers = pgTable("branch_float_transfers", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	reference: text().default(generate_reference(\'BFT\'::text)).notNull(),
	fromBranchId: uuid("from_branch_id").notNull(),
	toBranchId: uuid("to_branch_id").notNull(),
	currency: text().notNull(),
	amount: numeric({ precision: 18, scale:  4 }).notNull(),
	fromAccount: text("from_account").notNull(),
	toAccount: text("to_account"),
	initiatedBy: uuid("initiated_by"),
	completedBy: uuid("completed_by"),
	status: text().default('pending').notNull(),
	notes: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	completedAt: timestamp("completed_at", { withTimezone: true, mode: 'string' }),
	feeAmount: numeric("fee_amount", { precision: 20, scale:  4 }),
	voided: boolean().default(false).notNull(),
	wacRateSnapshot: numeric("wac_rate_snapshot", { precision: 18, scale:  6 }),
}, (table) => [
	index("idx_bft_from").using("btree", table.fromBranchId.asc().nullsLast().op("uuid_ops")),
	index("idx_bft_status").using("btree", table.status.asc().nullsLast().op("text_ops")),
	index("idx_bft_to").using("btree", table.toBranchId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.completedBy],
			foreignColumns: [profiles.id],
			name: "branch_float_transfers_completed_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.fromBranchId],
			foreignColumns: [branches.id],
			name: "branch_float_transfers_from_branch_id_fkey"
		}),
	foreignKey({
			columns: [table.initiatedBy],
			foreignColumns: [profiles.id],
			name: "branch_float_transfers_initiated_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.toBranchId],
			foreignColumns: [branches.id],
			name: "branch_float_transfers_to_branch_id_fkey"
		}),
	unique("branch_float_transfers_reference_key").on(table.reference),
	pgPolicy("bft_select", { as: "permissive", for: "select", to: ["authenticated"], using: sql`true` }),
	pgPolicy("bft_insert", { as: "permissive", for: "insert", to: ["authenticated"] }),
	pgPolicy("bft_update", { as: "permissive", for: "update", to: ["authenticated"] }),
	pgPolicy("bft_delete", { as: "permissive", for: "delete", to: ["authenticated"] }),
	check("branch_float_transfers_amount_check", sql`amount > (0)::numeric`),
	check("branch_float_transfers_status_check", sql`status = ANY (ARRAY['pending'::text, 'completed'::text, 'rejected'::text])`),
]);

export const txRequests = pgTable("tx_requests", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	requestType: text("request_type").notNull(),
	txRef: text("tx_ref"),
	txId: uuid("tx_id"),
	tellerId: uuid("teller_id"),
	branchId: uuid("branch_id"),
	shiftId: uuid("shift_id"),
	reason: text().notNull(),
	status: text().default('pending').notNull(),
	fieldChanges: jsonb("field_changes"),
	reviewedBy: uuid("reviewed_by"),
	reviewedAt: timestamp("reviewed_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	entityType: text("entity_type").default('transaction').notNull(),
	internalTransferId: uuid("internal_transfer_id"),
	interBranchTxnId: uuid("inter_branch_txn_id"),
	branchFloatTransferId: uuid("branch_float_transfer_id"),
	petitCashEntryId: uuid("petit_cash_entry_id"),
	westernUnionTransactionId: uuid("western_union_transaction_id"),
	moneyGramTransactionId: uuid("money_gram_transaction_id"),
	riaTransactionId: uuid("ria_transaction_id"),
	floatChannelTransactionId: uuid("float_channel_transaction_id"),
}, (table) => [
	index("idx_txreq_branch").using("btree", table.branchId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("idx_txreq_one_pending_per_ref").using("btree", table.txRef.asc().nullsLast().op("text_ops")).where(sql`((status = 'pending'::text) AND (request_type = ANY (ARRAY['edit'::text, 'delete'::text])) AND (tx_ref IS NOT NULL))`),
	index("idx_txreq_status").using("btree", table.status.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.branchFloatTransferId],
			foreignColumns: [branchFloatTransfers.id],
			name: "tx_requests_branch_float_transfer_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.branchId],
			foreignColumns: [branches.id],
			name: "tx_requests_branch_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.floatChannelTransactionId],
			foreignColumns: [floatChannelTransactions.id],
			name: "tx_requests_float_channel_transaction_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.interBranchTxnId],
			foreignColumns: [interBranchTxns.id],
			name: "tx_requests_inter_branch_txn_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.internalTransferId],
			foreignColumns: [internalTransfers.id],
			name: "tx_requests_internal_transfer_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.moneyGramTransactionId],
			foreignColumns: [moneyGramTransactions.id],
			name: "tx_requests_money_gram_transaction_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.petitCashEntryId],
			foreignColumns: [petitCashEntries.id],
			name: "tx_requests_petit_cash_entry_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.reviewedBy],
			foreignColumns: [profiles.id],
			name: "tx_requests_reviewed_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.riaTransactionId],
			foreignColumns: [riaTransactions.id],
			name: "tx_requests_ria_transaction_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.shiftId],
			foreignColumns: [shifts.id],
			name: "tx_requests_shift_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.tellerId],
			foreignColumns: [profiles.id],
			name: "tx_requests_teller_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.txId],
			foreignColumns: [transactions.id],
			name: "tx_requests_tx_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.westernUnionTransactionId],
			foreignColumns: [westernUnionTransactions.id],
			name: "tx_requests_western_union_transaction_id_fkey"
		}).onDelete("set null"),
	pgPolicy("txreq_select", { as: "permissive", for: "select", to: ["authenticated"], using: sql`((teller_id = auth.uid()) OR is_admin() OR is_accountant() OR is_auditor() OR is_super_teller())` }),
	pgPolicy("txreq_insert", { as: "permissive", for: "insert", to: ["authenticated"] }),
	pgPolicy("txreq_update", { as: "permissive", for: "update", to: ["authenticated"] }),
	check("tx_requests_entity_type_check", sql`entity_type = ANY (ARRAY['transaction'::text, 'internal_transfer'::text, 'inter_branch_txn'::text, 'branch_float_transfer'::text, 'petit_cash_entry'::text, 'western_union_transaction'::text, 'money_gram_transaction'::text, 'ria_transaction'::text, 'float_channel_transaction'::text])`),
	check("tx_requests_request_type_check", sql`request_type = ANY (ARRAY['edit'::text, 'delete'::text, 'special_rate'::text, 'add'::text])`),
	check("tx_requests_status_check", sql`status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])`),
]);

export const superTellerAccounts = pgTable("super_teller_accounts", {
	superTellerId: uuid("super_teller_id").notNull(),
	accountId: uuid("account_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_sta_teller").using("btree", table.superTellerId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.accountId],
			foreignColumns: [paymentAccounts.id],
			name: "super_teller_accounts_account_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.superTellerId],
			foreignColumns: [profiles.id],
			name: "super_teller_accounts_super_teller_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.superTellerId, table.accountId], name: "super_teller_accounts_pkey"}),
	pgPolicy("sta_select", { as: "permissive", for: "select", to: ["authenticated"], using: sql`true` }),
	pgPolicy("sta_admin_write", { as: "permissive", for: "all", to: ["authenticated"] }),
]);

export const tellerSchedules = pgTable("teller_schedules", {
	tellerId: uuid("teller_id").notNull(),
	branchId: uuid("branch_id").notNull(),
	dayOfWeek: integer("day_of_week").notNull(),
	effectiveFrom: date("effective_from"),
	effectiveTo: date("effective_to"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_sched_branch").using("btree", table.branchId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.branchId],
			foreignColumns: [branches.id],
			name: "teller_schedules_branch_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.tellerId],
			foreignColumns: [profiles.id],
			name: "teller_schedules_teller_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.tellerId, table.dayOfWeek], name: "teller_schedules_pkey"}),
	pgPolicy("schedules_read", { as: "permissive", for: "select", to: ["authenticated"], using: sql`true` }),
	pgPolicy("schedules_admin", { as: "permissive", for: "all", to: ["authenticated"] }),
	check("teller_schedules_day_of_week_check", sql`(day_of_week >= 0) AND (day_of_week <= 6)`),
]);
