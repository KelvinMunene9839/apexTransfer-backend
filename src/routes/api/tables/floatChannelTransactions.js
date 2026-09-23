const { Router } = require('express');
const { requireUser } = require('../../../middleware/auth');
const { validateBody } = require('../../../middleware/validate');
const { asyncWrapper } = require('../../../utils/asyncWrapper');
const { ApiError } = require('../../../utils/ApiError');
const { callRpcAsService } = require('../../../services/rpc');
const { canCreateTransactionForTeller } = require('../../../services/balanceAuth');
const { getQuoteToRwfRate } = require('../../../services/transactionOps');
const { findRecentDuplicate } = require('../../../services/duplicateGuard');

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function resolveTellerId(user, bodyTellerId) {
  if (user.role === 'admin' || user.role === 'accountant') {
    return (isUuid(bodyTellerId) ? bodyTellerId : null) || user.id;
  }
  return user.id;
}

// Create — mirrors fct_teller_insert (teller/super_teller, own id) +
// fct_accountant_insert (accountant, any id) + fct_admin_all (admin, any
// id). Same identity-vs-role shape as transactions' insert rule, so this
// reuses canCreateTransactionForTeller rather than adding a duplicate.
// source_account/dest_account may be the literal string 'External' —
// TellerFloatTransfer.jsx's/SuperTellerAmin.jsx's sentinel for "no real
// account on this side, no leg" (see floatChannelOps.js).
function validateCreate(body) {
  if (typeof body?.reference !== 'string' || !body.reference) return 'reference is required';
  if (typeof body?.channel !== 'string' || !body.channel) return 'channel is required';
  if (body?.type !== 'deposit' && body?.type !== 'withdraw') return "type must be 'deposit' or 'withdraw'";
  if (!isNum(body?.amount) || body.amount <= 0) return 'amount must be a positive number';
  if (typeof body?.source_account !== 'string' || !body.source_account) return 'source_account is required';
  if (typeof body?.dest_account !== 'string' || !body.dest_account) return 'dest_account is required';
  if (!isUuid(body?.branch_id)) return 'branch_id must be a uuid';
  if (body.teller_id != null && !isUuid(body.teller_id)) return 'teller_id must be a uuid';
  if (body.fee_amount != null && (!isNum(body.fee_amount) || body.fee_amount < 0)) return 'fee_amount must be a non-negative number';
  // A transfer charge only ever debits a real source_account (see
  // floatChannelOps.js's own fee-leg comment) — a 'deposit' has none, so a
  // fee on one would silently vanish with no matching leg. Reject it here
  // instead of storing a value the ledger never actually reflects.
  if (Number(body.fee_amount) > 0 && body.type !== 'withdraw') return 'fee_amount only applies to withdraw (send) transactions';
  return true;
}

router.post('/', requireUser, validateBody(validateCreate), asyncWrapper(async (req, res) => {
  const b = req.body;
  const tellerId = resolveTellerId(req.user, b.teller_id);
  if (!canCreateTransactionForTeller(req.user, tellerId)) {
    throw new ApiError(403, 'Not authorized to create a float channel entry for this teller');
  }

  // See duplicateGuard.js's own comment. float_channel_transactions has no
  // `voided` column (it uses status='voided' instead — see
  // handleFloatChannelDeleteOrEdit) so excludeVoided is off here; a stale
  // match against an already-voided original is a rare, minor
  // inconvenience (a 45s wait), not a correctness issue.
  const { duplicate, error: dupErr } = await findRecentDuplicate('float_channel_transactions', {
    channel: b.channel, type: b.type, currency: b.currency || 'RWF', amount: b.amount,
    source_account: b.source_account, dest_account: b.dest_account, branch_id: b.branch_id,
  }, { excludeVoided: false });
  if (dupErr) throw new ApiError(400, dupErr.message);
  if (duplicate) {
    throw new ApiError(409, `This looks like a duplicate of ${duplicate.reference}, submitted ${Math.max(1, Math.round((Date.now() - new Date(duplicate.created_at).getTime()) / 1000))}s ago. If this is really a separate entry, wait a moment and resubmit.`);
  }

  const currency = b.currency || 'RWF';
  const feeAmount = Number(b.fee_amount) || 0;
  // A non-RWF leg's real balance change lives entirely in amount_foreign
  // (p_delta is 0 for it, by design) -- amount_rwf is purely this leg's
  // reporting figure, computed here in the backend (never in SQL) same as
  // every other cross-currency leg this session. Confirmed live: every
  // "Amin deposit" account_movements row before this fix reported
  // amount_rwf=0 for its whole history (48 rows found), because the RPC
  // never supplied an override and the leg's own p_delta is always 0.
  // Same rate covers the fee leg — a transfer charge is always quoted in
  // the same currency as the send it belongs to.
  const rwfRate = currency === 'RWF' ? 0 : await getQuoteToRwfRate(b.branch_id, currency);
  const amountRwfOverride = currency === 'RWF' ? null : b.amount * rwfRate;
  const feeRwfOverride = currency === 'RWF' || feeAmount <= 0 ? null : feeAmount * rwfRate;

  // Legs + row insert now happen atomically in one Postgres function — see
  // 20260826120200_atomic_channel_creation.sql. Previously these were two
  // separate steps (apply_balance_legs, then a plain insert); if the insert
  // failed after the legs had already committed, real money had moved with
  // no row left to show for it.
  const { data, error } = await callRpcAsService('create_float_channel_transaction', {
    p_reference: b.reference, p_channel: b.channel, p_type: b.type, p_amount: b.amount, p_currency: currency,
    p_source_account: b.source_account, p_dest_account: b.dest_account,
    p_branch_id: b.branch_id, p_teller_id: tellerId, p_notes: b.notes ?? null,
    p_desc_override: null, p_amount_rwf_override: amountRwfOverride,
    p_fee_amount: feeAmount, p_fee_amount_rwf_override: feeRwfOverride,
  });
  if (error) throw new ApiError(400, error.message);

  res.json(data);
}));

module.exports = router;
