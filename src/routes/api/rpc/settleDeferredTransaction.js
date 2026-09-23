const { Router } = require('express');
const { requireUser } = require('../../../middleware/auth');
const { validateBody } = require('../../../middleware/validate');
const { asyncWrapper } = require('../../../utils/asyncWrapper');
const { ApiError } = require('../../../utils/ApiError');
const { callRpcAsService } = require('../../../services/rpc');
const { canModifyBranchBalance } = require('../../../services/balanceAuth');
const { getTransactionBranchId } = require('../../../services/transactions');

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateParams(body) {
  if (typeof body?.p_tx_id !== 'string' || !UUID_RE.test(body.p_tx_id)) return 'p_tx_id must be a uuid';
  if (body.p_amount != null && (typeof body.p_amount !== 'number' || !Number.isFinite(body.p_amount))) return 'p_amount must be a number';
  return true;
}

// settle_deferred_transaction itself has NO authorization check (unlike
// update_account_balance) — any authenticated user could settle any
// pending transaction on any branch for an arbitrary amount. Node supplies
// the check that was missing, using the same branch/role rule as the
// other balance-moving RPCs (services/balanceAuth.js), then calls as
// service_role.
router.post('/', requireUser, validateBody(validateParams), asyncWrapper(async (req, res) => {
  const branchId = await getTransactionBranchId(req.body.p_tx_id);
  if (!branchId) throw new ApiError(404, 'Transaction not found');
  if (!canModifyBranchBalance(req.user, branchId)) {
    throw new ApiError(403, 'Not authorized to settle transactions for this branch');
  }

  const { error } = await callRpcAsService('settle_deferred_transaction', {
    p_tx_id: req.body.p_tx_id,
    p_amount: req.body.p_amount ?? null,
  });
  if (error) throw new ApiError(400, error.message);

  res.json({ ok: true });
}));

module.exports = router;
