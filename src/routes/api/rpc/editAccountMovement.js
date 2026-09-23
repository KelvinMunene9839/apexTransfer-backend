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
  if (body?.p_direction !== 'in' && body?.p_direction !== 'out') return "p_direction must be 'in' or 'out'";
  if (typeof body?.p_amount !== 'number' || !Number.isFinite(body.p_amount)) return 'p_amount must be a number';
  if (body.p_rate != null && (typeof body.p_rate !== 'number' || !Number.isFinite(body.p_rate))) return 'p_rate must be a number';
  if (body.p_description != null && typeof body.p_description !== 'string') return 'p_description must be a string';
  return true;
}

// Already had its own authorization check (admin or accountant only).
router.post('/', requireUser, validateBody(validateParams), asyncWrapper(async (req, res) => {
  if (!isAdminOrAccountant(req.user)) {
    throw new ApiError(403, 'Only admin or accountant can edit a balance adjustment');
  }

  const { error } = await callRpcAsService('edit_account_movement', {
    p_movement_id: req.body.p_movement_id,
    p_direction: req.body.p_direction,
    p_amount: req.body.p_amount,
    p_rate: req.body.p_rate ?? null,
    p_description: req.body.p_description ?? null,
  });
  if (error) throw new ApiError(400, error.message);

  res.json({ ok: true });
}));

module.exports = router;
