const { Router } = require('express');
const { requireUser } = require('../../../middleware/auth');
const { validateBody } = require('../../../middleware/validate');
const { asyncWrapper } = require('../../../utils/asyncWrapper');
const { ApiError } = require('../../../utils/ApiError');
const { callRpcAsService } = require('../../../services/rpc');
const { canModifyBranchBalance } = require('../../../services/balanceAuth');

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidLeg(leg) {
  if (typeof leg !== 'object' || leg === null) return false;
  if (typeof leg.name !== 'string' || !leg.name) return false;
  if (typeof leg.branch_id !== 'string' || !UUID_RE.test(leg.branch_id)) return false;
  if (typeof leg.delta !== 'number' || !Number.isFinite(leg.delta)) return false;
  if (leg.amount_foreign != null && typeof leg.amount_foreign !== 'number') return false;
  if (leg.currency != null && typeof leg.currency !== 'string') return false;
  if (leg.description != null && typeof leg.description !== 'string') return false;
  if (leg.transaction_id != null && (typeof leg.transaction_id !== 'string' || !UUID_RE.test(leg.transaction_id))) return false;
  if (leg.statement_category != null && typeof leg.statement_category !== 'string') return false;
  return true;
}

function validateLegs(body) {
  if (!Array.isArray(body?.legs) || body.legs.length === 0) {
    return 'legs must be a non-empty array';
  }
  if (!body.legs.every(isValidLeg)) {
    return 'each leg needs name (string), branch_id (uuid), delta (number), and optionally amount_foreign (number), currency (string), description (string), transaction_id (uuid)';
  }
  return true;
}

// Calls Postgres as service_role (see services/rpc.js), so — unlike when
// the DB itself gated this via update_account_balance's per-leg check —
// Node must authorize every leg itself before applying any of them. Checked
// against all legs up front, same all-or-nothing shape as the RPC's own
// atomicity: no partial application on a mixed-authority request.
router.post('/', requireUser, validateBody(validateLegs), asyncWrapper(async (req, res) => {
  const unauthorized = req.body.legs.find((leg) => !canModifyBranchBalance(req.user, leg.branch_id));
  if (unauthorized) {
    throw new ApiError(403, 'Not authorized to modify balances for this account/branch');
  }

  const p_legs = req.body.legs.map((leg) => ({
    name: leg.name,
    branch_id: leg.branch_id,
    delta: leg.delta,
    amount_foreign: leg.amount_foreign ?? null,
    currency: leg.currency ?? null,
    description: leg.description ?? '',
    transaction_id: leg.transaction_id ?? null,
    statement_category: leg.statement_category ?? null,
  }));

  const { error } = await callRpcAsService('apply_balance_legs', { p_legs });
  if (error) throw new ApiError(400, error.message);

  res.json({ ok: true });
}));

module.exports = router;
