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

// Create a new inter-branch request — mirrors ibt_insert's own RLS
// (caller must belong to from_branch_id or hold a cross-branch role). Two
// callers: TellerInterBranchTx.jsx's live "submit new request" form, and
// ApprovalsPage.jsx's "forgotten transaction" backfill from an approved
// tx_requests row — field set covers both (quote_currency/
// equivalent_quote/quote_account only the live form sends).
const ALLOWED_INITIAL_STATUS = ['pending', 'pending_admin'];

function validateCreate(body) {
  if (!isUuid(body?.from_branch_id)) return 'from_branch_id must be a uuid';
  if (!isUuid(body?.to_branch_id)) return 'to_branch_id must be a uuid';
  if (typeof body?.type !== 'string' || !body.type) return 'type is required';
  if (typeof body?.currency !== 'string' || !body.currency) return 'currency is required';
  if (typeof body?.our_account !== 'string' || !body.our_account) return 'our_account is required';
  if (!isNum(body?.amount_foreign)) return 'amount_foreign must be a number';
  if (body.status != null && !ALLOWED_INITIAL_STATUS.includes(body.status)) return `status must be one of: ${ALLOWED_INITIAL_STATUS.join(', ')}`;
  return true;
}

router.post('/', requireUser, validateBody(validateCreate), asyncWrapper(async (req, res) => {
  if (!canModifyBranchBalance(req.user, req.body.from_branch_id)) {
    throw new ApiError(403, 'Not authorized to create a request for this branch');
  }

  // See duplicateGuard.js's own comment -- catches the double-submit race
  // that created real, duplicate, fully-settled trades (found and manually
  // reversed this session) at the one place that actually prevents it.
  const { duplicate, error: dupErr } = await findRecentDuplicate('inter_branch_txns', {
    from_branch_id: req.body.from_branch_id,
    to_branch_id: req.body.to_branch_id,
    type: req.body.type,
    currency: req.body.currency,
    amount_foreign: req.body.amount_foreign,
    initiated_by: req.body.initiated_by ?? req.user.id,
  });
  if (dupErr) throw new ApiError(400, dupErr.message);
  if (duplicate) {
    throw new ApiError(409, `This looks like a duplicate of ${duplicate.reference}, submitted ${Math.max(1, Math.round((Date.now() - new Date(duplicate.created_at).getTime()) / 1000))}s ago. If this is really a separate transfer, wait a moment and resubmit.`);
  }

  const { data, error } = await serviceClient
    .from('inter_branch_txns')
    .insert({
      reference: req.body.reference ?? undefined,
      type: req.body.type,
      from_branch_id: req.body.from_branch_id,
      to_branch_id: req.body.to_branch_id,
      pair_id: req.body.pair_id ?? null,
      currency: req.body.currency,
      amount_foreign: req.body.amount_foreign,
      rate_applied: req.body.rate_applied ?? null,
      standard_rate: req.body.standard_rate ?? null,
      special_rate_requested: !!req.body.special_rate_requested,
      threshold_rate_applied: !!req.body.threshold_rate_applied,
      equivalent_rwf: req.body.equivalent_rwf ?? 0,
      quote_currency: req.body.quote_currency ?? 'RWF',
      equivalent_quote: req.body.equivalent_quote ?? null,
      quote_account: req.body.quote_account ?? null,
      amount_paid: req.body.amount_paid ?? 0,
      pay_currency: req.body.pay_currency ?? 'rwf',
      pay_rwf: req.body.pay_rwf ?? null,
      pay_fx: req.body.pay_fx ?? null,
      pay_account_fx: req.body.pay_account_fx ?? null,
      our_account: req.body.our_account,
      initiated_by: req.body.initiated_by ?? req.user.id,
      status: req.body.status ?? 'pending',
      notes: req.body.notes ?? null,
    })
    .select()
    .single();
  if (error) throw new ApiError(400, error.message);

  res.json(data);
}));

// Admin approves a pending special-rate request — sends it on to the
// target branch. Mirrors ibt_update's RLS.
router.patch('/:id/approve-rate', requireUser, asyncWrapper(async (req, res) => {
  if (!isUuid(req.params.id)) throw new ApiError(400, 'id must be a uuid');

  const { data: tx, error: fetchErr } = await serviceClient
    .from('inter_branch_txns').select('id, from_branch_id').eq('id', req.params.id).maybeSingle();
  if (fetchErr) throw new ApiError(400, fetchErr.message);
  if (!tx) throw new ApiError(404, 'Request not found');
  if (!canModifyBranchBalance(req.user, tx.from_branch_id)) {
    throw new ApiError(403, 'Not authorized to review this request');
  }

  const { error } = await serviceClient
    .from('inter_branch_txns')
    .update({ status: 'pending', admin_reviewed_by: req.user.id, admin_reviewed_at: new Date().toISOString() })
    .eq('id', req.params.id);
  if (error) throw new ApiError(400, error.message);

  res.json({ ok: true });
}));

// Admin declines a pending special-rate request, optionally recommending
// an alternate rate. Mirrors ibt_update's RLS.
function validateDecline(body) {
  if (typeof body?.reason !== 'string' || !body.reason) return 'reason is required';
  if (body.recommendedRate != null && !isNum(body.recommendedRate)) return 'recommendedRate must be a number';
  return true;
}

router.patch('/:id/decline-rate', requireUser, validateBody(validateDecline), asyncWrapper(async (req, res) => {
  if (!isUuid(req.params.id)) throw new ApiError(400, 'id must be a uuid');

  const { data: tx, error: fetchErr } = await serviceClient
    .from('inter_branch_txns').select('id, from_branch_id').eq('id', req.params.id).maybeSingle();
  if (fetchErr) throw new ApiError(400, fetchErr.message);
  if (!tx) throw new ApiError(404, 'Request not found');
  if (!canModifyBranchBalance(req.user, tx.from_branch_id)) {
    throw new ApiError(403, 'Not authorized to review this request');
  }

  const { error } = await serviceClient
    .from('inter_branch_txns')
    .update({
      status: 'declined', admin_reviewed_by: req.user.id, admin_reviewed_at: new Date().toISOString(),
      rejection_reason: req.body.reason, recommended_rate: req.body.recommendedRate ?? null,
      recommendation_status: req.body.recommendedRate ? 'pending' : 'none',
    })
    .eq('id', req.params.id);
  if (error) throw new ApiError(400, error.message);

  res.json({ ok: true });
}));

// Both routes mirror ibt_update's own RLS rule (caller must belong to
// from_branch_id or hold a cross-branch role) — the teller who owns the
// original request is the one who responds to an admin's rate
// recommendation for it.

// When an admin declines a special-rate inter-branch request they may
// recommend an alternate rate instead. Accepting re-creates the request
// fresh at that rate, going straight to 'pending' (admin already endorsed
// this exact rate). Ported from src/lib/rateRecommendation.js's
// acceptInterBranchRateRecommendation, which now just calls this route —
// same fetch -> atomic claim -> insert-copy -> rollback-on-failure shape,
// just server-side instead of the frontend racing two Supabase calls.
router.post('/:id/accept-rate-recommendation', requireUser, asyncWrapper(async (req, res) => {
  if (!isUuid(req.params.id)) throw new ApiError(400, 'id must be a uuid');

  const { data: tx, error: fetchErr } = await serviceClient
    .from('inter_branch_txns').select('*').eq('id', req.params.id).maybeSingle();
  if (fetchErr) throw new ApiError(400, fetchErr.message);
  if (!tx) return res.json({ ok: false, message: 'Request not found.' });
  if (!canModifyBranchBalance(req.user, tx.from_branch_id)) {
    throw new ApiError(403, 'Not authorized to respond to this recommendation');
  }
  if (tx.recommendation_status !== 'pending') {
    return res.json({ ok: false, message: 'This recommendation has already been responded to.' });
  }
  if (!(Number(tx.recommended_rate) > 0)) {
    return res.json({ ok: false, message: 'No recommended rate on this request.' });
  }

  // Claim atomically before creating the new request — guards the same
  // double-accept race the original frontend code guarded against.
  const { data: claimedRows, error: claimErr } = await serviceClient
    .from('inter_branch_txns')
    .update({ recommendation_status: 'accepted' })
    .eq('id', tx.id).eq('recommendation_status', 'pending')
    .select('id');
  if (claimErr) throw new ApiError(400, claimErr.message);
  if (!claimedRows || claimedRows.length === 0) {
    return res.json({ ok: false, message: 'This recommendation has already been responded to.' });
  }

  const rate = Number(tx.recommended_rate);
  const newEquiv = Number(tx.amount_foreign || 0) * rate;

  const { data: created, error: insErr } = await serviceClient
    .from('inter_branch_txns')
    .insert({
      type: tx.type,
      from_branch_id: tx.from_branch_id,
      to_branch_id: tx.to_branch_id,
      pair_id: tx.pair_id,
      currency: tx.currency,
      amount_foreign: tx.amount_foreign,
      rate_applied: rate,
      equivalent_rwf: newEquiv,
      our_account: tx.our_account,
      initiated_by: tx.initiated_by,
      status: 'pending',
      notes: tx.notes,
    })
    .select('reference')
    .single();
  if (insErr) {
    // Nothing was created — safe to reopen so this can be retried.
    await serviceClient.from('inter_branch_txns').update({ recommendation_status: 'pending' }).eq('id', tx.id);
    return res.json({ ok: false, message: 'Failed to create new request: ' + insErr.message });
  }

  res.json({ ok: true, message: `${created.reference} created at the recommended rate and sent for approval.` });
}));

router.post('/:id/reject-rate-recommendation', requireUser, asyncWrapper(async (req, res) => {
  if (!isUuid(req.params.id)) throw new ApiError(400, 'id must be a uuid');

  const { data: tx, error: fetchErr } = await serviceClient
    .from('inter_branch_txns')
    .select('id, reference, recommendation_status, recommended_rate, admin_reviewed_by, from_branch_id')
    .eq('id', req.params.id).maybeSingle();
  if (fetchErr) throw new ApiError(400, fetchErr.message);
  if (!tx) return res.json({ ok: false, message: 'Request not found.' });
  if (!canModifyBranchBalance(req.user, tx.from_branch_id)) {
    throw new ApiError(403, 'Not authorized to respond to this recommendation');
  }
  if (tx.recommendation_status !== 'pending') {
    return res.json({ ok: false, message: 'This recommendation has already been responded to.' });
  }

  const { error: updErr } = await serviceClient
    .from('inter_branch_txns').update({ recommendation_status: 'declined' }).eq('id', tx.id);
  if (updErr) return res.json({ ok: false, message: 'Failed: ' + updErr.message });

  if (tx.admin_reviewed_by) {
    const rate = Number(tx.recommended_rate).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
    void serviceClient.from('notifications').insert({
      recipient_id: tx.admin_reviewed_by, type: 'rate_recommendation_rejected', read: false,
      title: 'Recommended rate rejected',
      body: `${tx.reference} · The teller rejected your recommended rate of ${rate}.`,
      data: { kind: 'inter_branch', txId: tx.id, ref: tx.reference },
    });
  }

  res.json({ ok: true, message: 'Recommendation rejected.' });
}));

// Receiving branch declines a pending inter-branch request. ibt_update's
// RLS allows either branch's teller (or a cross-branch role) — same
// OR-of-both-branches shape as branch_float_transfers' reject, even
// though only the receiving branch's UI exercises this today.
router.patch('/:id/reject', requireUser, asyncWrapper(async (req, res) => {
  if (!isUuid(req.params.id)) throw new ApiError(400, 'id must be a uuid');

  const { data: tx, error: fetchErr } = await serviceClient
    .from('inter_branch_txns').select('id, from_branch_id, to_branch_id').eq('id', req.params.id).maybeSingle();
  if (fetchErr) throw new ApiError(400, fetchErr.message);
  if (!tx) throw new ApiError(404, 'Request not found');
  if (!canModifyBranchBalance(req.user, tx.from_branch_id) && !canModifyBranchBalance(req.user, tx.to_branch_id)) {
    throw new ApiError(403, 'Not authorized to reject this request');
  }

  const { data: rows, error } = await serviceClient
    .from('inter_branch_txns')
    .update({ status: 'declined', reviewed_by: req.user.id, reviewed_at: new Date().toISOString() })
    .eq('id', req.params.id).eq('status', 'pending')
    .select('id');
  if (error) throw new ApiError(400, error.message);

  res.json({ ok: true, changed: (rows || []).length > 0 });
}));

module.exports = router;
