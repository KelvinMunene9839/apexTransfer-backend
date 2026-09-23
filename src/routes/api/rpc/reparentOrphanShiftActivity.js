const { Router } = require('express');
const { requireUser } = require('../../../middleware/auth');
const { validateBody } = require('../../../middleware/validate');
const { asyncWrapper } = require('../../../utils/asyncWrapper');
const { ApiError } = require('../../../utils/ApiError');
const { callRpcAsService } = require('../../../services/rpc');

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

function validateParams(body) {
  if (typeof body?.p_shift_id !== 'string' || !UUID_RE.test(body.p_shift_id)) return 'p_shift_id must be a uuid';
  if (typeof body?.p_since !== 'string' || !ISO_RE.test(body.p_since)) return 'p_since must be an ISO timestamp';
  return true;
}

// Self-scoped by design (only ever touches the caller's own shift/activity
// rows) — no separate authorization needed beyond being logged in. Calls
// as service_role with p_teller_id set from the verified caller, since
// auth.uid() resolves to NULL under service_role (see
// reparent_orphan_shift_activity_explicit_teller_id.sql) and this
// function's ownership check is keyed on it, not just gated by it.
router.post('/', requireUser, validateBody(validateParams), asyncWrapper(async (req, res) => {
  const { error } = await callRpcAsService('reparent_orphan_shift_activity', {
    p_shift_id: req.body.p_shift_id,
    p_since: req.body.p_since,
    p_teller_id: req.user.id,
  });
  if (error) throw new ApiError(400, error.message);

  res.json({ ok: true });
}));

module.exports = router;
