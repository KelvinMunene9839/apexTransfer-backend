const { Router } = require('express');
const { requireUser } = require('../../../middleware/auth');
const { validateBody } = require('../../../middleware/validate');
const { asyncWrapper } = require('../../../utils/asyncWrapper');
const { ApiError } = require('../../../utils/ApiError');
const { serviceClient } = require('../../../services/rpc');
const { canModifyShift, isAdminOrAccountant } = require('../../../services/balanceAuth');

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);

function resolveTellerId(user, bodyTellerId) {
  if (user.role === 'admin' || user.role === 'accountant') {
    return (isUuid(bodyTellerId) ? bodyTellerId : null) || user.id;
  }
  return user.id;
}

// Start a shift — mirrors shifts_own_teller's write check (own id, or
// admin/accountant for anyone). opening_float/declared_balances are the
// client's own carry-forward computation (ShiftPage.jsx's "corrected =
// declaredClosing + (liveNow - systemAtThatClose)" logic) — that math is
// informational bookkeeping, not a balance-moving operation, so it's kept
// client-side and just persisted here; the two DB unique indexes
// (idx_shifts_one_active_per_teller, idx_shifts_one_open_per_branch) are
// still the real guard against a double-open, same as before this route
// existed. status is never accepted from the client — every shift starts
// 'open'.
function validateCreate(body) {
  if (!isUuid(body?.branch_id)) return 'branch_id must be a uuid';
  if (body.teller_id != null && !isUuid(body.teller_id)) return 'teller_id must be a uuid';
  if (body.opening_float != null && typeof body.opening_float !== 'object') return 'opening_float must be an object';
  if (body.declared_balances != null && typeof body.declared_balances !== 'object') return 'declared_balances must be an object';
  return true;
}

router.post('/', requireUser, validateBody(validateCreate), asyncWrapper(async (req, res) => {
  const b = req.body;
  const tellerId = resolveTellerId(req.user, b.teller_id);
  if (!canModifyShift(req.user, tellerId)) {
    throw new ApiError(403, 'Not authorized to start a shift for this teller');
  }

  const { data, error } = await serviceClient
    .from('shifts')
    .insert({
      teller_id: tellerId,
      branch_id: b.branch_id,
      opened_at: b.opened_at ?? new Date().toISOString(),
      opening_float: b.opening_float ?? {},
      declared_balances: b.declared_balances ?? null,
    })
    .select()
    .single();
  // 23505 = unique_violation on idx_shifts_one_active_per_teller or
  // idx_shifts_one_open_per_branch — Postgres's own error message names
  // the constraint, which is all ShiftPage.jsx's existing branch-conflict-
  // vs-own-conflict message logic actually inspects (a regex on the
  // message text, not a structured code — this backend's error responses
  // only ever carry a message, same as every other route), so forwarding
  // it unchanged keeps that logic working.
  if (error) throw new ApiError(400, error.message);

  res.json(data);
}));

// Teller submits their own open shift for closing review — mirrors
// ShiftPage.jsx's submitForClosing. No current-status filter (matches the
// original: a 'rejected' shift resubmits through this same call).
function validateSubmitClose(body) {
  if (body.closing_calculated != null && typeof body.closing_calculated !== 'object') return 'closing_calculated must be an object';
  if (body.declared_balances_patch != null && typeof body.declared_balances_patch !== 'object') return 'declared_balances_patch must be an object';
  return true;
}

// A shift's declared/closing balances aren't final while something that
// still touches this teller's drawer or their branch's position is
// undecided: an edit/delete request they filed could still change a
// transaction's recorded amount; an inter-branch trade or float transfer
// they sent could still be declined (reversing nothing, since it never
// posted) or approved (posting after the shift already closed); one sent
// TO their branch is exactly as live until this branch acts on it. All
// three tables use 'pending' for "not yet decided" (confirmed against
// production data, not assumed from the schema alone). tx_requests has no
// "received" side here — approving those requires admin/accountant/
// super_teller (isAdminAccountantOrSuperTeller in balanceAuth.js), never
// the teller/branch_manager who owns the shift being closed.
//
// Special-rate requests are a second, separate unposted-money case, not
// covered by the three tables above:
//   - transactions.payment_status = 'pending_approval' — set the moment a
//     teller checks "Request special rate"; TransactionForm.jsx /
//     transactionOps.js post neither leg while it's in this state (see
//     transactions.js's own "pending_approval never posted its legs"
//     comment), so it's exactly the same unfinalized-money shape as the
//     three tables above, just tracked on the transaction row itself.
//   - transactions.recommendation_status = 'pending' — a further sub-state
//     after admin declines a requested rate but offers an alternate one
//     (payment_status flips to 'rejected' at that point, so the
//     pending_approval check alone would miss it); the teller hasn't
//     accepted/declined the recommendation yet, and accepting it posts
//     legs at the new rate — still unposted money.
//   - inter_branch_txns carries the same recommendation_status column, and
//     its own status gets a third value special-rate requests pass through
//     first: 'pending_admin' (before the normal 'pending' hand-off to the
//     destination branch even begins) — the existing sent-side status
//     filter is widened to include it. Not relevant on the received side:
//     a 'pending_admin' row hasn't reached the destination branch for
//     action yet, so there's nothing for that branch to have overlooked.
async function findPendingShiftBlockers(tellerId, branchId) {
  const [txReq, txSpecialRate, sentTrades, recvTrades, sentTransfers, recvTransfers] = await Promise.all([
    serviceClient.from('tx_requests').select('id', { count: 'exact', head: true }).eq('teller_id', tellerId).eq('status', 'pending'),
    serviceClient.from('transactions').select('id', { count: 'exact', head: true }).eq('teller_id', tellerId)
      .or('payment_status.eq.pending_approval,recommendation_status.eq.pending'),
    serviceClient.from('inter_branch_txns').select('id', { count: 'exact', head: true }).eq('initiated_by', tellerId)
      .or('status.in.(pending,pending_admin),recommendation_status.eq.pending'),
    serviceClient.from('inter_branch_txns').select('id', { count: 'exact', head: true }).eq('to_branch_id', branchId).eq('status', 'pending'),
    serviceClient.from('branch_float_transfers').select('id', { count: 'exact', head: true }).eq('initiated_by', tellerId).eq('status', 'pending'),
    serviceClient.from('branch_float_transfers').select('id', { count: 'exact', head: true }).eq('to_branch_id', branchId).eq('status', 'pending'),
  ]);
  for (const r of [txReq, txSpecialRate, sentTrades, recvTrades, sentTransfers, recvTransfers]) {
    if (r.error) throw new ApiError(400, r.error.message);
  }

  const sent = (txReq.count || 0) + (txSpecialRate.count || 0) + (sentTrades.count || 0) + (sentTransfers.count || 0);
  const received = (recvTrades.count || 0) + (recvTransfers.count || 0);
  if (sent === 0 && received === 0) return null;

  const parts = [];
  if (sent > 0) parts.push(`${sent} you've sent that ${sent === 1 ? "hasn't" : "haven't"} been approved yet`);
  if (received > 0) parts.push(`${received} sent to your branch that ${received === 1 ? "hasn't" : "haven't"} been actioned yet`);
  return `Cannot submit shift for closing: ${parts.join(' and ')}. Resolve these first.`;
}

router.patch('/:id/submit-close', requireUser, validateBody(validateSubmitClose), asyncWrapper(async (req, res) => {
  if (!isUuid(req.params.id)) throw new ApiError(400, 'id must be a uuid');

  const { data: shift, error: fetchErr } = await serviceClient.from('shifts').select('teller_id, branch_id, declared_balances').eq('id', req.params.id).maybeSingle();
  if (fetchErr) throw new ApiError(400, fetchErr.message);
  if (!shift) throw new ApiError(404, 'Shift not found');
  if (!canModifyShift(req.user, shift.teller_id)) throw new ApiError(403, 'Not authorized to submit this shift');

  const blockReason = await findPendingShiftBlockers(shift.teller_id, shift.branch_id);
  if (blockReason) throw new ApiError(409, blockReason);

  const { error } = await serviceClient
    .from('shifts')
    .update({
      status: 'pending_close',
      closing_calculated: req.body.closing_calculated ?? null,
      declared_balances: { ...(shift.declared_balances || {}), ...(req.body.declared_balances_patch || {}) },
    })
    .eq('id', req.params.id);
  if (error) throw new ApiError(400, error.message);

  res.json({ ok: true });
}));

// Admin/accountant approves a pending-close shift — mirrors the shared
// approve-close logic duplicated across ShiftPage.jsx (ManagerShiftView),
// ShiftReviewPage.jsx, AccountantDashboard.jsx, and ApprovalsPage.jsx.
// closing_calculated is optional: AccountantDashboard's "quick approve"
// never recomputes it (trusts the figure the teller already submitted),
// while the other three screens recompute fresh right before approving —
// both behaviors are preserved by only touching the column when a value
// is actually sent. Atomic .eq('status','pending_close') claim guards
// against the same shift being approved/rejected twice from two of these
// four screens at once.
function validateApproveClose(body) {
  if (body?.closing_calculated != null && typeof body.closing_calculated !== 'object') return 'closing_calculated must be an object';
  return true;
}

router.patch('/:id/approve-close', requireUser, validateBody(validateApproveClose), asyncWrapper(async (req, res) => {
  if (!isUuid(req.params.id)) throw new ApiError(400, 'id must be a uuid');
  if (!isAdminOrAccountant(req.user)) throw new ApiError(403, 'Not authorized to approve this shift');

  const patch = { status: 'closed', closed_by: req.user.id, closed_at: new Date().toISOString() };
  if (req.body?.closing_calculated !== undefined) patch.closing_calculated = req.body.closing_calculated;

  const { data: rows, error } = await serviceClient
    .from('shifts').update(patch).eq('id', req.params.id).eq('status', 'pending_close').select('id, teller_id, opened_at');
  if (error) throw new ApiError(400, error.message);
  if (!rows?.length) return res.json({ ok: false, message: 'This shift was already handled by someone else.' });

  const shift = rows[0];
  if (shift.teller_id) {
    void serviceClient.from('notifications').insert({
      recipient_id: shift.teller_id, type: 'shift_approved', read: false,
      title: 'Shift approved',
      body: `Your shift from ${new Date(shift.opened_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} has been approved and closed.`,
    });
  }

  res.json({ ok: true });
}));

function validateRejectClose(body) {
  if (body?.reason != null && typeof body.reason !== 'string') return 'reason must be a string';
  return true;
}

router.patch('/:id/reject-close', requireUser, validateBody(validateRejectClose), asyncWrapper(async (req, res) => {
  if (!isUuid(req.params.id)) throw new ApiError(400, 'id must be a uuid');
  if (!isAdminOrAccountant(req.user)) throw new ApiError(403, 'Not authorized to reject this shift');

  const reason = req.body?.reason?.trim() || 'Shift closing rejected — correct the flagged issues and resubmit for approval.';
  const { data: rows, error } = await serviceClient
    .from('shifts')
    .update({ status: 'rejected', closing_calculated: null, rejection_reason: reason })
    .eq('id', req.params.id).eq('status', 'pending_close')
    .select('id, teller_id');
  if (error) throw new ApiError(400, error.message);
  if (!rows?.length) return res.json({ ok: false, message: 'This shift was already handled by someone else.' });

  const shift = rows[0];
  if (shift.teller_id) {
    // Notification body is the same `reason` value just saved as
    // rejection_reason — ApprovalsPage.jsx/ShiftReviewPage.jsx pass a
    // custom teller-facing reason here and expect the notification to
    // show it verbatim; ShiftPage.jsx/AccountantDashboard.jsx never pass
    // one, so both fields fall back to the same default string.
    void serviceClient.from('notifications').insert({
      recipient_id: shift.teller_id, type: 'shift_rejected', read: false,
      title: 'Shift closing rejected', body: reason,
    });
  }

  res.json({ ok: true });
}));

module.exports = router;
