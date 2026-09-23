import { relations } from "drizzle-orm/relations";
import { branches, internalTransfers, profiles, moneyGramTransactions, riaTransactions, floatChannelTransactions, usersInAuth, paymentAccounts, accountMovements, shifts, transactions, accountCatalog, exchangeRates, currencyPairs, systemSettings, feeExpenses, floatMovements, petitCashEntries, ledgerEntries, interBranchTransfers, notifications, messages, auditLogs, wacInventory, westernUnionTransactions, interBranchTxns, branchFloatTransfers, txRequests, superTellerAccounts, tellerSchedules } from "./schema";

export const internalTransfersRelations = relations(internalTransfers, ({one, many}) => ({
	branch: one(branches, {
		fields: [internalTransfers.branchId],
		references: [branches.id]
	}),
	profile: one(profiles, {
		fields: [internalTransfers.initiatedBy],
		references: [profiles.id]
	}),
	txRequests: many(txRequests),
}));

export const branchesRelations = relations(branches, ({many}) => ({
	internalTransfers: many(internalTransfers),
	moneyGramTransactions: many(moneyGramTransactions),
	riaTransactions: many(riaTransactions),
	floatChannelTransactions: many(floatChannelTransactions),
	profiles: many(profiles),
	paymentAccounts: many(paymentAccounts),
	feeExpenses: many(feeExpenses),
	shifts: many(shifts),
	floatMovements: many(floatMovements),
	petitCashEntries: many(petitCashEntries),
	transactions: many(transactions),
	ledgerEntries: many(ledgerEntries),
	interBranchTransfers_fromBranchId: many(interBranchTransfers, {
		relationName: "interBranchTransfers_fromBranchId_branches_id"
	}),
	interBranchTransfers_toBranchId: many(interBranchTransfers, {
		relationName: "interBranchTransfers_toBranchId_branches_id"
	}),
	messages_recipientBranch: many(messages, {
		relationName: "messages_recipientBranch_branches_id"
	}),
	messages_senderBranch: many(messages, {
		relationName: "messages_senderBranch_branches_id"
	}),
	wacInventories: many(wacInventory),
	westernUnionTransactions: many(westernUnionTransactions),
	interBranchTxns_fromBranchId: many(interBranchTxns, {
		relationName: "interBranchTxns_fromBranchId_branches_id"
	}),
	interBranchTxns_toBranchId: many(interBranchTxns, {
		relationName: "interBranchTxns_toBranchId_branches_id"
	}),
	branchFloatTransfers_fromBranchId: many(branchFloatTransfers, {
		relationName: "branchFloatTransfers_fromBranchId_branches_id"
	}),
	branchFloatTransfers_toBranchId: many(branchFloatTransfers, {
		relationName: "branchFloatTransfers_toBranchId_branches_id"
	}),
	txRequests: many(txRequests),
	tellerSchedules: many(tellerSchedules),
}));

export const profilesRelations = relations(profiles, ({one, many}) => ({
	internalTransfers: many(internalTransfers),
	moneyGramTransactions: many(moneyGramTransactions),
	riaTransactions: many(riaTransactions),
	floatChannelTransactions: many(floatChannelTransactions),
	branch: one(branches, {
		fields: [profiles.branchId],
		references: [branches.id]
	}),
	usersInAuth: one(usersInAuth, {
		fields: [profiles.id],
		references: [usersInAuth.id]
	}),
	feeExpenses: many(feeExpenses),
	shifts_closedBy: many(shifts, {
		relationName: "shifts_closedBy_profiles_id"
	}),
	shifts_tellerId: many(shifts, {
		relationName: "shifts_tellerId_profiles_id"
	}),
	floatMovements: many(floatMovements),
	petitCashEntries_approvedBy: many(petitCashEntries, {
		relationName: "petitCashEntries_approvedBy_profiles_id"
	}),
	petitCashEntries_tellerId: many(petitCashEntries, {
		relationName: "petitCashEntries_tellerId_profiles_id"
	}),
	transactions_recommendedBy: many(transactions, {
		relationName: "transactions_recommendedBy_profiles_id"
	}),
	transactions_tellerId: many(transactions, {
		relationName: "transactions_tellerId_profiles_id"
	}),
	interBranchTransfers: many(interBranchTransfers),
	notifications_recipientId: many(notifications, {
		relationName: "notifications_recipientId_profiles_id"
	}),
	notifications_senderId: many(notifications, {
		relationName: "notifications_senderId_profiles_id"
	}),
	messages_recipientId: many(messages, {
		relationName: "messages_recipientId_profiles_id"
	}),
	messages_senderId: many(messages, {
		relationName: "messages_senderId_profiles_id"
	}),
	auditLogs: many(auditLogs),
	westernUnionTransactions: many(westernUnionTransactions),
	interBranchTxns_adminReviewedBy: many(interBranchTxns, {
		relationName: "interBranchTxns_adminReviewedBy_profiles_id"
	}),
	interBranchTxns_initiatedBy: many(interBranchTxns, {
		relationName: "interBranchTxns_initiatedBy_profiles_id"
	}),
	interBranchTxns_reviewedBy: many(interBranchTxns, {
		relationName: "interBranchTxns_reviewedBy_profiles_id"
	}),
	branchFloatTransfers_completedBy: many(branchFloatTransfers, {
		relationName: "branchFloatTransfers_completedBy_profiles_id"
	}),
	branchFloatTransfers_initiatedBy: many(branchFloatTransfers, {
		relationName: "branchFloatTransfers_initiatedBy_profiles_id"
	}),
	txRequests_reviewedBy: many(txRequests, {
		relationName: "txRequests_reviewedBy_profiles_id"
	}),
	txRequests_tellerId: many(txRequests, {
		relationName: "txRequests_tellerId_profiles_id"
	}),
	superTellerAccounts: many(superTellerAccounts),
	tellerSchedules: many(tellerSchedules),
}));

export const moneyGramTransactionsRelations = relations(moneyGramTransactions, ({one, many}) => ({
	branch: one(branches, {
		fields: [moneyGramTransactions.branchId],
		references: [branches.id]
	}),
	profile: one(profiles, {
		fields: [moneyGramTransactions.tellerId],
		references: [profiles.id]
	}),
	txRequests: many(txRequests),
}));

export const riaTransactionsRelations = relations(riaTransactions, ({one, many}) => ({
	branch: one(branches, {
		fields: [riaTransactions.branchId],
		references: [branches.id]
	}),
	profile: one(profiles, {
		fields: [riaTransactions.tellerId],
		references: [profiles.id]
	}),
	txRequests: many(txRequests),
}));

export const floatChannelTransactionsRelations = relations(floatChannelTransactions, ({one, many}) => ({
	branch: one(branches, {
		fields: [floatChannelTransactions.branchId],
		references: [branches.id]
	}),
	profile: one(profiles, {
		fields: [floatChannelTransactions.tellerId],
		references: [profiles.id]
	}),
	txRequests: many(txRequests),
}));

export const usersInAuthRelations = relations(usersInAuth, ({many}) => ({
	profiles: many(profiles),
	exchangeRates: many(exchangeRates),
	systemSettings: many(systemSettings),
}));

export const accountMovementsRelations = relations(accountMovements, ({one}) => ({
	paymentAccount: one(paymentAccounts, {
		fields: [accountMovements.accountId],
		references: [paymentAccounts.id]
	}),
	shift: one(shifts, {
		fields: [accountMovements.shiftId],
		references: [shifts.id]
	}),
	transaction: one(transactions, {
		fields: [accountMovements.transactionId],
		references: [transactions.id]
	}),
}));

export const paymentAccountsRelations = relations(paymentAccounts, ({one, many}) => ({
	accountMovements: many(accountMovements),
	branch: one(branches, {
		fields: [paymentAccounts.branchId],
		references: [branches.id]
	}),
	accountCatalog: one(accountCatalog, {
		fields: [paymentAccounts.catalogId],
		references: [accountCatalog.id]
	}),
	superTellerAccounts: many(superTellerAccounts),
}));

export const shiftsRelations = relations(shifts, ({one, many}) => ({
	accountMovements: many(accountMovements),
	branch: one(branches, {
		fields: [shifts.branchId],
		references: [branches.id]
	}),
	profile_closedBy: one(profiles, {
		fields: [shifts.closedBy],
		references: [profiles.id],
		relationName: "shifts_closedBy_profiles_id"
	}),
	profile_tellerId: one(profiles, {
		fields: [shifts.tellerId],
		references: [profiles.id],
		relationName: "shifts_tellerId_profiles_id"
	}),
	floatMovements: many(floatMovements),
	petitCashEntries: many(petitCashEntries),
	transactions: many(transactions),
	txRequests: many(txRequests),
}));

export const transactionsRelations = relations(transactions, ({one, many}) => ({
	accountMovements: many(accountMovements),
	feeExpenses: many(feeExpenses),
	floatMovements: many(floatMovements),
	branch: one(branches, {
		fields: [transactions.branchId],
		references: [branches.id]
	}),
	currencyPair: one(currencyPairs, {
		fields: [transactions.pairId],
		references: [currencyPairs.id]
	}),
	profile_recommendedBy: one(profiles, {
		fields: [transactions.recommendedBy],
		references: [profiles.id],
		relationName: "transactions_recommendedBy_profiles_id"
	}),
	shift: one(shifts, {
		fields: [transactions.shiftId],
		references: [shifts.id]
	}),
	profile_tellerId: one(profiles, {
		fields: [transactions.tellerId],
		references: [profiles.id],
		relationName: "transactions_tellerId_profiles_id"
	}),
	ledgerEntries: many(ledgerEntries),
	txRequests: many(txRequests),
}));

export const accountCatalogRelations = relations(accountCatalog, ({many}) => ({
	paymentAccounts: many(paymentAccounts),
}));

export const exchangeRatesRelations = relations(exchangeRates, ({one}) => ({
	usersInAuth: one(usersInAuth, {
		fields: [exchangeRates.createdBy],
		references: [usersInAuth.id]
	}),
	currencyPair: one(currencyPairs, {
		fields: [exchangeRates.pairId],
		references: [currencyPairs.id]
	}),
}));

export const currencyPairsRelations = relations(currencyPairs, ({many}) => ({
	exchangeRates: many(exchangeRates),
	transactions: many(transactions),
	interBranchTxns: many(interBranchTxns),
}));

export const systemSettingsRelations = relations(systemSettings, ({one}) => ({
	usersInAuth: one(usersInAuth, {
		fields: [systemSettings.updatedBy],
		references: [usersInAuth.id]
	}),
}));

export const feeExpensesRelations = relations(feeExpenses, ({one}) => ({
	branch: one(branches, {
		fields: [feeExpenses.branchId],
		references: [branches.id]
	}),
	profile: one(profiles, {
		fields: [feeExpenses.tellerId],
		references: [profiles.id]
	}),
	transaction: one(transactions, {
		fields: [feeExpenses.transactionId],
		references: [transactions.id]
	}),
}));

export const floatMovementsRelations = relations(floatMovements, ({one}) => ({
	branch: one(branches, {
		fields: [floatMovements.branchId],
		references: [branches.id]
	}),
	shift: one(shifts, {
		fields: [floatMovements.shiftId],
		references: [shifts.id]
	}),
	profile: one(profiles, {
		fields: [floatMovements.tellerId],
		references: [profiles.id]
	}),
	transaction: one(transactions, {
		fields: [floatMovements.transactionId],
		references: [transactions.id]
	}),
}));

export const petitCashEntriesRelations = relations(petitCashEntries, ({one, many}) => ({
	profile_approvedBy: one(profiles, {
		fields: [petitCashEntries.approvedBy],
		references: [profiles.id],
		relationName: "petitCashEntries_approvedBy_profiles_id"
	}),
	branch: one(branches, {
		fields: [petitCashEntries.branchId],
		references: [branches.id]
	}),
	shift: one(shifts, {
		fields: [petitCashEntries.shiftId],
		references: [shifts.id]
	}),
	profile_tellerId: one(profiles, {
		fields: [petitCashEntries.tellerId],
		references: [profiles.id],
		relationName: "petitCashEntries_tellerId_profiles_id"
	}),
	txRequests: many(txRequests),
}));

export const ledgerEntriesRelations = relations(ledgerEntries, ({one}) => ({
	branch: one(branches, {
		fields: [ledgerEntries.branchId],
		references: [branches.id]
	}),
	transaction: one(transactions, {
		fields: [ledgerEntries.transactionId],
		references: [transactions.id]
	}),
}));

export const interBranchTransfersRelations = relations(interBranchTransfers, ({one}) => ({
	profile: one(profiles, {
		fields: [interBranchTransfers.createdBy],
		references: [profiles.id]
	}),
	branch_fromBranchId: one(branches, {
		fields: [interBranchTransfers.fromBranchId],
		references: [branches.id],
		relationName: "interBranchTransfers_fromBranchId_branches_id"
	}),
	branch_toBranchId: one(branches, {
		fields: [interBranchTransfers.toBranchId],
		references: [branches.id],
		relationName: "interBranchTransfers_toBranchId_branches_id"
	}),
}));

export const notificationsRelations = relations(notifications, ({one}) => ({
	profile_recipientId: one(profiles, {
		fields: [notifications.recipientId],
		references: [profiles.id],
		relationName: "notifications_recipientId_profiles_id"
	}),
	profile_senderId: one(profiles, {
		fields: [notifications.senderId],
		references: [profiles.id],
		relationName: "notifications_senderId_profiles_id"
	}),
}));

export const messagesRelations = relations(messages, ({one}) => ({
	branch_recipientBranch: one(branches, {
		fields: [messages.recipientBranch],
		references: [branches.id],
		relationName: "messages_recipientBranch_branches_id"
	}),
	profile_recipientId: one(profiles, {
		fields: [messages.recipientId],
		references: [profiles.id],
		relationName: "messages_recipientId_profiles_id"
	}),
	branch_senderBranch: one(branches, {
		fields: [messages.senderBranch],
		references: [branches.id],
		relationName: "messages_senderBranch_branches_id"
	}),
	profile_senderId: one(profiles, {
		fields: [messages.senderId],
		references: [profiles.id],
		relationName: "messages_senderId_profiles_id"
	}),
}));

export const auditLogsRelations = relations(auditLogs, ({one}) => ({
	profile: one(profiles, {
		fields: [auditLogs.actor],
		references: [profiles.id]
	}),
}));

export const wacInventoryRelations = relations(wacInventory, ({one}) => ({
	branch: one(branches, {
		fields: [wacInventory.branchId],
		references: [branches.id]
	}),
}));

export const westernUnionTransactionsRelations = relations(westernUnionTransactions, ({one, many}) => ({
	branch: one(branches, {
		fields: [westernUnionTransactions.branchId],
		references: [branches.id]
	}),
	profile: one(profiles, {
		fields: [westernUnionTransactions.tellerId],
		references: [profiles.id]
	}),
	txRequests: many(txRequests),
}));

export const interBranchTxnsRelations = relations(interBranchTxns, ({one, many}) => ({
	profile_adminReviewedBy: one(profiles, {
		fields: [interBranchTxns.adminReviewedBy],
		references: [profiles.id],
		relationName: "interBranchTxns_adminReviewedBy_profiles_id"
	}),
	branch_fromBranchId: one(branches, {
		fields: [interBranchTxns.fromBranchId],
		references: [branches.id],
		relationName: "interBranchTxns_fromBranchId_branches_id"
	}),
	profile_initiatedBy: one(profiles, {
		fields: [interBranchTxns.initiatedBy],
		references: [profiles.id],
		relationName: "interBranchTxns_initiatedBy_profiles_id"
	}),
	currencyPair: one(currencyPairs, {
		fields: [interBranchTxns.pairId],
		references: [currencyPairs.id]
	}),
	profile_reviewedBy: one(profiles, {
		fields: [interBranchTxns.reviewedBy],
		references: [profiles.id],
		relationName: "interBranchTxns_reviewedBy_profiles_id"
	}),
	branch_toBranchId: one(branches, {
		fields: [interBranchTxns.toBranchId],
		references: [branches.id],
		relationName: "interBranchTxns_toBranchId_branches_id"
	}),
	txRequests: many(txRequests),
}));

export const branchFloatTransfersRelations = relations(branchFloatTransfers, ({one, many}) => ({
	profile_completedBy: one(profiles, {
		fields: [branchFloatTransfers.completedBy],
		references: [profiles.id],
		relationName: "branchFloatTransfers_completedBy_profiles_id"
	}),
	branch_fromBranchId: one(branches, {
		fields: [branchFloatTransfers.fromBranchId],
		references: [branches.id],
		relationName: "branchFloatTransfers_fromBranchId_branches_id"
	}),
	profile_initiatedBy: one(profiles, {
		fields: [branchFloatTransfers.initiatedBy],
		references: [profiles.id],
		relationName: "branchFloatTransfers_initiatedBy_profiles_id"
	}),
	branch_toBranchId: one(branches, {
		fields: [branchFloatTransfers.toBranchId],
		references: [branches.id],
		relationName: "branchFloatTransfers_toBranchId_branches_id"
	}),
	txRequests: many(txRequests),
}));

export const txRequestsRelations = relations(txRequests, ({one}) => ({
	branchFloatTransfer: one(branchFloatTransfers, {
		fields: [txRequests.branchFloatTransferId],
		references: [branchFloatTransfers.id]
	}),
	branch: one(branches, {
		fields: [txRequests.branchId],
		references: [branches.id]
	}),
	floatChannelTransaction: one(floatChannelTransactions, {
		fields: [txRequests.floatChannelTransactionId],
		references: [floatChannelTransactions.id]
	}),
	interBranchTxn: one(interBranchTxns, {
		fields: [txRequests.interBranchTxnId],
		references: [interBranchTxns.id]
	}),
	internalTransfer: one(internalTransfers, {
		fields: [txRequests.internalTransferId],
		references: [internalTransfers.id]
	}),
	moneyGramTransaction: one(moneyGramTransactions, {
		fields: [txRequests.moneyGramTransactionId],
		references: [moneyGramTransactions.id]
	}),
	petitCashEntry: one(petitCashEntries, {
		fields: [txRequests.petitCashEntryId],
		references: [petitCashEntries.id]
	}),
	profile_reviewedBy: one(profiles, {
		fields: [txRequests.reviewedBy],
		references: [profiles.id],
		relationName: "txRequests_reviewedBy_profiles_id"
	}),
	riaTransaction: one(riaTransactions, {
		fields: [txRequests.riaTransactionId],
		references: [riaTransactions.id]
	}),
	shift: one(shifts, {
		fields: [txRequests.shiftId],
		references: [shifts.id]
	}),
	profile_tellerId: one(profiles, {
		fields: [txRequests.tellerId],
		references: [profiles.id],
		relationName: "txRequests_tellerId_profiles_id"
	}),
	transaction: one(transactions, {
		fields: [txRequests.txId],
		references: [transactions.id]
	}),
	westernUnionTransaction: one(westernUnionTransactions, {
		fields: [txRequests.westernUnionTransactionId],
		references: [westernUnionTransactions.id]
	}),
}));

export const superTellerAccountsRelations = relations(superTellerAccounts, ({one}) => ({
	paymentAccount: one(paymentAccounts, {
		fields: [superTellerAccounts.accountId],
		references: [paymentAccounts.id]
	}),
	profile: one(profiles, {
		fields: [superTellerAccounts.superTellerId],
		references: [profiles.id]
	}),
}));

export const tellerSchedulesRelations = relations(tellerSchedules, ({one}) => ({
	branch: one(branches, {
		fields: [tellerSchedules.branchId],
		references: [branches.id]
	}),
	profile: one(profiles, {
		fields: [tellerSchedules.tellerId],
		references: [profiles.id]
	}),
}));