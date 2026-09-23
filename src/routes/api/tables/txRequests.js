const { Router } = require('express');
const { requireUser } = require('../../../middleware/auth');
const { asyncWrapper } = require('../../../utils/asyncWrapper');
const { ApiError } = require('../../../utils/ApiError');
const { serviceClient } = require('../../../services/rpc');
const { isAdminAccountantOrSuperTeller } = require('../../../services/balanceAuth');
const { approveTxRequest, SUPPORTED_ENTITY_TYPES } = require('../../../services/txRequestApproval');

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);

// Create a change-request row (edit/delete/add) — mirrors txreq_insert's
// own RLS, which is already this permissive: any authenticated user can
// insert any field_changes payload as long as teller_id is their own.
// This doesn't move money by itself, just queues something for admin
// review — the actual mutation happens later through the (still direct,
// deliberately deferred) approval flow. teller_id and status are always
// forced server-side, never trusted from the request body — matches every
// other wrapped route's pattern for "who did this".
router.post('/', requireUser, asyncWrapper(async (req, res) => {
  const { data, error } = await serviceClient
    .from('tx_requests')
    .insert({
      ...req.body,
      teller_id: req.user.id,
      status: 'pending',
    })
    .select()
    .single();
  if (error) throw new ApiError(400, error.message);

  res.json(data);
}));

// Admin rejects a pending request — no balance mutation, just a status
// flip. Mirrors txreq_update's RLS (admin/accountant/super_teller, same
// rule as payment_accounts' insert/delete — reused as-is).
router.patch('/:id/reject', requireUser, asyncWrapper(async (req, res) => {
  if (!isUuid(req.params.id)) throw new ApiError(400, 'id must be a uuid');
  if (!isAdminAccountantOrSuperTeller(req.user)) {
    throw new ApiError(403, 'Not authorized to reject this request');
  }

  const { error } = await serviceClient
    .from('tx_requests')
    .update({ status: 'rejected', reviewed_by: req.user.id, reviewed_at: new Date().toISOString() })
    .eq('id', req.params.id);
  if (error) throw new ApiError(400, error.message);

  res.json({ ok: true });
}));

// Approve a pending request whose entity_type is one of
// SUPPORTED_ENTITY_TYPES (see txRequestApproval.js — now all 9 tables the
// "add forgotten X" / edit-delete flow covers, not just the original 3) —
// the full claim -> dispatch -> reversal/reapplication -> notify sequence,
// moved server-side from ApprovalsPage.jsx's approveEditRequest. Any other
// entity_type is out of scope here — the frontend keeps its own original
// code path for those.
router.post('/:id/approve', requireUser, asyncWrapper(async (req, res) => {
  if (!isUuid(req.params.id)) throw new ApiError(400, 'id must be a uuid');
  if (!isAdminAccountantOrSuperTeller(req.user)) {
    throw new ApiError(403, 'Not authorized to approve this request');
  }

  const { data: reqRow, error: fetchErr } = await serviceClient
    .from('tx_requests').select('*').eq('id', req.params.id).maybeSingle();
  if (fetchErr) throw new ApiError(400, fetchErr.message);
  if (!reqRow) throw new ApiError(404, 'Request not found');
  // Old rows predating entity_type have it null — the frontend has always
  // treated that the same as 'transaction' (see ApprovalsPage.jsx's
  // `!req.entity_type || req.entity_type === 'transaction'` branch guard).
  const entityType = reqRow.entity_type || 'transaction';
  if (!SUPPORTED_ENTITY_TYPES.includes(entityType)) {
    throw new ApiError(400, `entity_type '${reqRow.entity_type}' is not handled by this route`);
  }

  const result = await approveTxRequest({ ...reqRow, entity_type: entityType }, req.user.id);
  res.json(result);
}));

module.exports = router;
