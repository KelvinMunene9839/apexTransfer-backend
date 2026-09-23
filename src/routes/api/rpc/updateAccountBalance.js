const { Router } = require('express');
const { requireUser } = require('../../../middleware/auth');
const { validateBody } = require('../../../middleware/validate');
const { asyncWrapper } = require('../../../utils/asyncWrapper');
const { ApiError } = require('../../../utils/ApiError');
const { callRpcAsService } = require('../../../services/rpc');
const { canModifyBranchBalance } = require('../../../services/balanceAuth');

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateParams(body) {
  if (typeof body?.p_name !== 'string' || !body.p_name) return 'p_name (string) is required';
  if (typeof body?.p_branch_id !== 'string' || !UUID_RE.test(body.p_branch_id)) return 'p_branch_id must be a uuid';
  if (typeof body?.p_delta !== 'number' || !Number.isFinite(body.p_delta)) return 'p_delta must be a number';
  if (body.p_transaction_id != null && (typeof body.p_transaction_id !== 'string' || !UUID_RE.test(body.p_transaction_id))) return 'p_transaction_id must be a uuid';
  if (body.p_description != null && typeof body.p_description !== 'string') return 'p_description must be a string';
  if (body.p_amount_foreign != null && typeof body.p_amount_foreign !== 'number') return 'p_amount_foreign must be a number';
  if (body.p_currency != null && typeof body.p_currency !== 'string') return 'p_currency must be a string';
  if (body.p_source_type != null && typeof body.p_source_type !== 'string') return 'p_source_type must be a string';
  if (body.p_statement_category != null && typeof body.p_statement_category !== 'string') return 'p_statement_category must be a string';
  if (body.p_amount_rwf_override != null && typeof body.p_amount_rwf_override !== 'number') return 'p_amount_rwf_override must be a number';
  return true;
}

// Calls Postgres as service_role (see services/rpc.js) — so the
// authorization that used to happen inside update_account_balance happens
// here instead, against req.user (loaded by requireUser from the caller's
// own JWT).
router.post('/', requireUser, validateBody(validateParams), asyncWrapper(async (req, res) => {
  if (!canModifyBranchBalance(req.user, req.body.p_branch_id)) {
    throw new ApiError(403, 'Not authorized to modify balances for this account/branch');
  }

  const params = {
    p_name: req.body.p_name,
    p_branch_id: req.body.p_branch_id,
    p_delta: req.body.p_delta,
    p_transaction_id: req.body.p_transaction_id ?? null,
    p_description: req.body.p_description ?? '',
    p_amount_foreign: req.body.p_amount_foreign ?? null,
    p_currency: req.body.p_currency ?? null,
    p_source_type: req.body.p_source_type ?? 'float',
    p_statement_category: req.body.p_statement_category ?? null,
    p_amount_rwf_override: req.body.p_amount_rwf_override ?? null,
  };

  const { error } = await callRpcAsService('update_account_balance', params);
  if (error) throw new ApiError(400, error.message);

  res.json({ ok: true });
}));

module.exports = router;
