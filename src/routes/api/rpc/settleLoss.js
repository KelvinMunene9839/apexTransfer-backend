const { Router } = require('express');
const { requireUser } = require('../../../middleware/auth');
const { validateBody } = require('../../../middleware/validate');
const { asyncWrapper } = require('../../../utils/asyncWrapper');
const { ApiError } = require('../../../utils/ApiError');
const { callRpcAsService, serviceClient } = require('../../../services/rpc');
const { canModifyBranchBalance } = require('../../../services/balanceAuth');

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);

function validateParams(body) {
  if (!isUuid(body?.p_loss_id)) return 'p_loss_id must be a uuid';
  if (body.p_amount != null && (typeof body.p_amount !== 'number' || !Number.isFinite(body.p_amount))) return 'p_amount must be a number';
  return true;
}

// settle_loss itself has no authorization check (same reasoning as
// settle_deferred_transaction — service_role bypasses it), so Node fetches
// the loss's branch first and applies the same balanceAuth rule every
// other balance-moving RPC uses.
router.post('/', requireUser, validateBody(validateParams), asyncWrapper(async (req, res) => {
  const { data: loss, error: fetchErr } = await serviceClient
    .from('losses').select('id, branch_id').eq('id', req.body.p_loss_id).maybeSingle();
  if (fetchErr) throw new ApiError(400, fetchErr.message);
  if (!loss) throw new ApiError(404, 'Loss not found');
  if (!canModifyBranchBalance(req.user, loss.branch_id)) {
    throw new ApiError(403, 'Not authorized to settle losses for this branch');
  }

  const { error } = await callRpcAsService('settle_loss', {
    p_loss_id: req.body.p_loss_id,
    p_amount: req.body.p_amount ?? null,
    p_settled_by: req.user.id,
  });
  if (error) throw new ApiError(400, error.message);

  res.json({ ok: true });
}));

module.exports = router;
