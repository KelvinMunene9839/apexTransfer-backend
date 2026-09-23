const { Router } = require('express');
const { requireUser } = require('../../../middleware/auth');
const { validateBody } = require('../../../middleware/validate');
const { asyncWrapper } = require('../../../utils/asyncWrapper');
const { ApiError } = require('../../../utils/ApiError');
const { serviceClient } = require('../../../services/rpc');
const { canWriteLedgerEntry } = require('../../../services/balanceAuth');

const router = Router();

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function validateRow(row) {
  if (row?.entry_type !== 'debtor' && row?.entry_type !== 'creditor') return "entry_type must be 'debtor' or 'creditor'";
  // Not >0: BranchApprovalsPage.jsx deliberately sends amount_rwf: 0 for a
  // cross-currency settlement (the real value lives in amount_quote/
  // quote_currency instead, same "FX leg has delta=0 by design" pattern as
  // account_movements) -- but a negative value is never legitimate here and
  // would silently corrupt any downstream sum keyed on entry_type.
  if (!isNum(row?.amount_rwf) || row.amount_rwf < 0) return 'amount_rwf must be a non-negative number';
  return true;
}

// Create — mirrors ledger_entries' own combined insert policies (every
// non-auditor role, no identity/branch-ownership check — see
// canWriteLedgerEntry's own comment). Accepts either a single object
// (LedgerPage.jsx's ManualEntryModal) or an array (BranchApprovalsPage.jsx
// inserts both settlement sides atomically in one call).
function validateCreate(body) {
  const rows = Array.isArray(body) ? body : [body];
  if (rows.length === 0) return 'at least one entry is required';
  for (const row of rows) {
    const result = validateRow(row);
    if (result !== true) return result;
  }
  return true;
}

router.post('/', requireUser, validateBody(validateCreate), asyncWrapper(async (req, res) => {
  if (!canWriteLedgerEntry(req.user)) throw new ApiError(403, 'Not authorized to create ledger entries');

  const rows = Array.isArray(req.body) ? req.body : [req.body];
  const { data, error } = await serviceClient.from('ledger_entries').insert(rows).select();
  if (error) throw new ApiError(400, error.message);

  res.json(Array.isArray(req.body) ? data : data[0]);
}));

module.exports = router;
