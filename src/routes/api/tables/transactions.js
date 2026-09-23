const { Router } = require('express');
const { requireUser } = require('../../../middleware/auth');
const { validateBody } = require('../../../middleware/validate');
const { asyncWrapper } = require('../../../utils/asyncWrapper');
const { ApiError } = require('../../../utils/ApiError');
const { serviceClient } = require('../../../services/rpc');
const { isAdmin, canCreateTransactionForTeller, canModifyTransaction } = require('../../../services/balanceAuth');
const { deferredTxLegs, buildApprovalLegs, buildCreateLegs, getPairBase } = require('../../../services/transactionOps');
const { applyBalanceLegs, updateAccountBalance, upsertWacInventory, reduceWacInventoryAcrossLots } = require('../../../services/balanceOps');
const { findRecentDuplicate } = require('../../../services/duplicateGuard');

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// Own row for a teller/super_teller (matches txn_teller_insert's own
// `teller_id = auth.uid()` check exactly); admin/accountant may create on
// behalf of someone else, defaulting to themselves — same pattern as every
// other "who did this" field across the migration.
function resolveTellerId(user, bodyTellerId) {
  if (user.role === 'teller' || user.role === 'super_teller') return user.id;
  return (isUuid(bodyTellerId) ? bodyTellerId : null) || user.id;
}

// Union of TellerNewTx.jsx's and SuperTellerNewTx.jsx's insert payloads —
// see backend/src/services/transactionOps.js's buildCreateLegs for why one
// endpoint can serve both (SuperTellerNewTx's quote/base framing is a
// strict superset of TellerNewTx's plain-RWF framing).
function validateCreate(body) {
  if (body?.type !== 'buy' && body?.type !== 'sell') return "type must be 'buy' or 'sell'";
  if (!isNum(body?.amount_foreign) || body.amount_foreign <= 0) return 'amount_foreign must be a positive number';
  if (!isNum(body?.rate_applied) || body.rate_applied <= 0) return 'rate_applied must be a positive number';
  if (typeof body?.payment_status !== 'string' || !body.payment_status) return 'payment_status is required';
  if (body.pair_id != null && !isUuid(body.pair_id)) return 'pair_id must be a uuid';
  if (body.branch_id != null && !isUuid(body.branch_id)) return 'branch_id must be a uuid';
  if (body.teller_id != null && !isUuid(body.teller_id)) return 'teller_id must be a uuid';
  if (body.payment_currency != null && !['quote', 'base', 'split'].includes(body.payment_currency)) return "payment_currency must be one of: quote, base, split";
  return true;
}

router.post('/', requireUser, validateBody(validateCreate), asyncWrapper(async (req, res) => {
  const b = req.body;
  const tellerId = resolveTellerId(req.user, b.teller_id);
  if (!canCreateTransactionForTeller(req.user, tellerId)) {
    throw new ApiError(403, 'Not authorized to create a transaction for this teller');
  }

  // See duplicateGuard.js's own comment — same double-submit race
  // (double-click, a slow request retried, a flaky connection resubmitting)
  // already confirmed live and fixed for inter_branch_txns/
  // branch_float_transfers/float_channel_transactions; this table is the
  // highest-volume of all of them and had the same gap.
  const { duplicate, error: dupErr } = await findRecentDuplicate('transactions', {
    teller_id: tellerId, branch_id: b.branch_id, type: b.type, pair_id: b.pair_id ?? null,
    amount_foreign: b.amount_foreign, amount_paid: isNum(b.amount_paid) ? b.amount_paid : null,
  });
  if (dupErr) throw new ApiError(400, dupErr.message);
  if (duplicate) {
    throw new ApiError(409, `This looks like a duplicate of ${duplicate.reference}, submitted ${Math.max(1, Math.round((Date.now() - new Date(duplicate.created_at).getTime()) / 1000))}s ago. If this is really a separate transaction, wait a moment and resubmit.`);
  }

  const branchId = isUuid(b.branch_id) ? b.branch_id : null;
  const quoteCurrency = b.quote_currency || 'RWF';
  const isRwfQuote = quoteCurrency === 'RWF';
  const pairBase = b.pair_id ? await getPairBase(b.pair_id) : null;

  // SELL: snapshot the current WAC rate/currency so profit can be derived
  // (src/lib/profit.js) — mirrors both frontends' pre-insert lookup.
  //
  // A branch can hold the same currency costed in more than one
  // cost_currency lot at once (confirmed live: a branch holding KES costed
  // in RWF, UGX, BIF, and ZMW lots simultaneously) -- .maybeSingle() against
  // an under-filtered currency match errors on more than one row, and
  // reading only `data` (not `error`) swallowed that silently, leaving
  // wacRate at 0 for a real disposal with a real cost basis. Same bug
  // already fixed in txRequestApproval.js/TellerBranchTransfer.jsx/
  // BranchApprovalsPage.jsx and the approve-inter-branch-txn/accept-
  // branch-float-transfer backend routes -- this table's own create route
  // was the one call site that still had it. For a plain RWF-quote sale,
  // prefer the RWF-costed lot, falling back to whichever lot actually
  // holds stock.
  //
  // A cross-currency (non-RWF-quote) sale used to require an EXACT
  // cost_currency = quoteCurrency lot and silently store wac_cost_rate =
  // null otherwise — profit.js's txProfitQuote()/ibtProfitQuote() both
  // return 0 with no cost basis ("never guess"), so 16 of 17 Super
  // Teller cross-currency sells one live period recognized zero profit
  // despite real revenue collected, because the branch's KES stock
  // happened to be costed in RWF/ZMW/BIF lots at trade time, never
  // exactly the trade's own quote currency. Same 3-tier fallback
  // approveInterBranchTxn.js already uses for the identical gap on the
  // IBT-approval path: exact lot -> the pair's own defined buy rate (a
  // real rate this business trades this exact pair at) -> whichever lot
  // is actually held, converted via each side's own live RWF rate.
  let wacRate = 0;
  if (b.type === 'sell' && pairBase && branchId) {
    const { data: lots, error: wacError } = await serviceClient
      .from('wac_inventory').select('wac_rate, cost_currency, quantity')
      .eq('branch_id', branchId).eq('currency', pairBase);
    if (wacError) throw new ApiError(400, wacError.message);

    if (isRwfQuote) {
      const rwfLot = (lots || []).find((l) => l.cost_currency === 'RWF' && Number(l.quantity) > 0);
      const holding = rwfLot || (lots || []).filter((l) => Number(l.quantity) > 0).sort((a, b2) => Number(b2.quantity) - Number(a.quantity))[0];
      wacRate = Number(holding?.wac_rate) || 0;
    } else {
      const exact = (lots || []).find((l) => l.cost_currency === quoteCurrency && Number(l.quantity) > 0);
      if (exact) {
        wacRate = Number(exact.wac_rate);
      } else {
        const { data: pairRow } = await serviceClient
          .from('currency_pairs').select('id')
          .eq('base_currency', pairBase).eq('quote_currency', quoteCurrency).maybeSingle();
        if (pairRow) {
          const { data: rateRow } = await serviceClient
            .from('exchange_rates').select('buy')
            .eq('pair_id', pairRow.id).eq('active', true)
            .order('effective_from', { ascending: false }).limit(1).maybeSingle();
          if (Number(rateRow?.buy) > 0) wacRate = Number(rateRow.buy);
        }
        if (wacRate <= 0) {
          const holding = (lots || [])
            .filter((l) => Number(l.quantity) > 0)
            .sort((a, b2) => Number(b2.quantity) - Number(a.quantity))[0];
          if (holding) {
            const { data: pairs, error: pairsError } = await serviceClient
              .from('currency_pairs').select('base_currency, mid_rate').eq('quote_currency', 'RWF');
            if (pairsError) throw new ApiError(400, pairsError.message);
            const rwfRate = {};
            for (const p of pairs || []) rwfRate[p.base_currency] = Number(p.mid_rate || 0);
            const costToRwf  = holding.cost_currency === 'RWF' ? 1 : (rwfRate[holding.cost_currency] || 0);
            const quoteToRwf = quoteCurrency === 'RWF' ? 1 : (rwfRate[quoteCurrency] || 0);
            if (costToRwf > 0 && quoteToRwf > 0) wacRate = Number(holding.wac_rate) * (costToRwf / quoteToRwf);
          }
        }
      }
    }
  }

  const amountPaid = isNum(b.amount_paid) ? b.amount_paid : 0;
  // A sell's fee is charged in pairBase currency and physically deducted
  // from the same WAC-tracked FX stock wacRate above already prices for
  // wac_cost_rate — its RWF-equivalent belongs in that WAC rate too, not
  // the customer-facing rate_applied the client (TransactionForm.jsx /
  // SuperTellerNewTx.jsx) computed it with. profit.js's txProfit() reads
  // tx_fee_rwf straight off this row for COGS, so a rate_applied-valued
  // fee overstated COGS/Net Income by (rate_applied − WAC rate) × fee
  // whenever the two differ, with nothing on the Assets side to match —
  // exactly why a branch's own Balance Sheet/Trial Balance stopped
  // balancing by a small amount on its own fee-bearing sells. Only
  // applies to a plain RWF-quoted sell — a cross-currency trade's fee is
  // priced by txProfitQuote() instead, which never reads this column.
  const feeForeign = isNum(b.tx_fee_foreign) ? b.tx_fee_foreign : 0;
  const txFeeRwf = b.type === 'sell' && isRwfQuote && wacRate > 0 && feeForeign > 0
    ? feeForeign * wacRate
    : (isNum(b.tx_fee_rwf) ? b.tx_fee_rwf : 0);
  const { data: txData, error: txError } = await serviceClient
    .from('transactions')
    .insert({
      reference: b.reference ?? undefined,
      type: b.type,
      pair_id: b.pair_id ?? null,
      amount_foreign: b.amount_foreign,
      rate_applied: b.rate_applied,
      equivalent_rwf: isRwfQuote ? (isNum(b.equivalent_rwf) ? b.equivalent_rwf : b.amount_foreign * b.rate_applied) : (isNum(b.equivalent_rwf) ? b.equivalent_rwf : 0),
      quote_currency: quoteCurrency,
      equivalent_quote: isNum(b.equivalent_quote) ? b.equivalent_quote : (isRwfQuote ? null : b.amount_foreign * b.rate_applied),
      wac_cost_rate: b.type === 'sell' && wacRate > 0 ? wacRate : null,
      wac_cost_currency: b.type === 'sell' && wacRate > 0 && !isRwfQuote ? quoteCurrency : null,
      customer_name: b.customer_name ?? null,
      teller_id: tellerId,
      branch_id: branchId,
      shift_id: isUuid(b.shift_id) ? b.shift_id : null,
      payment_status: b.payment_status,
      pending_reason: b.pending_reason ?? null,
      customer_phone: b.customer_phone ?? null,
      customer_email: b.customer_email ?? null,
      tx_fee_foreign: feeForeign,
      tx_fee_currency: b.tx_fee_currency ?? null,
      tx_fee_rwf: txFeeRwf,
      fee_account: b.fee_account ?? null,
      source_account: b.source_account ?? null,
      dest_account: b.dest_account ?? null,
      amount_paid: amountPaid,
      special_rate_requested: !!b.special_rate_requested,
    })
    .select('id, reference')
    .single();
  if (txError) throw new ApiError(400, txError.message);

  const legs = deferredTxLegs(b.type, b.payment_status);
  const postOps = await buildCreateLegs({
    id: txData.id, reference: txData.reference, type: b.type, branchId,
    amount: b.amount_foreign, rate: b.rate_applied, quoteCurrency, pairBase,
    equivalentQuote: isNum(b.equivalent_quote) ? b.equivalent_quote : b.amount_foreign * b.rate_applied,
    amountPaid, sourceAccount: b.source_account ?? null, destAccount: b.dest_account ?? null,
    destAccountBase: b.dest_account_base ?? null,
    paymentCurrency: b.payment_currency || 'quote', amountPaidBase: isNum(b.amount_paid_base) ? b.amount_paid_base : 0,
    txFeeForeign: feeForeign, txFeeCurrency: b.tx_fee_currency ?? null,
    txFeeRwf, feeAccount: b.fee_account ?? null, legs,
  });

  // A deferred (not-yet-settled) sale/purchase writes a debtor/creditor
  // ledger_entries row — mirrors both frontends' isDeferred branch.
  const isDeferred = b.payment_status === 'awaiting_payment' || b.payment_status === 'customer_not_yet_paid';
  if (isDeferred) {
    postOps.push(
      serviceClient.from('ledger_entries').insert({
        transaction_id: txData.id,
        party_name: b.customer_name ?? null,
        party_phone: b.customer_phone ?? null,
        party_email: b.customer_email ?? null,
        entry_type: b.payment_status === 'awaiting_payment' ? 'debtor' : 'creditor',
        amount_foreign: b.amount_foreign,
        amount_rwf: isRwfQuote ? (isNum(b.equivalent_quote) ? b.equivalent_quote : b.amount_foreign * b.rate_applied) : 0,
        quote_currency: quoteCurrency,
        amount_quote: isNum(b.equivalent_quote) ? b.equivalent_quote : b.amount_foreign * b.rate_applied,
        currency: pairBase,
        branch_id: branchId,
        status: 'outstanding',
      })
    );
  }

  const results = await Promise.allSettled(postOps);
  const failures = results.filter((r) => r.status === 'rejected' || r.value?.error);
  if (failures.length) {
    const messages = failures.map((r) =>
      r.status === 'rejected' ? (r.reason?.message || String(r.reason)) : (r.value?.error?.message || JSON.stringify(r.value?.error))
    );
    // A leg failed despite the caller's own pre-flight check — most likely
    // a race. Other legs may have already succeeded independently (each
    // RPC call is its own atomic unit), so this transaction is now
    // half-applied. Void it immediately instead of leaving a half-applied
    // record that still shows as "recorded successfully" — mirrors both
    // frontends' own void-on-failure, just done server-side now.
    await serviceClient.from('transactions').update({ payment_status: 'voided', voided: true }).eq('id', txData.id);
    return res.json({
      ok: false, id: txData.id, voided: true,
      message: `${txData.reference} could not be completed and was voided — ${messages.join(' · ')}. Any balance change already applied may need manual correction.`,
    });
  }

  res.json({ ok: true, id: txData.id, reference: txData.reference });
}));

// Shared by AmlPage.jsx's handleApprove and ApprovalsPage.jsx/
// BranchApprovalsPage.jsx's approveSpecialRate — both claim a
// pending_approval row atomically then post the legs neither withheld at
// creation, optionally at a re-confirmed rate parsed from the row's own
// pending_reason ("SPECIAL_RATE_REQUEST: 1234 (standard: 1200)"). AmlPage's
// rows never carry that marker, so the rate override naturally no-ops for
// them — one code path correctly serves both call sites. Admin-only,
// mirroring txn_update RLS: the approver here never owns the row.
router.patch('/:id/approve', requireUser, asyncWrapper(async (req, res) => {
  if (!isUuid(req.params.id)) throw new ApiError(400, 'id must be a uuid');
  if (!isAdmin(req.user)) throw new ApiError(403, 'Not authorized to approve this transaction');

  const { data: tx, error: fetchErr } = await serviceClient.from('transactions').select('*').eq('id', req.params.id).maybeSingle();
  if (fetchErr) throw new ApiError(400, fetchErr.message);
  if (!tx) throw new ApiError(404, 'Transaction not found');

  const m = (tx.pending_reason || '').match(/SPECIAL_RATE_REQUEST:\s*([\d.]+)/);
  const requestedRate = m ? Number(m[1]) : null;
  const isRwfQuote = !tx.quote_currency || tx.quote_currency === 'RWF';
  const fields = { payment_status: 'completed', pending_reason: null, updated_at: new Date().toISOString() };
  if (requestedRate && requestedRate > 0) {
    fields.rate_applied = requestedRate;
    if (isRwfQuote) fields.equivalent_rwf = (Number(tx.amount_foreign) || 0) * requestedRate;
    else fields.equivalent_quote = (Number(tx.amount_foreign) || 0) * requestedRate;
  }

  const { data: rows, error } = await serviceClient
    .from('transactions').update(fields).eq('id', tx.id).eq('payment_status', 'pending_approval').select('id');
  if (error) throw new ApiError(400, error.message);
  if (!rows?.length) return res.json({ ok: false, message: `${tx.reference} was already handled by someone else.` });

  const pairBase = await getPairBase(tx.pair_id);
  const effRate = requestedRate && requestedRate > 0 ? requestedRate : Number(tx.rate_applied);
  const { legs, wacOps } = await buildApprovalLegs(tx, pairBase, effRate);
  const warnings = [];
  if (wacOps.length) {
    const results = await Promise.allSettled(wacOps);
    const failed = results.find((r) => r.status === 'rejected' || r.value?.error);
    if (failed) {
      const msg = failed.reason?.message || failed.value?.error?.message || 'unknown error';
      warnings.push(`approved, but the inventory (WAC) update failed — cost basis may be out of sync: ${msg}`);
    }
  }
  if (legs.length) {
    const { error: postErr } = await applyBalanceLegs(legs);
    if (postErr) {
      await serviceClient.from('transactions').update({ payment_status: 'pending_approval' }).eq('id', tx.id);
      return res.json({ ok: false, message: `${tx.reference} could not be completed — balance posting failed, left pending for retry: ${postErr.message}` });
    }
  }

  if (tx.teller_id) {
    void serviceClient.from('notifications').insert({
      recipient_id: tx.teller_id, type: requestedRate ? 'rate_approved' : 'tx_approved', read: false,
      title: requestedRate ? 'Special rate approved' : 'Transaction approved',
      body: requestedRate
        ? `${tx.reference} · Your requested rate has been approved. The transaction is now complete.`
        : `${tx.reference} · Your AML-flagged transaction has been approved and is now complete.`,
    });
  }

  res.json({ ok: true, message: `${tx.reference} approved`, warnings });
}));

// AmlPage.jsx's handleReject — voids an AML hold outright, no reason
// (declineSpecialRate below is the separate reason+recommendation flow).
// Nothing was posted at creation (deferredTxLegs withholds both legs for
// pending_approval), so no balance reversal is needed.
router.patch('/:id/reject', requireUser, asyncWrapper(async (req, res) => {
  if (!isUuid(req.params.id)) throw new ApiError(400, 'id must be a uuid');
  if (!isAdmin(req.user)) throw new ApiError(403, 'Not authorized to reject this transaction');

  const { data: rows, error } = await serviceClient
    .from('transactions').update({ payment_status: 'voided' }).eq('id', req.params.id).eq('payment_status', 'pending_approval').select('id, reference, teller_id');
  if (error) throw new ApiError(400, error.message);
  if (!rows?.length) return res.json({ ok: false, message: 'This transaction was already handled by someone else.' });

  const tx = rows[0];
  if (tx.teller_id) {
    void serviceClient.from('notifications').insert({
      recipient_id: tx.teller_id, type: 'tx_rejected', read: false,
      title: 'Transaction rejected',
      body: `${tx.reference} · Your AML-flagged transaction was rejected and voided.`,
    });
  }

  res.json({ ok: true, message: `${tx.reference} rejected` });
}));

// ApprovalsPage.jsx/BranchApprovalsPage.jsx's declineSpecialRate — declines
// with a reason, optionally recommending an alternate rate the teller can
// later accept/reject. Also nothing to reverse (pending_approval never
// posted its legs).
function validateDecline(body) {
  if (typeof body?.reason !== 'string' || !body.reason) return 'reason is required';
  if (body.recommendedRate != null && !isNum(body.recommendedRate)) return 'recommendedRate must be a number';
  return true;
}

router.patch('/:id/decline-rate', requireUser, validateBody(validateDecline), asyncWrapper(async (req, res) => {
  if (!isUuid(req.params.id)) throw new ApiError(400, 'id must be a uuid');
  if (!isAdmin(req.user)) throw new ApiError(403, 'Not authorized to decline this transaction');

  const { data: rows, error } = await serviceClient
    .from('transactions')
    .update({
      payment_status: 'rejected',
      rejection_reason: req.body.reason,
      recommended_rate: req.body.recommendedRate ?? null,
      recommendation_status: req.body.recommendedRate ? 'pending' : 'none',
      recommended_by: req.body.recommendedRate ? req.user.id : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', req.params.id).eq('payment_status', 'pending_approval').select('id, reference, teller_id');
  if (error) throw new ApiError(400, error.message);
  if (!rows?.length) return res.json({ ok: false, message: 'This transaction was already handled by someone else.' });

  const tx = rows[0];
  if (tx.teller_id) {
    const rate = req.body.recommendedRate ? Number(req.body.recommendedRate).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 }) : null;
    void serviceClient.from('notifications').insert({
      recipient_id: tx.teller_id, type: 'rate_declined', read: false,
      title: 'Special rate declined',
      body: rate
        ? `${tx.reference} · ${req.body.reason} — Recommended rate: ${rate}. Accept or reject below.`
        : `${tx.reference} · ${req.body.reason}`,
    });
  }

  res.json({ ok: true, message: `${tx.reference} declined` });
}));

// src/lib/rateRecommendation.js's acceptRateRecommendation — re-applies the
// exact same balance/WAC movements the original submission made, just at
// the recommended rate instead of the originally requested one. Owner
// teller (or admin) only — mirrors txn_update RLS.
router.post('/:id/accept-rate-recommendation', requireUser, asyncWrapper(async (req, res) => {
  if (!isUuid(req.params.id)) throw new ApiError(400, 'id must be a uuid');

  const { data: tx, error: fetchErr } = await serviceClient.from('transactions').select('*').eq('id', req.params.id).maybeSingle();
  if (fetchErr) throw new ApiError(400, fetchErr.message);
  if (!tx) return res.json({ ok: false, message: 'Transaction not found.' });
  if (!canModifyTransaction(req.user, tx)) throw new ApiError(403, 'Not authorized to respond to this recommendation');
  if (tx.recommendation_status !== 'pending') return res.json({ ok: false, message: 'This recommendation has already been responded to.' });
  if (!(Number(tx.recommended_rate) > 0)) return res.json({ ok: false, message: 'No recommended rate on this transaction.' });
  // This whole flow assumes RWF throughout (dest_account credited paidRwf
  // with no amount_foreign/currency at all) — never extended for cross-
  // currency (Super Teller) trades. Applying it to one would credit a
  // foreign-currency-magnitude number straight into an FX account's RWF
  // balance field, real corruption, not a no-op. Never actually used yet
  // (recommendation_status has no non-null rows in production), but refuse
  // loudly rather than leave this live for the first real cross-currency
  // hit — same lesson as handleTransactionDelete's equivalent_rwf-gate bug.
  if (tx.quote_currency && tx.quote_currency !== 'RWF') {
    return res.json({ ok: false, message: `Accepting a rate recommendation on a ${tx.quote_currency}-quoted transaction isn't supported yet — this flow only handles RWF-quoted trades.` });
  }

  const pairBase = await getPairBase(tx.pair_id);

  // Claim atomically before moving any money — both the notification
  // popover and the notifications page reach this, and a lost race here
  // costs nothing (no ops attempted yet).
  const { data: claimedRows, error: claimErr } = await serviceClient
    .from('transactions').update({ recommendation_status: 'accepted' }).eq('id', tx.id).eq('recommendation_status', 'pending').select('id');
  if (claimErr) throw new ApiError(400, claimErr.message);
  if (!claimedRows?.length) return res.json({ ok: false, message: 'This recommendation has already been responded to.' });

  async function reopen() {
    await serviceClient.from('transactions').update({ recommendation_status: 'pending' }).eq('id', tx.id);
  }

  const rate = Number(tx.recommended_rate);
  const amount = Number(tx.amount_foreign || 0);
  const newEquiv = amount * rate;
  const paidRwf = Number(tx.amount_paid || 0) || newEquiv;
  const branchId = tx.branch_id;
  const ref = tx.reference;
  const desc = `ACCEPT RECOMMENDATION ${ref}`;

  // Pre-flight balance check — the debit leg is guarded by
  // update_account_balance itself, but every leg here is an independent
  // RPC call fired together, so a refused debit doesn't stop a separate
  // credit call from already having gone through. Checking the real
  // balance first means a refusal leaves nothing applied.
  if (branchId) {
    const debitCheck = tx.type === 'sell'
      ? { name: tx.source_account, currency: pairBase, amount: amount + (Number(tx.tx_fee_foreign) || 0) }
      : tx.type === 'buy' ? { name: tx.source_account, currency: null, amount: paidRwf } : null;
    if (debitCheck?.name && debitCheck.amount > 0) {
      const { data: rows } = await serviceClient
        .from('payment_accounts').select('balance_rwf, balance_fx, branch_id')
        .ilike('name', debitCheck.name).eq('active', true).or(`branch_id.eq.${branchId},branch_id.is.null`);
      const acct = (rows || []).sort((a, b) => (b.branch_id === branchId ? 1 : 0) - (a.branch_id === branchId ? 1 : 0))[0];
      const available = !acct ? 0 : debitCheck.currency ? Number(acct.balance_fx?.[debitCheck.currency] || 0) : Number(acct.balance_rwf || 0);
      if (!acct || available < debitCheck.amount) {
        const unit = debitCheck.currency || 'RWF';
        await reopen();
        return res.json({ ok: false, message: `Insufficient ${unit} balance on "${debitCheck.name}": have ${available.toLocaleString()}, need ${debitCheck.amount.toLocaleString()}. Nothing was applied.` });
      }
    }
  }

  const ops = [];
  if (branchId) {
    if (tx.type === 'sell') {
      if (tx.dest_account) ops.push(updateAccountBalance({ p_name: tx.dest_account, p_branch_id: branchId, p_transaction_id: tx.id, p_delta: paidRwf, p_description: `${desc} [RWF in]`, p_statement_category: 'customer_transaction' }));
      if (tx.source_account) ops.push(updateAccountBalance({
        p_name: tx.source_account, p_branch_id: branchId, p_transaction_id: tx.id, p_delta: -newEquiv, p_description: `${desc} [FX out]`, p_statement_category: 'customer_transaction',
        ...(pairBase ? { p_amount_foreign: -amount, p_currency: pairBase } : {}),
      }));
      if (Number(tx.tx_fee_foreign) > 0 && tx.source_account) ops.push(updateAccountBalance({
        p_name: tx.source_account, p_branch_id: branchId, p_transaction_id: tx.id, p_delta: -(Number(tx.tx_fee_rwf) || 0), p_description: `${desc} [fee]`, p_statement_category: 'customer_transaction',
        ...(pairBase ? { p_amount_foreign: -Number(tx.tx_fee_foreign), p_currency: pairBase } : {}),
      }));
      if (pairBase && amount > 0) ops.push(reduceWacInventoryAcrossLots(branchId, pairBase, amount, 'RWF'));
    } else if (tx.type === 'buy') {
      if (tx.source_account) ops.push(updateAccountBalance({ p_name: tx.source_account, p_branch_id: branchId, p_transaction_id: tx.id, p_delta: -paidRwf, p_description: `${desc} [RWF out]`, p_statement_category: 'customer_transaction' }));
      if (tx.dest_account) ops.push(updateAccountBalance({
        p_name: tx.dest_account, p_branch_id: branchId, p_transaction_id: tx.id, p_delta: newEquiv, p_description: `${desc} [FX in]`, p_statement_category: 'customer_transaction',
        ...(pairBase ? { p_amount_foreign: amount, p_currency: pairBase } : {}),
      }));
      if (pairBase && amount > 0) ops.push(upsertWacInventory({ p_branch_id: branchId, p_currency: pairBase, p_quantity: amount, p_cost_rwf: paidRwf }));
    }
  }

  const results = await Promise.allSettled(ops);
  const failed = results.find((r) => r.status === 'rejected' || r.value?.error);
  if (failed) {
    await reopen();
    return res.json({ ok: false, message: 'Balance update failed — contact admin before retrying.' });
  }

  // Balances have already moved — do NOT reopen on failure below.
  const { error: updErr } = await serviceClient.from('transactions').update({
    payment_status: 'completed', pending_reason: null, rate_applied: rate, equivalent_rwf: newEquiv, updated_at: new Date().toISOString(),
  }).eq('id', tx.id);
  if (updErr) return res.json({ ok: false, message: 'Balances updated but the record failed to save — contact admin.' });

  res.json({ ok: true, message: `${ref} completed at the recommended rate.` });
}));

router.post('/:id/reject-rate-recommendation', requireUser, asyncWrapper(async (req, res) => {
  if (!isUuid(req.params.id)) throw new ApiError(400, 'id must be a uuid');

  const { data: tx, error } = await serviceClient
    .from('transactions').select('id, reference, recommendation_status, recommended_rate, recommended_by, teller_id').eq('id', req.params.id).maybeSingle();
  if (error) throw new ApiError(400, error.message);
  if (!tx) return res.json({ ok: false, message: 'Transaction not found.' });
  if (!canModifyTransaction(req.user, tx)) throw new ApiError(403, 'Not authorized to respond to this recommendation');
  if (tx.recommendation_status !== 'pending') return res.json({ ok: false, message: 'This recommendation has already been responded to.' });

  const { error: updErr } = await serviceClient.from('transactions').update({ recommendation_status: 'declined', updated_at: new Date().toISOString() }).eq('id', tx.id);
  if (updErr) return res.json({ ok: false, message: 'Failed: ' + updErr.message });

  if (tx.recommended_by) {
    const rate = Number(tx.recommended_rate).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
    void serviceClient.from('notifications').insert({
      recipient_id: tx.recommended_by, type: 'rate_recommendation_rejected', read: false,
      title: 'Recommended rate rejected',
      body: `${tx.reference} · The teller rejected your recommended rate of ${rate}.`,
      data: { kind: 'transaction', txId: tx.id, ref: tx.reference },
    });
  }

  res.json({ ok: true, message: 'Recommendation rejected.' });
}));

// TellerActivity.jsx's handleResolve — a manual "mark complete" status flip
// with no balance legs (used for stuck/pending rows a teller has already
// reconciled by hand). Owner teller (or admin) only.
router.patch('/by-reference/:ref/complete', requireUser, asyncWrapper(async (req, res) => {
  const { data: tx, error: fetchErr } = await serviceClient.from('transactions').select('id, teller_id, reference').eq('reference', req.params.ref).maybeSingle();
  if (fetchErr) throw new ApiError(400, fetchErr.message);
  if (!tx) throw new ApiError(404, 'Transaction not found');
  if (!canModifyTransaction(req.user, tx)) throw new ApiError(403, 'Not authorized to complete this transaction');

  const { error } = await serviceClient.from('transactions').update({ payment_status: 'completed', updated_at: new Date().toISOString() }).eq('id', tx.id);
  if (error) throw new ApiError(400, error.message);

  res.json({ ok: true });
}));

module.exports = router;
