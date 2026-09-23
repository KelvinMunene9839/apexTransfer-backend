const { Router } = require('express');
const { requireUser } = require('../../../middleware/auth');
const { validateBody } = require('../../../middleware/validate');
const { asyncWrapper } = require('../../../utils/asyncWrapper');
const { ApiError } = require('../../../utils/ApiError');
const { callRpcAsService } = require('../../../services/rpc');
const { isAdminOrAccountant } = require('../../../services/balanceAuth');

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);

function validateParams(body) {
  if (!isUuid(body?.p_loss_id)) return 'p_loss_id must be a uuid';
  return true;
}

// Correction safety-valve for a loss entered in error — stricter than
// settling (admin/accountant only, no super_teller/own-branch fallback),
// matching voidAccountMovement's own gate.
router.post('/', requireUser, validateBody(validateParams), asyncWrapper(async (req, res) => {
  if (!isAdminOrAccountant(req.user)) {
    throw new ApiError(403, 'Only admin or accountant can void a loss');
  }

  const { error } = await callRpcAsService('void_loss', {
    p_loss_id: req.body.p_loss_id,
    p_voided_by: req.user.id,
  });
  if (error) throw new ApiError(400, error.message);

  res.json({ ok: true });
}));

module.exports = router;
