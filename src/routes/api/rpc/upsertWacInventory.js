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
  if (typeof body?.p_branch_id !== 'string' || !UUID_RE.test(body.p_branch_id)) return 'p_branch_id must be a uuid';
  if (typeof body?.p_currency !== 'string' || !body.p_currency) return 'p_currency is required';
  // Unlike reduce_wac_inventory (clamped at zero by reduceWacInventoryAcrossLots'
  // own guard), upsert_wac_inventory ADDS p_quantity/p_cost_rwf straight onto
  // the existing lot with no floor — every real call site (restocks/incoming
  // float/dispatch, see FloatPage.jsx/InventoryPage.jsx/BranchAccountsPage.jsx/
  // pendingApprovalLegs.js) is already a positive "stock coming in" amount, so
  // this just closes the gap for any other caller sending zero/negative and
  // silently driving a lot's quantity below zero or corrupting its wac_rate.
  if (typeof body?.p_quantity !== 'number' || !Number.isFinite(body.p_quantity) || body.p_quantity <= 0) return 'p_quantity must be a positive number';
  if (typeof body?.p_cost_rwf !== 'number' || !Number.isFinite(body.p_cost_rwf) || body.p_cost_rwf < 0) return 'p_cost_rwf must be a non-negative number';
  if (body.p_cost_currency != null && typeof body.p_cost_currency !== 'string') return 'p_cost_currency must be a string';
  return true;
}

// Same missing-authorization gap as reduce_wac_inventory — see that route.
router.post('/', requireUser, validateBody(validateParams), asyncWrapper(async (req, res) => {
  if (!canModifyBranchBalance(req.user, req.body.p_branch_id)) {
    throw new ApiError(403, 'Not authorized to modify inventory for this branch');
  }

  const { error } = await callRpcAsService('upsert_wac_inventory', {
    p_branch_id: req.body.p_branch_id,
    p_currency: req.body.p_currency,
    p_quantity: req.body.p_quantity,
    p_cost_rwf: req.body.p_cost_rwf,
    p_cost_currency: req.body.p_cost_currency ?? 'RWF',
  });
  if (error) throw new ApiError(400, error.message);

  res.json({ ok: true });
}));

module.exports = router;
