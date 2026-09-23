const { Router } = require('express');

const router = Router();

// Direct table writes Node now owns outright (Phase 3 of MIGRATION_PLAN.md)
// — as opposed to routes/api/rpc/, which wraps existing Postgres RPCs.
// One file per table, same convention.
router.use('/payment-accounts', require('./paymentAccounts'));
router.use('/inter-branch-txns', require('./interBranchTxns'));
router.use('/branch-float-transfers', require('./branchFloatTransfers'));
router.use('/tx-requests', require('./txRequests'));
router.use('/transactions', require('./transactions'));
router.use('/petit-cash-entries', require('./petitCashEntries'));
router.use('/shifts', require('./shifts'));
router.use('/float-channel-transactions', require('./floatChannelTransactions'));
router.use('/profiles', require('./profiles'));
router.use('/branches', require('./branches'));
router.use('/ria-transactions', require('./riaTransactions'));
router.use('/currency-pairs', require('./currencyPairs'));
router.use('/ledger-entries', require('./ledgerEntries'));
router.use('/western-union-transactions', require('./westernUnionTransactions'));
router.use('/money-gram-transactions', require('./moneyGramTransactions'));
router.use('/teller-schedules', require('./tellerSchedules'));
router.use('/super-teller-accounts', require('./superTellerAccounts'));
router.use('/messages', require('./messages'));
router.use('/float-movements', require('./floatMovements'));
router.use('/account-catalog', require('./accountCatalog'));
router.use('/system-settings', require('./systemSettings'));
router.use('/currencies', require('./currencies'));
router.use('/exchange-rates', require('./exchangeRates'));
router.use('/inter-branch-transfers', require('./interBranchTransfers'));
router.use('/notifications', require('./notifications'));

module.exports = router;
