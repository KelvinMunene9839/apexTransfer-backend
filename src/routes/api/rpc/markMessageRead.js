const { Router } = require('express');
const { requireUser } = require('../../../middleware/auth');
const { validateBody } = require('../../../middleware/validate');
const { asyncWrapper } = require('../../../utils/asyncWrapper');
const { ApiError } = require('../../../utils/ApiError');
const { callRpcAsService } = require('../../../services/rpc');

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateParams(body) {
  if (typeof body?.p_message_id !== 'string' || !UUID_RE.test(body.p_message_id)) return 'p_message_id must be a uuid';
  return true;
}

// The RPC took p_user_id as a plain param with nothing verifying it matched
// the caller — a client could mark messages read on someone else's behalf
// (low severity: worst case is a missed-notification nuisance, not a
// financial risk, but trivial to close). Always overridden with the
// verified caller's own id, never trusted from the request body.
router.post('/', requireUser, validateBody(validateParams), asyncWrapper(async (req, res) => {
  const { error } = await callRpcAsService('mark_message_read', {
    p_message_id: req.body.p_message_id,
    p_user_id: req.user.id,
  });
  if (error) throw new ApiError(400, error.message);

  res.json({ ok: true });
}));

module.exports = router;
