const { Router } = require('express');
const { requireUser } = require('../../../middleware/auth');
const { validateBody } = require('../../../middleware/validate');
const { asyncWrapper } = require('../../../utils/asyncWrapper');
const { ApiError } = require('../../../utils/ApiError');
const { serviceClient } = require('../../../services/rpc');

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);

// Create — mirrors notif_insert exactly: with_check is just `true`, no
// role or recipient restriction at all (any authenticated user can
// notify any other user — dozens of call sites across ApprovalsPage.jsx/
// BranchApprovalsPage.jsx/notifyApprovers.js rely on this to push
// "your request was approved"-style notifications to someone else after
// an action). Mirrored as-is, not tightened, same as messages'/
// ledger_entries' own documented permissiveness. Accepts a single row or
// an array (many call sites .map() one row per recipient). sender_id is
// forced server-side (every existing call site left it unset/null,
// this is a strict improvement, not a behavior change); recipient_id is
// never forced, since notifying someone else is the entire point.
function validateRow(row) {
  if (typeof row?.type !== 'string' || !row.type) return 'type is required';
  if (typeof row?.title !== 'string' || !row.title) return 'title is required';
  if (row.recipient_id != null && !isUuid(row.recipient_id)) return 'recipient_id must be a uuid';
  return true;
}

function validateCreate(body) {
  const rows = Array.isArray(body) ? body : [body];
  if (rows.length === 0) return 'at least one entry is required';
  for (const row of rows) {
    const result = validateRow(row);
    if (result !== true) return result;
  }
  return true;
}

router.post('/', requireUser, validateBody(validateCreate), asyncWrapper(async (req, res) => {
  const rows = (Array.isArray(req.body) ? req.body : [req.body]).map((row) => ({
    type: row.type,
    title: row.title,
    body: row.body ?? null,
    recipient_id: row.recipient_id ?? null,
    sender_id: req.user.id,
    read: row.read ?? false,
    data: row.data ?? null,
  }));

  const { data, error } = await serviceClient.from('notifications').insert(rows).select();
  if (error) throw new ApiError(400, error.message);

  res.json(Array.isArray(req.body) ? data : data[0]);
}));

// Mark one notification read — mirrors notif_update's RLS (own
// recipient_id, or a broadcast row with recipient_id IS NULL).
router.patch('/:id/read', requireUser, asyncWrapper(async (req, res) => {
  if (!isUuid(req.params.id)) throw new ApiError(400, 'id must be a uuid');

  const { error } = await serviceClient
    .from('notifications')
    .update({ read: true })
    .eq('id', req.params.id)
    .or(`recipient_id.eq.${req.user.id},recipient_id.is.null`);
  if (error) throw new ApiError(400, error.message);

  res.json({ ok: true });
}));

// Mark every unread notification visible to the caller as read (own +
// broadcast) — mirrors NotifFeed.jsx's/Shell.jsx's/NotificationsPage.jsx's
// "mark all read" bulk update.
router.patch('/mark-all-read', requireUser, asyncWrapper(async (req, res) => {
  const { error } = await serviceClient
    .from('notifications')
    .update({ read: true })
    .eq('read', false)
    .or(`recipient_id.eq.${req.user.id},recipient_id.is.null`);
  if (error) throw new ApiError(400, error.message);

  res.json({ ok: true });
}));

module.exports = router;
