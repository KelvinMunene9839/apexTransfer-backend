const { Router } = require('express');

const router = Router();

// One file per wrapped RPC, same convention as routes/api/index.js —
// add the other 15 from MIGRATION_PLAN.md's Phase 2 list here as they're
// wrapped.
router.use('/apply-balance-legs', require('./applyBalanceLegs'));
router.use('/update-account-balance', require('./updateAccountBalance'));
router.use('/settle-deferred-transaction', require('./settleDeferredTransaction'));
router.use('/settle-manual-ledger-entry', require('./settleManualLedgerEntry'));
router.use('/create-manual-ledger-entry', require('./createManualLedgerEntry'));
router.use('/settle-deferred-transaction-fx', require('./settleDeferredTransactionFx'));
router.use('/approve-inter-branch-txn', require('./approveInterBranchTxn'));
router.use('/approve-petit-cash-entry', require('./approvePetitCashEntry'));
router.use('/accept-branch-float-transfer', require('./acceptBranchFloatTransfer'));
router.use('/apply-internal-transfer', require('./applyInternalTransfer'));
router.use('/edit-account-movement', require('./editAccountMovement'));
router.use('/void-account-movement', require('./voidAccountMovement'));
router.use('/reclassify-incoming-float', require('./reclassifyIncomingFloat'));
router.use('/reduce-wac-inventory', require('./reduceWacInventory'));
router.use('/upsert-wac-inventory', require('./upsertWacInventory'));
router.use('/create-currency-pair-with-rate', require('./createCurrencyPairWithRate'));
router.use('/get-ledger-summary', require('./getLedgerSummary'));
router.use('/reparent-orphan-shift-activity', require('./reparentOrphanShiftActivity'));
router.use('/mark-message-read', require('./markMessageRead'));
router.use('/record-loss', require('./recordLoss'));
router.use('/settle-loss', require('./settleLoss'));
router.use('/void-loss', require('./voidLoss'));

module.exports = router;
