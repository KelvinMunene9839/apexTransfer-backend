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
  if (typeof body?.p_entry_id !== 'string' || !UUID_RE.test(body.p_entry_id)) return 'p_entry_id must be a uuid';
  if (typeof body?.p_approve !== 'boolean') return 'p_approve must be a boolean';
  if (body.p_reject_reason != null && typeof body.p_reject_reason !== 'string') return 'p_reject_reason must be a string';
  return true;
}

// Already had its own authorization check (admin or accountant only, no
// branch fallback) — reused as isAdminOrAccountant. p_reviewer_id is set
// from the verified caller, not trusted from the request body.
router.post('/', requireUser, validateBody(validateParams), asyncWrapper(async (req, res) => {
  if (!isAdminOrAccountant(req.user)) {
    throw new ApiError(403, 'Only admin or accountant can approve cash in/out entries');
  }

  const { error } = await callRpcAsService('approve_petit_cash_entry', {
    p_entry_id: req.body.p_entry_id,
    p_approve: req.body.p_approve,
    p_reviewer_id: req.user.id,
    p_reject_reason: req.body.p_reject_reason ?? null,
  });
  if (error) throw new ApiError(400, error.message);

  res.json({ ok: true });
}));

module.exports = router;
