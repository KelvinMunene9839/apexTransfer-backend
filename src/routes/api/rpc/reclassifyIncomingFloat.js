const { Router } = require('express');
const { requireUser } = require('../../../middleware/auth');
const { validateBody } = require('../../../middleware/validate');
const { asyncWrapper } = require('../../../utils/asyncWrapper');
const { ApiError } = require('../../../utils/ApiError');
const { callRpcAsService } = require('../../../services/rpc');
const { isAdminOrAccountant } = require('../../../services/balanceAuth');

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateParams(body) {
  if (typeof body?.p_movement_id !== 'string' || !UUID_RE.test(body.p_movement_id)) return 'p_movement_id must be a uuid';
  return true;
}

// Already had its own authorization check (admin or accountant only).
router.post('/', requireUser, validateBody(validateParams), asyncWrapper(async (req, res) => {
  if (!isAdminOrAccountant(req.user)) {
    throw new ApiError(403, 'Only admin or accountant can reclassify a balance adjustment');
  }

  const { error } = await callRpcAsService('reclassify_incoming_float', {
    p_movement_id: req.body.p_movement_id,
  });
  if (error) throw new ApiError(400, error.message);

  res.json({ ok: true });
}));

module.exports = router;
