const { Router } = require('express');
const { requireUser } = require('../../../middleware/auth');
const { validateBody } = require('../../../middleware/validate');
const { asyncWrapper } = require('../../../utils/asyncWrapper');
const { ApiError } = require('../../../utils/ApiError');
const { canModifyBranchBalance } = require('../../../services/balanceAuth');
const { reduceWacInventoryAcrossLots } = require('../../../services/balanceOps');

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateParams(body) {
  if (typeof body?.p_branch_id !== 'string' || !UUID_RE.test(body.p_branch_id)) return 'p_branch_id must be a uuid';
  if (typeof body?.p_currency !== 'string' || !body.p_currency) return 'p_currency is required';
  if (typeof body?.p_quantity !== 'number' || !Number.isFinite(body.p_quantity)) return 'p_quantity must be a number';
  if (body.p_cost_currency != null && typeof body.p_cost_currency !== 'string') return 'p_cost_currency must be a string';
  return true;
}

// Had no authorization check at all, and no transitive protection (doesn't
// route through update_account_balance) — any authenticated user could
// arbitrarily drain any branch's WAC inventory quantity/cost, corrupting
// profit/cost-basis calculations. Node supplies the same branch/role rule
// used everywhere else.
router.post('/', requireUser, validateBody(validateParams), asyncWrapper(async (req, res) => {
  if (!canModifyBranchBalance(req.user, req.body.p_branch_id)) {
    throw new ApiError(403, 'Not authorized to modify inventory for this branch');
  }

  const { error } = await reduceWacInventoryAcrossLots(
    req.body.p_branch_id, req.body.p_currency, req.body.p_quantity, req.body.p_cost_currency ?? 'RWF',
  );
  if (error) throw new ApiError(400, error.message);

  res.json({ ok: true });
}));

module.exports = router;
