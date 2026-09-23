const { Router } = require('express');
const { requireUser } = require('../../../middleware/auth');
const { validateBody } = require('../../../middleware/validate');
const { asyncWrapper } = require('../../../utils/asyncWrapper');
const { ApiError } = require('../../../utils/ApiError');
const { serviceClient } = require('../../../services/rpc');
const { canModifyBranchBalance } = require('../../../services/balanceAuth');
const { findRecentDuplicate } = require('../../../services/duplicateGuard');

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// Create a new branch float transfer request — mirrors bft_insert's own
// RLS (caller must belong to from_branch_id or hold a cross-branch role).
// Shared by TellerBranchTransfer.jsx's live handleSend and
// ApprovalsPage.jsx's "forgotten transaction" backfill — same field shape.
function validateCreate(body) {
  if (!isUuid(body?.from_branch_id)) return 'from_branch_id must be a uuid';
  if (!isUuid(body?.to_branch_id)) return 'to_branch_id must be a uuid';
  if (typeof body?.currency !== 'string' || !body.currency) return 'currency is required';
  if (!isNum(body?.amount)) return 'amount must be a number';
  if (typeof body?.from_account !== 'string' || !body.from_account) return 'from_account is required';
  if (body.fee_amount != null && !isNum(body.fee_amount)) return 'fee_amount must be a number';
  return true;
}

router.post('/', requireUser, validateBody(validateCreate), asyncWrapper(async (req, res) => {
  if (!canModifyBranchBalance(req.user, req.body.from_branch_id)) {
    throw new ApiError(403, 'Not authorized to create a transfer for this branch');
  }

  // See duplicateGuard.js's own comment -- catches the double-submit race
  // that created real, duplicate, fully-settled transfers (found and
  // manually reversed this session, e.g. BFT-LUT6P9/BFT-LUTMO4) at the one
  // place that actually prevents it.
  const { duplicate, error: dupErr } = await findRecentDuplicate('branch_float_transfers', {
    from_branch_id: req.body.from_branch_id,
    to_branch_id: req.body.to_branch_id,
    currency: req.body.currency,
    amount: req.body.amount,
    from_account: req.body.from_account,
    initiated_by: req.body.initiated_by ?? req.user.id,
  });
  if (dupErr) throw new ApiError(400, dupErr.message);
  if (duplicate) {
    throw new ApiError(409, `This looks like a duplicate of ${duplicate.reference}, submitted ${Math.max(1, Math.round((Date.now() - new Date(duplicate.created_at).getTime()) / 1000))}s ago. If this is really a separate transfer, wait a moment and resubmit.`);
  }

  const { data, error } = await serviceClient
    .from('branch_float_transfers')
    .insert({
      reference: req.body.reference ?? undefined,
      from_branch_id: req.body.from_branch_id,
      to_branch_id: req.body.to_branch_id,
      currency: req.body.currency,
      amount: req.body.amount,
      fee_amount: req.body.fee_amount ?? 0,
      from_account: req.body.from_account,
      initiated_by: req.body.initiated_by ?? req.user.id,
      status: 'pending',
    })
    .select()
    .single();
  if (error) throw new ApiError(400, error.message);

  res.json(data);
}));

// Receiving branch declines a pending transfer. bft_update's RLS allows
// either branch's teller (or a cross-branch role) — same OR-of-both-
// branches shape, even though only the receiving branch's UI ever
// exercises this in practice.
router.patch('/:id/reject', requireUser, asyncWrapper(async (req, res) => {
  if (!isUuid(req.params.id)) throw new ApiError(400, 'id must be a uuid');

  const { data: tx, error: fetchErr } = await serviceClient
    .from('branch_float_transfers').select('id, from_branch_id, to_branch_id').eq('id', req.params.id).maybeSingle();
  if (fetchErr) throw new ApiError(400, fetchErr.message);
  if (!tx) throw new ApiError(404, 'Transfer not found');
  if (!canModifyBranchBalance(req.user, tx.from_branch_id) && !canModifyBranchBalance(req.user, tx.to_branch_id)) {
    throw new ApiError(403, 'Not authorized to reject this transfer');
  }

  const { data: rows, error } = await serviceClient
    .from('branch_float_transfers')
    .update({ status: 'rejected' })
    .eq('id', req.params.id).eq('status', 'pending')
    .select('id');
  if (error) throw new ApiError(400, error.message);

  res.json({ ok: true, changed: (rows || []).length > 0 });
}));

module.exports = router;
