const { Router } = require('express');
const { requireUser } = require('../../../middleware/auth');
const { validateBody } = require('../../../middleware/validate');
const { asyncWrapper } = require('../../../utils/asyncWrapper');
const { ApiError } = require('../../../utils/ApiError');
const { callRpcAsService } = require('../../../services/rpc');
const { isAdminAccountantOrSuperTeller } = require('../../../services/balanceAuth');

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function validateParams(body) {
  if (typeof body?.p_party_name !== 'string' || !body.p_party_name.trim()) return 'p_party_name is required';
  if (body?.p_entry_type !== 'debtor' && body?.p_entry_type !== 'creditor') return "p_entry_type must be 'debtor' or 'creditor'";
  if (typeof body?.p_branch_id !== 'string' || !UUID_RE.test(body.p_branch_id)) return 'p_branch_id must be a uuid';
  if (typeof body?.p_account_name !== 'string' || !body.p_account_name.trim()) return 'p_account_name is required';
  if (!isNum(body?.p_amount_rwf) || body.p_amount_rwf <= 0) return 'p_amount_rwf must be greater than zero';
  if (body.p_amount_foreign != null && !isNum(body.p_amount_foreign)) return 'p_amount_foreign must be a number';
  return true;
}

// Unlike plain ledger-entries inserts (POST /api/tables/ledger-entries,
// open to every non-auditor role — see canWriteLedgerEntry's own comment),
// this one moves a real account balance via update_account_balance
// (create_manual_ledger_entry — see its own migration comment), so it's
// gated the same as every other balance-moving RPC on this server, not the
// looser ledger_entries write policy.
router.post('/', requireUser, validateBody(validateParams), asyncWrapper(async (req, res) => {
  if (!isAdminAccountantOrSuperTeller(req.user)) throw new ApiError(403, 'Not authorized to record this entry');

  const { data, error } = await callRpcAsService('create_manual_ledger_entry', {
    p_party_name: req.body.p_party_name.trim(),
    p_entry_type: req.body.p_entry_type,
    p_branch_id: req.body.p_branch_id,
    p_account_name: req.body.p_account_name,
    p_amount_rwf: req.body.p_amount_rwf,
    p_currency: req.body.p_currency || 'RWF',
    p_amount_foreign: req.body.p_amount_foreign ?? null,
    p_party_phone: req.body.p_party_phone || null,
    p_party_email: req.body.p_party_email || null,
    p_expected_by: req.body.p_expected_by || null,
    p_notes: req.body.p_notes || null,
  });
  if (error) throw new ApiError(400, error.message);

  res.json(data);
}));

module.exports = router;
