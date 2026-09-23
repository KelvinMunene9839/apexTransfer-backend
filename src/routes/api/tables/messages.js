const { Router } = require('express');
const { requireUser } = require('../../../middleware/auth');
const { validateBody } = require('../../../middleware/validate');
const { asyncWrapper } = require('../../../utils/asyncWrapper');
const { ApiError } = require('../../../utils/ApiError');
const { serviceClient } = require('../../../services/rpc');

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);

// Create — mirrors msg_insert exactly: any authenticated user, no role or
// broadcast restriction (RLS never gated is_broadcast/recipient_branch —
// AdminChatPage.jsx being the only UI that offers broadcast is a
// client-side convenience, not an enforced rule; mirrored as-is, not
// tightened, same as ledger_entries' own permissiveness). Shared by
// AdminChatPage.jsx's and ChatPage.jsx's sendMessage — identical insert
// shape. sender_id/read_by are always forced server-side (never trusted
// from the client, same as every other "who did this" field in this
// migration); sent_at is left to the column's own now() default rather
// than trusting the client's clock.
function validateCreate(body) {
  if (typeof body?.body !== 'string' || !body.body.trim()) return 'body is required';
  if (body.sender_branch != null && !isUuid(body.sender_branch)) return 'sender_branch must be a uuid';
  if (body.recipient_branch != null && !isUuid(body.recipient_branch)) return 'recipient_branch must be a uuid';
  if (body.is_broadcast != null && typeof body.is_broadcast !== 'boolean') return 'is_broadcast must be a boolean';
  return true;
}

router.post('/', requireUser, validateBody(validateCreate), asyncWrapper(async (req, res) => {
  const b = req.body;

  const { data, error } = await serviceClient
    .from('messages')
    .insert({
      sender_id: req.user.id,
      sender_branch: b.sender_branch ?? null,
      recipient_branch: b.is_broadcast ? null : (b.recipient_branch ?? null),
      body: b.body.trim(),
      is_broadcast: !!b.is_broadcast,
      read_by: [req.user.id],
    })
    .select()
    .single();
  if (error) throw new ApiError(400, error.message);

  res.json(data);
}));

module.exports = router;
