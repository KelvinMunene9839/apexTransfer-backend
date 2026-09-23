const { Router } = require('express');
const { requireUser } = require('../../../middleware/auth');
const { validateBody } = require('../../../middleware/validate');
const { asyncWrapper } = require('../../../utils/asyncWrapper');
const { ApiError } = require('../../../utils/ApiError');
const { callRpcAsService } = require('../../../services/rpc');
const { canCreateTransactionForTeller } = require('../../../services/balanceAuth');
const { upsertWacInventory, reduceWacInventoryAcrossLots } = require('../../../services/balanceOps');
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

// Create — mirrors wu_teller_insert (teller/super_teller, own id) +
// wu_accountant_insert (accountant, any id) + wu_admin_all (admin, any
// id), same identity-vs-role shape as ria_transactions/transactions'
// insert rules. Void/edit only ever happen through the tx_requests
// approval flow (no direct UI action outside it, see ApprovalsPage.jsx),
// so this is the only public endpoint this table needs.
//
// Like transactions.js's own create route, the already-computed numeric
// fields (equivalent_rwf, amount_paid, pay_rwf, pay_fx) are trusted as
// sent by the client rather than re-derived from raw inputs — the same
// trust boundary this table had under RLS before migration (a caller
// authorized to write here was always free to pick their own amounts;
// what's actually enforced is who can act as which teller/branch, and
// applyBalanceLegs' own overdraft checks). source_account/dest_account
// are the one thing derived server-side (svcAccounts), never accepted
// from the client, since svcLegs doesn't need them but the row column is
// NOT NULL.
function validateCreate(body) {
  if (typeof body?.reference !== 'string' || !body.reference) return 'reference is required';
  if (body?.type !== 'pickup' && body?.type !== 'send') return "type must be 'pickup' or 'send'";
  if (body?.currency !== 'USD' && body?.currency !== 'RWF') return "currency must be 'USD' or 'RWF'";
  if (!isNum(body?.amount) || body.amount <= 0) return 'amount must be a positive number';
  if (!['single', 'usd', 'split'].includes(body?.pay_currency)) return "pay_currency must be 'single', 'usd', or 'split'";
  if (!isUuid(body?.branch_id)) return 'branch_id must be a uuid';
  if (body.teller_id != null && !isUuid(body.teller_id)) return 'teller_id must be a uuid';
  return true;
}

router.post('/', requireUser, validateBody(validateCreate), asyncWrapper(async (req, res) => {
  const b = req.body;
  const tellerId = resolveTellerId(req.user, b.teller_id);
  if (!canCreateTransactionForTeller(req.user, tellerId)) {
    throw new ApiError(403, 'Not authorized to create a Western Union entry for this teller');
  }

  // See duplicateGuard.js's own comment — same double-submit race already
  // confirmed live and fixed for inter_branch_txns/branch_float_transfers/
  // float_channel_transactions. No `voided` boolean column here (voiding
  // flips `status` instead — see handleWuDeleteOrEdit), so excludeVoided
  // is off, same as float_channel_transactions.js's own choice.
  const { duplicate, error: dupErr } = await findRecentDuplicate('western_union_transactions', {
    teller_id: tellerId, branch_id: b.branch_id, type: b.type, currency: b.currency,
    pay_currency: b.pay_currency, amount: b.amount,
  }, { excludeVoided: false });
  if (dupErr) throw new ApiError(400, dupErr.message);
  if (duplicate) {
    throw new ApiError(409, `This looks like a duplicate of ${duplicate.reference}, submitted ${Math.max(1, Math.round((Date.now() - new Date(duplicate.created_at).getTime()) / 1000))}s ago. If this is really a separate entry, wait a moment and resubmit.`);
  }

  const isPureUsd = b.pay_currency === 'usd';
  const isSplit = b.pay_currency === 'split';
  const isFx = b.currency === 'USD';
  const rateApplied   = isPureUsd ? null : (isFx ? (Number(b.rate_applied) || 0) : null);
  const equivalentRwf = isPureUsd ? 0 : (isNum(b.equivalent_rwf) ? b.equivalent_rwf : (isFx ? b.amount * (Number(b.rate_applied) || 0) : b.amount));
  const amountPaid    = isPureUsd ? 0 : (Number(b.amount_paid) || 0);
  const payRwf = isSplit ? (Number(b.pay_rwf) || 0) : null;
  const payFx  = (isPureUsd || isSplit) ? (Number(b.pay_fx) || 0) : null;

  // A pure-USD payment has no RWF leg at all (both the settle account and
  // Cash(USD) move purely in balance_fx, delta=0 by design -- see
  // update_account_balance's v_is_fx_leg branch), so unlike every other
  // branch here, rateApplied above is deliberately null and there's no
  // client-trusted RWF figure to fall back on. Without this, both legs'
  // account_movements.amount_rwf silently landed on 0 -- confirmed live: 8
  // rows / $3,784 unreported this way before this fix.
  const amountRwfOverride = isPureUsd ? (payFx || 0) * (await getQuoteToRwfRate(b.branch_id, 'USD')) : null;

  // Legs + row insert now happen atomically in one Postgres function — see
  // 20260826120200_atomic_channel_creation.sql. source_account/dest_account
  // are derived server-side inside that function, same as before.
  const { data, error } = await callRpcAsService('create_western_union_transaction', {
    p_reference: b.reference, p_type: b.type, p_currency: b.currency, p_amount: b.amount,
    p_rate_applied: rateApplied, p_equivalent_rwf: equivalentRwf, p_amount_paid: amountPaid,
    p_pay_currency: b.pay_currency, p_pay_rwf: payRwf, p_pay_fx: payFx,
    p_branch_id: b.branch_id, p_teller_id: tellerId,
    p_customer_name: b.customer_name ?? null, p_notes: b.notes ?? null,
    p_desc_override: null, p_amount_rwf_override: amountRwfOverride,
  });
  if (error) throw new ApiError(400, error.message);

  if (isFx && !isPureUsd) {
    const netQty = isSplit ? (b.amount - (payFx || 0)) : b.amount;
    const netCostRwf = isSplit ? (payRwf || 0) : amountPaid;
    if (netQty > 0) {
      if (b.type === 'pickup') {
        await upsertWacInventory({ p_branch_id: b.branch_id, p_currency: b.currency, p_quantity: netQty, p_cost_rwf: netCostRwf });
      } else {
        await reduceWacInventoryAcrossLots(b.branch_id, b.currency, netQty, 'RWF');
      }
    }
  }

  res.json(data);
}));

module.exports = router;
