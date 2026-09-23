const { Router } = require('express');
const { requireUser } = require('../../../middleware/auth');
const { validateBody } = require('../../../middleware/validate');
const { asyncWrapper } = require('../../../utils/asyncWrapper');
const { ApiError } = require('../../../utils/ApiError');
const { callRpcAsService } = require('../../../services/rpc');
const { canModifyBranchBalance } = require('../../../services/balanceAuth');

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function validateParams(body) {
  if (!isUuid(body?.p_branch_id)) return 'p_branch_id must be a uuid';
  if (typeof body?.p_from_account !== 'string' || !body.p_from_account) return 'p_from_account is required';
  if (typeof body?.p_to_account !== 'string' || !body.p_to_account) return 'p_to_account is required';
  // TellerFxTransfer.jsx's own canSubmit already requires this (and
  // amount/converted-amount > 0) client-side; matches every other create
  // route's amount>0 gate (transactions.js, westernUnionTransactions.js,
  // etc.) — apply_internal_transfer itself has no such guard, so a zero,
  // negative, or same-account call would silently post a reversed or
  // no-op balance movement straight into account_movements.
  if (body?.p_from_account === body?.p_to_account) return 'p_from_account and p_to_account must differ';
  if (typeof body?.p_from_currency !== 'string' || !body.p_from_currency) return 'p_from_currency is required';
  if (typeof body?.p_to_currency !== 'string' || !body.p_to_currency) return 'p_to_currency is required';
  if (!isNum(body?.p_amount) || body.p_amount <= 0) return 'p_amount must be a positive number';
  if (!isNum(body?.p_converted_amount) || body.p_converted_amount <= 0) return 'p_converted_amount must be a positive number';
  for (const key of ['p_fee', 'p_amount_rwf', 'p_fee_rwf']) {
    if (body[key] != null && !isNum(body[key])) return `${key} must be a number`;
  }
  for (const key of ['p_description', 'p_fee_description', 'p_note']) {
    if (body[key] != null && typeof body[key] !== 'string') return `${key} must be a string`;
  }
  return true;
}

// apply_internal_transfer had no authorization check of its own, but is
// already transitively protected — both legs go through
// update_account_balance with the caller-supplied p_branch_id, so a
// foreign branch already fails there (confirmed by direct test). Node's
// check here isn't closing an open gap, just centralizing the entry point
// and matching every other wrapped RPC's shape. p_initiated_by set from
// the verified caller.
router.post('/', requireUser, validateBody(validateParams), asyncWrapper(async (req, res) => {
  if (!canModifyBranchBalance(req.user, req.body.p_branch_id)) {
    throw new ApiError(403, 'Not authorized to modify balances for this account/branch');
  }

  const { error } = await callRpcAsService('apply_internal_transfer', {
    p_branch_id: req.body.p_branch_id,
    p_from_account: req.body.p_from_account,
    p_to_account: req.body.p_to_account,
    p_from_currency: req.body.p_from_currency,
    p_to_currency: req.body.p_to_currency,
    p_amount: req.body.p_amount,
    p_converted_amount: req.body.p_converted_amount,
    p_fee: req.body.p_fee ?? 0,
    p_amount_rwf: req.body.p_amount_rwf ?? 0,
    p_fee_rwf: req.body.p_fee_rwf ?? 0,
    p_description: req.body.p_description ?? '',
    p_fee_description: req.body.p_fee_description ?? '',
    p_note: req.body.p_note ?? null,
    p_initiated_by: req.user.id,
  });
  if (error) throw new ApiError(400, error.message);

  res.json({ ok: true });
}));

module.exports = router;
