// Ported from prestigevuntures/src/pages/ApprovalsPage.jsx's
// approveEditRequest — Phase 3's 3 entity types (internal_transfer,
// inter_branch_txn, branch_float_transfer) plus Phase 4's 'transaction'
// (the default/most-common case — old rows predating entity_type have it
// null, which the frontend and this dispatcher both treat the same as
// 'transaction'), 'petit_cash_entry', 'float_channel_transaction',
// 'ria_transaction', 'western_union_transaction', and
// 'money_gram_transaction' (the last two share the original frontend's
// svcLegs/svcAccounts shape, ported once to wuMgOps.js) — see
// MIGRATION_PLAN.md's Phase 3/4 sections for why splitting entity types
// across sessions is safe (the claim is per tx_requests row, independent
// per entity_type, so splitting by entity_type before any write happens
// introduces no shared state).
const crypto = require('crypto');
const { serviceClient, callRpcAsService } = require('./rpc');
const interBranch = require('./interBranchSettlement');
const branchFloat = require('./branchFloatSettlement');
const { applyBalanceLegs, updateAccountBalance, upsertWacInventory, reduceWacInventoryAcrossLots } = require('./balanceOps');
const { deferredTxLegs, getPairBase, getLatestPairRate, getQuoteToRwfRate } = require('./transactionOps');
const { floatChannelLegs } = require('./floatChannelOps');
const { riaLegs } = require('./riaOps');
const { svcLegs, svcAccounts, svcWacOp } = require('./wuMgOps');

const SUPPORTED_ENTITY_TYPES = ['internal_transfer', 'inter_branch_txn', 'branch_float_transfer', 'transaction', 'petit_cash_entry', 'float_channel_transaction', 'ria_transaction', 'western_union_transaction', 'money_gram_transaction'];

// Every "add forgotten X" flow now captures when the record actually
// happened (AddForgottenModal's shared "When did this happen?" field) so it
// lands in the historical period it belongs to instead of silently getting
// stamped with the approval moment -- every created_at/recorded_at column
// involved defaults to now(), and until this was audited nothing here ever
// overrode that default, so a transaction from days ago backfilled today
// landed in today's shift/period instead of its own. Falls back to null
// (-> each table's own now() default, the pre-fix behavior) if the field is
// missing or unparseable, rather than blocking the whole approval over a
// malformed date.
function parseOccurredAt(fc) {
  if (!fc?.occurred_at) return null;
  const d = new Date(fc.occurred_at);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

async function getBranchName(branchId) {
  if (!branchId) return null;
  const { data } = await serviceClient.from('branches').select('name').eq('id', branchId).maybeSingle();
  return data?.name ?? null;
}

async function notifyRequester(req, warnings) {
  if (!req.teller_id) return;
  const isCrossBranchAdd = req.request_type === 'add' && ['inter_branch_txn', 'branch_float_transfer'].includes(req.entity_type);
  const body = isCrossBranchAdd
    ? `Recorded — now awaiting approval from ${(await getBranchName(req.field_changes?.to_branch_id)) || 'the receiving branch'}.`
    : req.request_type === 'add'
      ? 'Your forgotten transaction has been recorded and account balances updated.'
      : `${req.tx_ref} · Your ${req.request_type} request has been approved.`;
  const { error } = await serviceClient.from('notifications').insert({
    recipient_id: req.teller_id, type: 'tx_edit_approved', read: false,
    title: req.request_type === 'delete' ? 'Delete request approved' : req.request_type === 'add' ? 'Transaction added' : 'Edit request approved',
    body,
  });
  if (error) warnings.push(`Approved, but the requester notification failed: ${error.message}`);
}

async function notifyDestinationChanged(kind, origRow, fc, warnings) {
  const newToBranch = fc.to_branch_id || origRow.to_branch_id;
  const { data: targetProfiles } = await serviceClient.from('profiles').select('id').eq('branch_id', newToBranch);
  if (!(targetProfiles || []).length) return;
  const fromBranchName = (await getBranchName(origRow.from_branch_id)) || (kind === 'inter_branch_txn' ? 'The initiating branch' : 'The sending branch');
  const title = kind === 'inter_branch_txn' ? `Inter-branch ${origRow.type === 'buy' ? 'Buy' : 'Sell'} request needs re-approval` : 'Float transfer needs re-approval';
  const type = kind === 'inter_branch_txn' ? 'inter_branch_request' : 'branch_transfer';
  const { error } = await serviceClient.from('notifications').insert(
    targetProfiles.map((p) => ({
      recipient_id: p.id, type, read: false, title,
      body: `${origRow.reference} · ${fromBranchName} corrected the settling ${'to_branch_id' in fc ? 'branch' : 'account'} — please review and pick your account again.`,
    }))
  );
  if (error) warnings.push(`Destination changed, but notifying the new branch failed: ${error.message}`);
}

// --- internal_transfer -------------------------------------------------

async function handleInternalTransferAdd(req) {
  const fc = req.field_changes;
  const { error } = await callRpcAsService('apply_internal_transfer', {
    p_branch_id: req.branch_id,
    p_from_account: fc.from_account,
    p_to_account: fc.to_account,
    p_from_currency: fc.from_currency,
    p_to_currency: fc.to_currency,
    p_amount: Number(fc.amount) || 0,
    p_converted_amount: Number(fc.converted_amount) || 0,
    p_fee: Number(fc.fee_amount) || 0,
    p_amount_rwf: Number(fc.amount_rwf) || 0,
    p_fee_rwf: Number(fc.fee_rwf) || 0,
    p_description: `Forgotten transfer: ${fc.from_account} → ${fc.to_account}${fc.note ? ' · ' + fc.note : ''}`,
    p_fee_description: `Forgotten transfer fee: ${fc.from_account} → ${fc.to_account}${fc.note ? ' · ' + fc.note : ''} [debit]`,
    p_note: fc.note || null,
    p_initiated_by: req.teller_id,
    p_created_at: parseOccurredAt(fc),
  });
  if (error) return { ok: false, message: 'Failed to insert transfer: ' + error.message };
  return { ok: true };
}

async function handleInternalTransferDeleteOrEdit(req, warnings) {
  const { data: origIf } = await serviceClient.from('internal_transfers').select('*').eq('id', req.internal_transfer_id).maybeSingle();
  if (!origIf || origIf.voided) return { ok: true }; // nothing to reverse — already voided or missing

  if (req.request_type === 'delete') {
    const { data: voidedRows, error: flagErr } = await serviceClient
      .from('internal_transfers').update({ voided: true }).eq('id', origIf.id).eq('voided', false).select('id');
    if (flagErr) return { ok: false, message: 'Failed to void the transfer: ' + flagErr.message };
    if (!voidedRows?.length) return { ok: true, message: `${origIf.reference} was already voided by another approved request — balances left untouched.`, info: true };

    const revLegs = [
      {
        name: origIf.from_account, branch_id: origIf.branch_id,
        delta: +(Number(origIf.amount_rwf) + Number(origIf.fee_rwf || 0)),
        amount_foreign: origIf.from_currency !== 'RWF' ? +(Number(origIf.amount) + Number(origIf.fee_amount || 0)) : null,
        currency: origIf.from_currency !== 'RWF' ? origIf.from_currency : null,
        description: `VOID internal transfer ${origIf.reference} [restored]`,
        statement_category: 'internal_float_transfer',
      },
      {
        name: origIf.to_account, branch_id: origIf.branch_id,
        delta: -Number(origIf.amount_rwf),
        amount_foreign: origIf.to_currency !== 'RWF' ? -Number(origIf.converted_amount) : null,
        currency: origIf.to_currency !== 'RWF' ? origIf.to_currency : null,
        description: `VOID internal transfer ${origIf.reference} [reversed]`,
        statement_category: 'internal_float_transfer',
      },
    ];
    const { error: revErr } = await applyBalanceLegs(revLegs);
    if (revErr) return { ok: false, message: `${origIf.reference} marked voided, but reversing balances failed — correct manually: ` + revErr.message };
    return { ok: true };
  }

  if (req.request_type === 'edit' && req.field_changes) {
    const changes = req.field_changes;
    const newFromAcct = changes.from_account || origIf.from_account;
    const newToAcct = changes.to_account || origIf.to_account;
    const origAmount = Number(origIf.amount) || 0;
    const origFee = Number(origIf.fee_amount) || 0;
    const newAmount = changes.amount !== undefined ? Number(changes.amount) : origAmount;
    const newFee = changes.fee_amount !== undefined ? Number(changes.fee_amount) : origFee;
    // TellerActivity.jsx's internal-transfer edit request has no positivity
    // gate on its amount field -- a raw request with amount <= 0 would
    // otherwise reverse the original legs and re-apply a zero/negative one
    // unchecked, silently corrupting the balance this "edit" is supposed to
    // correct (same bug class fixed for float_channel_transaction's own
    // edit handler).
    if (!Number.isFinite(newAmount) || newAmount <= 0) {
      return { ok: false, message: `Amount must be a positive number (got ${changes.amount})` };
    }
    const rate = origAmount > 0 ? Number(origIf.amount_rwf) / origAmount : 0;
    const newAmountRwf = newAmount * rate;
    const newFeeRwf = newFee * rate;
    const newConvertedAmount = origAmount > 0 ? (Number(origIf.converted_amount) / origAmount) * newAmount : Number(origIf.converted_amount);

    const editLegs = [
      {
        name: origIf.from_account, branch_id: origIf.branch_id,
        delta: +(Number(origIf.amount_rwf) + Number(origIf.fee_rwf || 0)),
        amount_foreign: origIf.from_currency !== 'RWF' ? +(origAmount + origFee) : null,
        currency: origIf.from_currency !== 'RWF' ? origIf.from_currency : null,
        description: `Edit internal transfer ${origIf.reference} [reversal]`,
        statement_category: 'internal_float_transfer',
      },
      {
        name: origIf.to_account, branch_id: origIf.branch_id,
        delta: -Number(origIf.amount_rwf),
        amount_foreign: origIf.to_currency !== 'RWF' ? -Number(origIf.converted_amount) : null,
        currency: origIf.to_currency !== 'RWF' ? origIf.to_currency : null,
        description: `Edit internal transfer ${origIf.reference} [reversal]`,
        statement_category: 'internal_float_transfer',
      },
      {
        name: newFromAcct, branch_id: origIf.branch_id,
        delta: -(newAmountRwf + newFeeRwf),
        amount_foreign: origIf.from_currency !== 'RWF' ? -(newAmount + newFee) : null,
        currency: origIf.from_currency !== 'RWF' ? origIf.from_currency : null,
        description: `Edit internal transfer ${origIf.reference} [applied]`,
        statement_category: 'internal_float_transfer',
      },
      {
        name: newToAcct, branch_id: origIf.branch_id,
        delta: +newAmountRwf,
        amount_foreign: origIf.to_currency !== 'RWF' ? +newConvertedAmount : null,
        currency: origIf.to_currency !== 'RWF' ? origIf.to_currency : null,
        description: `Edit internal transfer ${origIf.reference} [applied]`,
        statement_category: 'internal_float_transfer',
      },
    ];
    const { error: editErr } = await applyBalanceLegs(editLegs);
    if (editErr) return { ok: false, message: 'Failed to apply changes — nothing was applied: ' + editErr.message };

    const { error: updErr } = await serviceClient.from('internal_transfers').update({
      from_account: newFromAcct, to_account: newToAcct, amount: newAmount, fee_amount: newFee,
      amount_rwf: newAmountRwf, fee_rwf: newFeeRwf, converted_amount: newConvertedAmount,
      note: changes.note !== undefined ? changes.note : origIf.note,
    }).eq('id', origIf.id);
    if (updErr) warnings.push('Balances updated but the internal_transfers record failed to save: ' + updErr.message);
    return { ok: true };
  }

  return { ok: true };
}

// --- inter_branch_txn ----------------------------------------------------

async function handleInterBranchAdd(req) {
  const fc = req.field_changes;
  const { data: fromAccts } = await serviceClient.from('payment_accounts').select('name, currencies').eq('branch_id', req.branch_id).eq('active', true);
  const norm = (s) => (s || '').toLowerCase().replace(/\s+/g, '');
  const ourAccount = (fromAccts || []).find((a) => norm(a.name) === `cash(${(fc.currency || '').toLowerCase()})`)
    || (fromAccts || []).find((a) => (a.currencies || []).includes(fc.currency))
    || null;
  const ref = 'IBT-' + crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase() + '-26';

  const occurredAt = parseOccurredAt(fc);
  const { error } = await serviceClient.from('inter_branch_txns').insert({
    reference: ref, type: fc.type, from_branch_id: req.branch_id, to_branch_id: fc.to_branch_id,
    pair_id: fc.pair_id, currency: fc.currency, amount_foreign: Number(fc.amount_foreign) || 0,
    rate_applied: fc.rate_applied ? Number(fc.rate_applied) : null,
    standard_rate: fc.standard_rate ? Number(fc.standard_rate) : null,
    special_rate_requested: !!fc.special_rate_requested,
    threshold_rate_applied: !!fc.threshold_rate_applied,
    equivalent_rwf: Number(fc.equivalent_rwf) || 0,
    amount_paid: Number(fc.amount_paid) || 0,
    pay_currency: 'rwf', pay_rwf: Number(fc.amount_paid) || 0, pay_fx: null, pay_account_fx: null,
    our_account: ourAccount?.name || `Cash(${fc.currency})`,
    initiated_by: req.teller_id, status: 'pending', notes: fc.notes || null,
    ...(occurredAt ? { created_at: occurredAt } : {}),
  });
  if (error) return { ok: false, message: 'Failed to insert transaction: ' + error.message };
  return { ok: true };
}

async function handleInterBranchDeleteOrEdit(req, warnings) {
  const { data: origIbt } = await serviceClient.from('inter_branch_txns').select('*').eq('id', req.inter_branch_txn_id).maybeSingle();
  if (!origIbt) return { ok: true };

  const isSettled = origIbt.status === 'approved' && !origIbt.voided;
  if (isSettled && !origIbt.to_account) {
    return { ok: false, message: `${origIbt.reference} was approved before this system recorded the settling account — it can't be safely reversed automatically. Correct the balances manually, then reject this request.` };
  }

  if (req.request_type === 'delete') {
    if (isSettled) {
      const { data: voidedRows, error: flagErr } = await serviceClient
        .from('inter_branch_txns').update({ voided: true }).eq('id', origIbt.id).eq('voided', false).select('id');
      if (flagErr) return { ok: false, message: 'Failed to void the transaction: ' + flagErr.message };
      if (!voidedRows?.length) return { ok: true, message: `${origIbt.reference} was already voided by another approved request — balances left untouched.`, info: true };
      const error = await interBranch.reverse(origIbt, warnings);
      if (error) return { ok: false, message: `${origIbt.reference} marked voided, but reversing balances failed — correct manually: ` + error.message };
    } else {
      const { data: deletedRows, error: delErr } = await serviceClient
        .from('inter_branch_txns').delete().eq('id', origIbt.id).eq('status', 'pending').select('id');
      if (delErr) return { ok: false, message: 'Failed to delete the transaction: ' + delErr.message };
      if (!deletedRows?.length) return { ok: false, message: `${origIbt.reference} was settled by the receiving branch since this request was opened — reload and re-review before deciding.` };
    }
    return { ok: true };
  }

  if (req.request_type === 'edit' && req.field_changes) {
    const fc = req.field_changes;
    // IbReviewedEditModal only ever lets a super-teller edit to_account and
    // (for a sell) fee_foreign -- but that field has no positivity gate
    // anywhere, client or server. settleOps/feeOp use it directly as a
    // signed delta, so a negative fee would flip the direction and credit
    // the account instead of debiting it once reapplied below.
    if (fc.fee_foreign !== undefined && (!Number.isFinite(Number(fc.fee_foreign)) || Number(fc.fee_foreign) < 0)) {
      return { ok: false, message: `fee_foreign must be a non-negative number (got ${fc.fee_foreign})` };
    }
    const changesDestination = isSettled && (('to_account' in fc) || ('to_branch_id' in fc && fc.to_branch_id !== origIbt.to_branch_id));
    if (isSettled) {
      const error = await interBranch.reverse(origIbt, warnings);
      if (error) return { ok: false, message: 'Failed to reverse balances: ' + error.message };
    }
    const updatePayload = changesDestination ? { ...fc, to_account: null, status: 'pending' } : fc;
    if (isSettled) {
      const { error: updErr } = await serviceClient.from('inter_branch_txns').update(updatePayload).eq('id', origIbt.id);
      if (updErr) return { ok: false, message: 'Failed to apply edit: ' + updErr.message };
    } else {
      const { data: updatedRows, error: updErr } = await serviceClient
        .from('inter_branch_txns').update(updatePayload).eq('id', origIbt.id).eq('status', 'pending').select('id');
      if (updErr) return { ok: false, message: 'Failed to apply edit: ' + updErr.message };
      if (!updatedRows?.length) return { ok: false, message: `${origIbt.reference} was settled by the receiving branch since this request was opened — reload and re-review before deciding.` };
    }
    if (changesDestination) {
      await notifyDestinationChanged('inter_branch_txn', origIbt, fc, warnings);
    } else if (isSettled) {
      const merged = { ...origIbt, ...fc };
      const error = await interBranch.reapply(merged, warnings);
      if (error) return { ok: false, message: 'Balances reversed but re-applying the edited amounts failed — contact admin: ' + error.message };
    }
    return { ok: true };
  }

  return { ok: true };
}

// --- branch_float_transfer -----------------------------------------------

async function handleBranchFloatAdd(req) {
  const fc = req.field_changes;
  const ref = 'BFT-' + crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase() + '-26';
  const occurredAt = parseOccurredAt(fc);
  const { error } = await serviceClient.from('branch_float_transfers').insert({
    reference: ref, from_branch_id: req.branch_id, to_branch_id: fc.to_branch_id,
    currency: fc.currency, amount: Number(fc.amount) || 0, fee_amount: Number(fc.fee_amount) || 0,
    from_account: fc.from_account, initiated_by: req.teller_id, status: 'pending',
    ...(occurredAt ? { created_at: occurredAt } : {}),
  });
  if (error) return { ok: false, message: 'Failed to insert transfer: ' + error.message };
  return { ok: true };
}

async function handleBranchFloatDeleteOrEdit(req, warnings) {
  const { data: origBft } = await serviceClient.from('branch_float_transfers').select('*').eq('id', req.branch_float_transfer_id).maybeSingle();
  if (!origBft) return { ok: true };

  const isSettled = origBft.status === 'completed' && !origBft.voided;

  if (req.request_type === 'delete') {
    if (isSettled) {
      const { data: voidedRows, error: flagErr } = await serviceClient
        .from('branch_float_transfers').update({ voided: true }).eq('id', origBft.id).eq('voided', false).select('id');
      if (flagErr) return { ok: false, message: 'Failed to void the transfer: ' + flagErr.message };
      if (!voidedRows?.length) return { ok: true, message: `${origBft.reference} was already voided by another approved request — balances left untouched.`, info: true };
      const error = await branchFloat.reverse(origBft, warnings);
      if (error) return { ok: false, message: `${origBft.reference} marked voided, but reversing balances failed — correct manually: ` + error.message };
    } else {
      const { data: deletedRows, error: delErr } = await serviceClient
        .from('branch_float_transfers').delete().eq('id', origBft.id).eq('status', 'pending').select('id');
      if (delErr) return { ok: false, message: 'Failed to delete the transfer: ' + delErr.message };
      if (!deletedRows?.length) return { ok: false, message: `${origBft.reference} was accepted by the receiving branch since this request was opened — reload and re-review before deciding.` };
    }
    return { ok: true };
  }

  if (req.request_type === 'edit' && req.field_changes) {
    const fc = req.field_changes;
    const changesDestination = isSettled && (('to_account' in fc) || ('to_branch_id' in fc && fc.to_branch_id !== origBft.to_branch_id));
    if (isSettled) {
      const error = await branchFloat.reverse(origBft, warnings);
      if (error) return { ok: false, message: 'Failed to reverse balances: ' + error.message };
    }
    const updatePayload = changesDestination
      ? { ...fc, to_account: null, status: 'pending', completed_by: null, completed_at: null, wac_rate_snapshot: null }
      : fc;
    if (isSettled) {
      const { error: updErr } = await serviceClient.from('branch_float_transfers').update(updatePayload).eq('id', origBft.id);
      if (updErr) return { ok: false, message: 'Failed to apply edit: ' + updErr.message };
    } else {
      const { data: updatedRows, error: updErr } = await serviceClient
        .from('branch_float_transfers').update(updatePayload).eq('id', origBft.id).eq('status', 'pending').select('id');
      if (updErr) return { ok: false, message: 'Failed to apply edit: ' + updErr.message };
      if (!updatedRows?.length) return { ok: false, message: `${origBft.reference} was accepted by the receiving branch since this request was opened — reload and re-review before deciding.` };
    }
    if (changesDestination) {
      await notifyDestinationChanged('branch_float_transfer', origBft, fc, warnings);
    } else if (isSettled) {
      const merged = { ...origBft, ...fc };
      const error = await branchFloat.reapply(merged, warnings);
      if (error) return { ok: false, message: 'Balances reversed but re-applying the edited amounts failed — contact admin: ' + error.message };
    }
    return { ok: true };
  }

  return { ok: true };
}

// --- transaction -----------------------------------------------------------

// "Forgotten transaction" backfill — mirrors ApprovalsPage.jsx's
// (!entity_type || entity_type === 'transaction') && request_type ===
// 'add' branch. Applies balance legs BEFORE inserting the row (unlike an
// older version of this same branch, which used to insert first and fire
// legs after as unchecked calls — see pendingApprovalLegs.js's sibling
// history) so a refused leg blocks the whole add instead of leaving a
// half-applied 'completed' row.
async function handleTransactionAdd(req, warnings) {
  const fc = req.field_changes;
  const ref = 'TXN-' + crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase() + '-26';

  // This whole function assumes RWF throughout (fc.equivalent_rwf as THE
  // money value, no quote-currency leg distinction anywhere below) — never
  // extended for cross-currency (Super Teller) trades. Silently applying
  // it to one would treat a foreign-currency amount_paid as if it were
  // RWF, corrupting a real account's RWF balance by the wrong magnitude
  // entirely (worse than a no-op — active corruption). Refuse loudly
  // instead of guessing; same lesson as handleTransactionDelete's
  // equivalent_rwf-gate bug (TXN-AF9F4B3B-26/TXN-ADA88E78-26), just caught
  // here before it can happen rather than after.
  if (fc.pair_id) {
    const { data: pairRow } = await serviceClient.from('currency_pairs').select('quote_currency').eq('id', fc.pair_id).maybeSingle();
    if (pairRow?.quote_currency && pairRow.quote_currency !== 'RWF') {
      return { ok: false, message: `Adding a forgotten transaction quoted in ${pairRow.quote_currency} isn't supported yet — this flow only handles RWF-quoted trades. Record it directly instead of through this admin backfill.` };
    }
  }

  // A branch can hold the same currency costed in more than one
  // cost_currency lot (e.g. Super Teller's TZS, costed in both KES and
  // ZMW, with no RWF-costed lot at all) -- .maybeSingle() against an
  // un-filtered currency match errors on more than one row, and reading
  // only `data` (not `error`) swallows that silently, leaving addWacRate
  // at 0 for a real disposal with a real cost basis. Same bug already
  // fixed in TellerBranchTransfer.jsx/BranchApprovalsPage.jsx and the
  // approve-inter-branch-txn/accept-branch-float-transfer backend routes
  // this session. This flow is RWF-quote-only (guarded above), so prefer
  // the RWF-costed lot; fall back to whichever lot actually holds stock.
  let addWacRate = 0;
  if (fc.type === 'sell' && fc.currency && req.branch_id) {
    const { data: lots } = await serviceClient
      .from('wac_inventory').select('wac_rate, cost_currency, quantity')
      .eq('branch_id', req.branch_id).eq('currency', fc.currency);
    const rwfLot = (lots || []).find((l) => l.cost_currency === 'RWF' && Number(l.quantity) > 0);
    const holding = rwfLot || (lots || []).filter((l) => Number(l.quantity) > 0).sort((a, b) => Number(b.quantity) - Number(a.quantity))[0];
    addWacRate = Number(holding?.wac_rate) || 0;
  }
  const txFeeForeign = fc.type === 'sell' ? (Number(fc.tx_fee_foreign) || 0) : 0;
  // Same WAC-not-rate_applied fix as transactions.js's create route: the fee
  // depletes the same WAC-tracked stock addWacRate above already prices, so
  // its RWF-equivalent must use that rate — profit.js's txProfit() reads
  // this column straight off the row for COGS.
  const txFeeRwf = txFeeForeign > 0 ? txFeeForeign * (addWacRate > 0 ? addWacRate : (Number(fc.rate_applied) || 0)) : 0;
  const rwfAmt = Number(fc.equivalent_rwf) || 0;
  const paidAmt = fc.amount_paid !== undefined && fc.amount_paid !== null && fc.amount_paid !== '' ? Number(fc.amount_paid) || 0 : rwfAmt;
  const ccy = fc.currency;
  const fxAmt = Number(fc.amount_foreign) || 0;
  const brId = req.branch_id;
  const occurredAt = parseOccurredAt(fc);

  const legs = [];
  if (fc.type === 'buy' && rwfAmt > 0) {
    if (fc.source_account) legs.push({ name: fc.source_account, branch_id: brId, delta: -paidAmt, description: `Add tx ${ref} [RWF out]`, statement_category: 'customer_transaction', created_at: occurredAt });
    if (fc.dest_account) legs.push({ name: fc.dest_account, branch_id: brId, delta: +rwfAmt, description: `Add tx ${ref} [FX in]`, statement_category: 'customer_transaction', created_at: occurredAt, ...(ccy && fxAmt ? { amount_foreign: +fxAmt, currency: ccy } : {}) });
  } else if (fc.type === 'sell' && rwfAmt > 0) {
    if (fc.source_account) legs.push({ name: fc.source_account, branch_id: brId, delta: -rwfAmt, description: `Add tx ${ref} [FX out]`, statement_category: 'customer_transaction', created_at: occurredAt, ...(ccy && fxAmt ? { amount_foreign: -fxAmt, currency: ccy } : {}) });
    if (fc.dest_account) legs.push({ name: fc.dest_account, branch_id: brId, delta: +paidAmt, description: `Add tx ${ref} [RWF in]`, statement_category: 'customer_transaction', created_at: occurredAt });
  }
  if (txFeeForeign > 0 && fc.source_account) {
    legs.push({ name: fc.source_account, branch_id: brId, delta: -txFeeRwf, amount_foreign: -txFeeForeign, currency: ccy, description: `Transaction fee ${txFeeForeign} ${ccy} — ${ref}`, statement_category: 'customer_transaction', created_at: occurredAt });
  }

  if (legs.length) {
    const { error: legsErr } = await applyBalanceLegs(legs);
    if (legsErr) return { ok: false, message: `Failed to record ${ref} — balance changes could not be applied: ${legsErr.message}` };
  }

  const { data: newTx, error: insertErr } = await serviceClient
    .from('transactions')
    .insert({
      reference: ref, type: fc.type, pair_id: fc.pair_id || null,
      amount_foreign: fxAmt, rate_applied: Number(fc.rate_applied) || 0,
      equivalent_rwf: rwfAmt, amount_paid: paidAmt,
      wac_cost_rate: fc.type === 'sell' && addWacRate > 0 ? addWacRate : null,
      customer_name: fc.customer_name || null,
      teller_id: req.teller_id || null, branch_id: req.branch_id || null, shift_id: req.shift_id || null,
      payment_status: 'completed',
      source_account: fc.source_account || null, dest_account: fc.dest_account || null,
      tx_fee_foreign: txFeeForeign || 0, tx_fee_currency: txFeeForeign > 0 ? fc.currency : null, tx_fee_rwf: txFeeRwf,
      special_rate_requested: !!fc.special_rate_requested,
      ...(occurredAt ? { created_at: occurredAt } : {}),
    })
    .select('id')
    .single();
  if (insertErr) {
    // Balance legs above already succeeded — this tx_requests row must NOT
    // be reopened to 'pending' (the caller's approveTxRequest does that
    // whenever result.ok is false), or a retry would re-fire the same legs
    // and double-post money that already moved once. Surface it as a loud
    // warning on an otherwise-successful approval instead — the original
    // frontend version of this branch returned early here inside the same
    // try/finally that reopens on any early return, which would have had
    // exactly that double-post bug on retry; not carried forward.
    warnings.push(`Balance changes were applied but the transaction row failed to save — contact admin: ${insertErr.message}`);
    return { ok: true };
  }

  const wacOps = [];
  if (fc.type === 'buy' && ccy && fxAmt > 0) wacOps.push(upsertWacInventory({ p_branch_id: brId, p_currency: ccy, p_quantity: fxAmt, p_cost_rwf: rwfAmt }));
  // Fee (when present) is always drawn from fc.source_account/ccy above --
  // the same branch+currency pool this reduce depletes -- so it must be
  // folded in, same fix as buildApprovalLegs/buildCreateLegs.
  if (fc.type === 'sell' && ccy && fxAmt > 0) wacOps.push(reduceWacInventoryAcrossLots(brId, ccy, fxAmt + txFeeForeign, 'RWF'));
  if (wacOps.length) {
    const results = await Promise.allSettled(wacOps);
    const failed = results.find((r) => r.status === 'rejected' || r.value?.error);
    if (failed) {
      const msg = failed.reason?.message || failed.value?.error?.message || 'unknown error';
      warnings.push(`${ref} recorded, but the inventory (WAC) update failed — cost basis may be out of sync: ${msg}`);
    }
  }
  void newTx;
  return { ok: true };
}

// Void a transaction and reverse whichever legs deferredTxLegs says were
// actually posted — mirrors ApprovalsPage.jsx's (!entity_type ||
// entity_type === 'transaction') && request_type === 'delete' branch,
// including its atomic .eq('voided', false) double-reversal guard (see
// TXN-A1077E2A-26 in that file's own history) and its unconditional
// ledger_entries cancellation (independent of whether this claim won the
// race — cancelling an already-cancelled entry is a harmless 0-row match).
async function handleTransactionDelete(req, warnings) {
  const { data: origTx } = await serviceClient
    .from('transactions')
    .select('id, type, equivalent_rwf, amount_paid, quote_currency, source_account, dest_account, branch_id, pair_id, amount_foreign, payment_status, tx_fee_foreign, tx_fee_currency, tx_fee_rwf, wac_cost_rate, fee_account')
    .eq('reference', req.tx_ref).maybeSingle();

  const { data: voidedRows, error: txErr } = await serviceClient
    .from('transactions').update({ payment_status: 'voided', voided: true }).eq('reference', req.tx_ref).eq('voided', false).select('id');
  if (txErr) return { ok: false, message: 'Failed to void transaction: ' + txErr.message };
  const alreadyVoided = !voidedRows?.length;

  if (origTx?.id) {
    const { error: ledgerErr } = await serviceClient.from('ledger_entries').update({ status: 'voided' }).eq('transaction_id', origTx.id).in('status', ['outstanding', 'partial']);
    if (ledgerErr) warnings.push(`${req.tx_ref} voided, but its outstanding ledger entry failed to cancel — correct it manually: ${ledgerErr.message}`);
  }

  const legs = deferredTxLegs(origTx?.type, origTx?.payment_status);
  const neverSettled = origTx?.payment_status === 'pending' || (!legs.fx && !legs.rwf);

  if (!alreadyVoided && !neverSettled && origTx && origTx.branch_id) {
    const isRwfQuote = !origTx.quote_currency || origTx.quote_currency === 'RWF';
    const quoteCcy = origTx.quote_currency || 'RWF';
    // amount_paid is the reliable real-paid figure (in whatever currency
    // this trade was actually quoted in) -- equivalent_rwf is a system-
    // calculated value left 0/stale for cross-currency (Super Teller)
    // trades (see profit.js's txRevenue() note on the same field). Gating
    // this whole reversal on equivalent_rwf alone meant voiding a Super
    // Teller cross-currency trade silently reversed NOTHING — confirmed
    // live on TXN-AF9F4B3B-26/TXN-ADA88E78-26, both marked voided with
    // their original balance effects still fully applied.
    const paidAmount = Number(origTx.amount_paid || 0) || Number(origTx.equivalent_rwf || 0);
    const fxAmt = Number(origTx.amount_foreign || 0);
    const branchId = origTx.branch_id;
    const txId = origTx.id;
    const pairBase = await getPairBase(origTx.pair_id);
    const feeForeign = Number(origTx.tx_fee_foreign || 0);
    const feeCcy = origTx.tx_fee_currency || pairBase;
    const revLegs = [];
    const wacOps = [];
    // Only looked up when actually needed -- see getQuoteToRwfRate's own
    // comment for why this exists and its fallback order.
    const quoteToRwfRate = isRwfQuote ? 1 : await getQuoteToRwfRate(branchId, quoteCcy);

    // Same branch+currency-scoped reasoning as buildApprovalLegs' own fix:
    // a fee charged in pairBase currency (no dedicated fee_account, or one
    // that happens to hold pairBase currency too) depleted this branch's
    // pairBase WAC stock at create time -- restoring the fee amount without
    // restoring it to WAC too leaves wac_inventory permanently short.
    const feeDepletesPairBase = pairBase && feeForeign > 0 && (!origTx.fee_account || origTx.tx_fee_currency === pairBase);

    // The quote-currency leg (dest_account on a sell, source_account on a
    // buy) — RWF-denominated (real delta) when this trade is RWF-quoted,
    // otherwise a pure FX leg on that account (real balance change lives in
    // amount_foreign/currency; delta is unused for the balance itself but
    // still needs amount_rwf_override so this reversal row reports a real
    // value instead of another 0).
    function quoteRevLeg(account, amountQuote, desc) {
      return isRwfQuote
        ? { name: account, branch_id: branchId, transaction_id: txId, delta: amountQuote, description: desc, amount_foreign: null, currency: null, statement_category: 'customer_transaction' }
        : { name: account, branch_id: branchId, transaction_id: txId, delta: 0, description: desc, amount_foreign: amountQuote, currency: quoteCcy, statement_category: 'customer_transaction', amount_rwf_override: Math.abs(amountQuote) * quoteToRwfRate };
    }

    // The pairBase FX leg (source_account on a sell, dest_account on a
    // buy) always carries real amount_foreign/currency (the balance change
    // itself never depended on quote_currency) — delta is only ever this
    // leg's amount_rwf reporting figure. Preserve the original RWF-quote
    // behavior (equivalent_rwf-derived, via `rwf`) exactly; only a cross-
    // currency trade — where `rwf` is unreliable/0 — needs a real override.
    const rwf = Number(origTx.equivalent_rwf || 0);
    const feeRwf = Number(origTx.tx_fee_rwf || 0);
    function baseRevLeg(account, amountBase, deltaRwf, desc, overrideRwf) {
      return { name: account, branch_id: branchId, transaction_id: txId, delta: deltaRwf, description: desc, amount_foreign: pairBase && fxAmt ? amountBase : null, currency: pairBase && fxAmt ? pairBase : null, statement_category: 'customer_transaction', ...(isRwfQuote ? {} : { amount_rwf_override: overrideRwf }) };
    }

    if (origTx.type === 'sell' && paidAmount > 0) {
      if (legs.fx) {
        if (origTx.source_account) revLegs.push(baseRevLeg(origTx.source_account, +fxAmt, +rwf, `VOID ${req.tx_ref} [FX restored]`, fxAmt * (Number(origTx.wac_cost_rate) || 0)));
        if (origTx.source_account && feeForeign > 0) revLegs.push({ name: origTx.source_account, branch_id: branchId, transaction_id: txId, delta: +feeRwf, description: `VOID ${req.tx_ref} [fee restored]`, amount_foreign: feeCcy ? +feeForeign : null, currency: feeCcy || null, statement_category: 'customer_transaction', ...(isRwfQuote ? {} : { amount_rwf_override: feeForeign * (Number(origTx.wac_cost_rate) || 0) }) });
        if (pairBase && fxAmt > 0) wacOps.push(upsertWacInventory({ p_branch_id: branchId, p_currency: pairBase, p_quantity: fxAmt + (feeDepletesPairBase ? feeForeign : 0), p_cost_rwf: (fxAmt + (feeDepletesPairBase ? feeForeign : 0)) * Number(origTx.wac_cost_rate || 0), ...(isRwfQuote ? {} : { p_cost_currency: quoteCcy }) }));
      }
      if (legs.rwf && origTx.dest_account) revLegs.push(quoteRevLeg(origTx.dest_account, -paidAmount, `VOID ${req.tx_ref} [${quoteCcy} reversed]`));
    } else if (origTx.type === 'buy' && paidAmount > 0) {
      if (legs.rwf && origTx.source_account) revLegs.push(quoteRevLeg(origTx.source_account, +paidAmount, `VOID ${req.tx_ref} [${quoteCcy} restored]`));
      if (legs.fx) {
        if (origTx.dest_account) revLegs.push(baseRevLeg(origTx.dest_account, -fxAmt, -rwf, `VOID ${req.tx_ref} [FX reversed]`, fxAmt * (Number(origTx.wac_cost_rate) || 0)));
        if (pairBase && fxAmt > 0) wacOps.push(reduceWacInventoryAcrossLots(branchId, pairBase, fxAmt, isRwfQuote ? 'RWF' : quoteCcy));
      }
    }

    if (wacOps.length) {
      const results = await Promise.allSettled(wacOps);
      const failed = results.find((r) => r.status === 'rejected' || r.value?.error);
      if (failed) {
        const msg = failed.reason?.message || failed.value?.error?.message || 'unknown error';
        warnings.push(`${req.tx_ref} voided, but the inventory (WAC) update failed — cost basis may be out of sync: ${msg}`);
      }
    }

    if (revLegs.length) {
      const { error: revErr } = await applyBalanceLegs(revLegs);
      if (revErr) warnings.push(`${req.tx_ref} voided, but balance reversal failed — no balances were changed, retry or correct manually: ${revErr.message}`);
    }
  }

  return alreadyVoided
    ? { ok: true, message: `${req.tx_ref} was already voided by another approved request — balances left untouched.`, info: true }
    : { ok: true };
}

// Reverse the old booking in full and re-apply the new one — mirrors
// ApprovalsPage.jsx's (!entity_type || entity_type === 'transaction') &&
// request_type === 'edit' branch. Any of type/amount/pair/accounts/paid
// changing shifts what the trade legs should look like, so all of them
// (not just an account-name change) trigger a full reverse+reapply, same
// as a direct rate_applied/equivalent_rwf correction with nothing else
// touched (that still changes exactly how much RWF should have moved).
async function handleTransactionEdit(req, warnings) {
  const { data: origTx } = await serviceClient
    .from('transactions')
    .select('id, type, equivalent_rwf, amount_paid, source_account, dest_account, branch_id, pair_id, amount_foreign, wac_cost_rate, tx_fee_foreign, tx_fee_currency, tx_fee_rwf, payment_status, fee_account')
    .eq('reference', req.tx_ref).maybeSingle();

  const changes = { ...req.field_changes };

  if (!origTx) {
    const { error: txErr } = await serviceClient.from('transactions').update(changes).eq('reference', req.tx_ref);
    if (txErr) return { ok: false, message: 'Failed to apply edit: ' + txErr.message };
    return { ok: true };
  }

  // This whole reverse+reapply below assumes RWF throughout (oldRwf/newRwf
  // as THE money value, no quote-currency leg distinction anywhere) — never
  // extended for cross-currency (Super Teller) trades. Both origTx's own
  // pair and (if the edit changes it) the new pair need checking: a cross-
  // currency trade's equivalent_rwf is 0/stale, which zeroes oldRwf and
  // newRwf both, silently skipping the balance reversal/reapply entirely
  // while still writing `changes` to the row below — the transaction record
  // would then say one thing and the real balances another. Refuse loudly
  // instead; same lesson as handleTransactionDelete's equivalent_rwf-gate
  // bug (TXN-AF9F4B3B-26/TXN-ADA88E78-26), caught here before it happens.
  {
    const pairIdsToCheck = [origTx.pair_id, ...(req.field_changes.pair_id !== undefined ? [req.field_changes.pair_id] : [])].filter(Boolean);
    if (pairIdsToCheck.length) {
      const { data: pairRows } = await serviceClient.from('currency_pairs').select('id, quote_currency').in('id', pairIdsToCheck);
      const nonRwf = (pairRows || []).find((p) => p.quote_currency && p.quote_currency !== 'RWF');
      if (nonRwf) {
        return { ok: false, message: `Editing a ${nonRwf.quote_currency}-quoted transaction isn't supported yet — this flow only handles RWF-quoted trades. Void and recreate it instead.` };
      }
    }
  }

  const branchId = origTx.branch_id;
  const txId = origTx.id;
  const oldType = origTx.type;
  const newType = changes.type || oldType;
  const oldIsSell = oldType === 'sell';
  const newIsSell = newType === 'sell';
  const oldFxAmt = Number(origTx.amount_foreign || 0);
  const oldRwf = Number(origTx.equivalent_rwf || 0);
  const oldPaid = Number(origTx.amount_paid || 0);
  const oldSrc = origTx.source_account;
  const oldDest = origTx.dest_account;
  const oldPairBase = await getPairBase(origTx.pair_id);
  const oldLegs = deferredTxLegs(oldType, origTx.payment_status);
  const newLegs = deferredTxLegs(newType, origTx.payment_status);
  const neverSettled = origTx.payment_status === 'pending' || (!oldLegs.fx && !oldLegs.rwf && !newLegs.fx && !newLegs.rwf);

  const pairChanged = changes.pair_id !== undefined && changes.pair_id !== origTx.pair_id;
  const newPairBase = pairChanged ? await getPairBase(changes.pair_id) : oldPairBase;
  const newFxAmt = changes.amount_foreign !== undefined ? (Number(changes.amount_foreign) || 0) : oldFxAmt;
  const amountChanged = changes.amount_foreign !== undefined && newFxAmt !== oldFxAmt;

  const oldRate = oldFxAmt > 0 ? oldRwf / oldFxAmt : 0;
  const rwfExplicit = !pairChanged && changes.equivalent_rwf !== undefined ? (Number(changes.equivalent_rwf) || 0) : null;
  const rateExplicit = !pairChanged && changes.rate_applied !== undefined ? (Number(changes.rate_applied) || 0) : null;
  let rate, newRwf;
  if (pairChanged) {
    rate = await getLatestPairRate(changes.pair_id);
    newRwf = newFxAmt * rate;
  } else if (rwfExplicit !== null) {
    newRwf = rwfExplicit;
    rate = newFxAmt > 0 ? newRwf / newFxAmt : (rateExplicit ?? oldRate);
  } else if (rateExplicit !== null) {
    rate = rateExplicit;
    newRwf = newFxAmt * rate;
  } else {
    rate = oldRate;
    newRwf = newFxAmt * rate;
  }
  const rwfChanged = newRwf !== oldRwf;
  const newPaid = changes.amount_paid !== undefined ? (Number(changes.amount_paid) || 0) : oldPaid;

  const newSrc = changes.source_account || oldSrc;
  const newDest = changes.dest_account || oldDest;

  // source_account/dest_account meaning flips with type here exactly like
  // float_channel_transactions (see handleFloatChannelDeleteOrEdit / FLT-
  // 278D4B7B-26): buy debits source (till) and credits dest (FX account) in
  // FX terms, sell does the opposite. An edit that flips type without
  // swapping the accounts wouldn't just mislabel the row — the leg math
  // below picks which side gets the FX-denominated delta purely from
  // newIsSell, so it would apply FX units to the till and RWF-only amounts
  // to the FX account, corrupting real balances. Require the swap whenever
  // the type change would actually touch settled legs.
  if (!neverSettled && changes.type !== undefined && newType !== oldType && (newSrc !== oldDest || newDest !== oldSrc)) {
    return { ok: false, message: `Changing type from '${oldType}' to '${newType}' must also swap source_account and dest_account (to '${oldDest}' and '${oldSrc}') — resubmit the edit with both accounts swapped so the record stays consistent with the ledger.` };
  }

  const feeForeign = Number(origTx.tx_fee_foreign || 0);
  const feeRwf = Number(origTx.tx_fee_rwf || 0);
  const feeCcy = origTx.tx_fee_currency || newPairBase || oldPairBase;
  const newFeeForeign = changes.tx_fee_foreign !== undefined ? (Number(changes.tx_fee_foreign) || 0) : feeForeign;
  const feeChanged = changes.tx_fee_foreign !== undefined && newFeeForeign !== feeForeign;
  // Same WAC-not-rate_applied fix as transactions.js's create route /
  // handleTransactionAdd above: a sell's fee depletes the branch's WAC-
  // tracked pairBase stock, so its RWF-equivalent (what profit.js's
  // txProfit() reads straight off tx_fee_rwf for COGS) must use that WAC
  // rate, not the trade's own rate_applied.
  let newFeeWacRate = 0;
  if (newIsSell && newFeeForeign > 0 && newPairBase && branchId) {
    const { data: lots } = await serviceClient
      .from('wac_inventory').select('wac_rate, cost_currency, quantity')
      .eq('branch_id', branchId).eq('currency', newPairBase);
    const rwfLot = (lots || []).find((l) => l.cost_currency === 'RWF' && Number(l.quantity) > 0);
    const holding = rwfLot || (lots || []).filter((l) => Number(l.quantity) > 0).sort((a, b) => Number(b.quantity) - Number(a.quantity))[0];
    newFeeWacRate = Number(holding?.wac_rate) || 0;
  }
  const newFeeRwf = newFeeForeign * (newFeeWacRate > 0 ? newFeeWacRate : rate);

  if (pairChanged || amountChanged || rwfChanged) {
    changes.equivalent_rwf = newRwf;
    changes.rate_applied = rate || null;
  }
  if (feeChanged) {
    changes.tx_fee_rwf = newFeeRwf;
    changes.tx_fee_currency = newFeeForeign > 0 ? feeCcy : null;
  }

  const acctOps = [];
  const wacOps = [];
  const tradeChanged = !neverSettled && (newSrc !== oldSrc || newDest !== oldDest || amountChanged || pairChanged || rwfChanged || (changes.type !== undefined && newType !== oldType) || (changes.amount_paid !== undefined && newPaid !== oldPaid));

  if (tradeChanged) {
    const base = { branch_id: branchId, transaction_id: txId, statement_category: 'customer_transaction' };
    if (oldRwf > 0) {
      if (oldIsSell) {
        if (oldLegs.fx) {
          if (oldSrc) acctOps.push({ ...base, name: oldSrc, delta: +oldRwf, description: `Edit ${req.tx_ref} [reversal]`, amount_foreign: oldPairBase ? +oldFxAmt : null, currency: oldPairBase || null });
          if (oldPairBase && oldFxAmt > 0) wacOps.push(upsertWacInventory({ p_branch_id: branchId, p_currency: oldPairBase, p_quantity: oldFxAmt, p_cost_rwf: oldFxAmt * Number(origTx.wac_cost_rate || 0) }));
        }
        if (oldLegs.rwf && oldDest) acctOps.push({ ...base, name: oldDest, delta: -oldPaid, description: `Edit ${req.tx_ref} [reversal]`, amount_foreign: null, currency: null });
      } else {
        if (oldLegs.rwf && oldSrc) acctOps.push({ ...base, name: oldSrc, delta: +oldPaid, description: `Edit ${req.tx_ref} [reversal]`, amount_foreign: null, currency: null });
        if (oldLegs.fx) {
          if (oldDest) acctOps.push({ ...base, name: oldDest, delta: -oldRwf, description: `Edit ${req.tx_ref} [reversal]`, amount_foreign: oldPairBase ? -oldFxAmt : null, currency: oldPairBase || null });
          if (oldPairBase && oldFxAmt > 0) wacOps.push(reduceWacInventoryAcrossLots(branchId, oldPairBase, oldFxAmt, 'RWF'));
        }
      }
    }
    if (newRwf > 0) {
      if (newIsSell) {
        if (newLegs.fx) {
          if (newSrc) acctOps.push({ ...base, name: newSrc, delta: -newRwf, description: `Edit ${req.tx_ref} [applied]`, amount_foreign: newPairBase ? -newFxAmt : null, currency: newPairBase || null });
          if (newPairBase && newFxAmt > 0) wacOps.push(reduceWacInventoryAcrossLots(branchId, newPairBase, newFxAmt, 'RWF'));
        }
        if (newLegs.rwf && newDest) acctOps.push({ ...base, name: newDest, delta: +newPaid, description: `Edit ${req.tx_ref} [applied]`, amount_foreign: null, currency: null });
      } else {
        if (newLegs.rwf && newSrc) acctOps.push({ ...base, name: newSrc, delta: -newPaid, description: `Edit ${req.tx_ref} [applied]`, amount_foreign: null, currency: null });
        if (newLegs.fx) {
          if (newDest) acctOps.push({ ...base, name: newDest, delta: +newRwf, description: `Edit ${req.tx_ref} [applied]`, amount_foreign: newPairBase ? +newFxAmt : null, currency: newPairBase || null });
          if (newPairBase && newFxAmt > 0) wacOps.push(upsertWacInventory({ p_branch_id: branchId, p_currency: newPairBase, p_quantity: newFxAmt, p_cost_rwf: newFxAmt * rate }));
        }
      }
    }
  }

  // Same branch+currency-scoped reasoning as buildApprovalLegs'/
  // handleTransactionDelete's own fix: a fee charged in pairBase currency
  // (no dedicated fee_account, or one that happens to hold pairBase
  // currency too) depletes/restores this branch's pairBase WAC stock, same
  // as the trade's own FX leg -- this fee block is the ONLY place that fee
  // is ever posted (never folded into the tradeChanged legs above), so its
  // WAC effect must be handled here too, or it's silently dropped entirely.
  const oldFeeDepletesPairBase = oldPairBase && feeForeign > 0 && (!origTx.fee_account || origTx.tx_fee_currency === oldPairBase);
  const newFeeDepletesPairBase = newPairBase && newFeeForeign > 0 && (!origTx.fee_account || origTx.tx_fee_currency === newPairBase);

  if ((oldLegs.fx || newLegs.fx) && (tradeChanged || feeChanged)) {
    const base = { branch_id: branchId, transaction_id: txId, statement_category: 'customer_transaction' };
    if (oldIsSell && oldLegs.fx && feeForeign > 0 && oldSrc) {
      acctOps.push({ ...base, name: oldSrc, delta: +feeRwf, description: `Edit ${req.tx_ref} fee-reversal`, amount_foreign: feeCcy ? +feeForeign : null, currency: feeCcy || null });
      if (oldFeeDepletesPairBase) wacOps.push(upsertWacInventory({ p_branch_id: branchId, p_currency: oldPairBase, p_quantity: feeForeign, p_cost_rwf: feeForeign * Number(origTx.wac_cost_rate || 0) }));
    }
    if (newIsSell && newLegs.fx && newFeeForeign > 0 && newSrc) {
      acctOps.push({ ...base, name: newSrc, delta: -newFeeRwf, description: `Edit ${req.tx_ref} fee-applied`, amount_foreign: feeCcy ? -newFeeForeign : null, currency: feeCcy || null });
      if (newFeeDepletesPairBase) wacOps.push(reduceWacInventoryAcrossLots(branchId, newPairBase, newFeeForeign, 'RWF'));
    }
  }

  if (acctOps.length) {
    const { error: acctErr } = await applyBalanceLegs(acctOps);
    if (acctErr) return { ok: false, message: `Edit rejected — balance changes could not be applied: ${acctErr.message}` };
  }

  const { error: txErr } = await serviceClient.from('transactions').update(changes).eq('reference', req.tx_ref);
  if (txErr) {
    // Same non-reopening fix as handleTransactionAdd — acctOps above may
    // have already moved real money; reopening this request to 'pending'
    // would let a retry re-fire them.
    warnings.push(`Balance changes were applied but the transaction edit failed to save — contact admin: ${txErr.message}`);
    return { ok: true };
  }

  if (wacOps.length) {
    const results = await Promise.allSettled(wacOps);
    const failed = results.find((r) => r.status === 'rejected' || r.value?.error);
    if (failed) {
      const msg = failed.reason?.message || failed.value?.error?.message || 'unknown error';
      warnings.push(`${req.tx_ref} edited, but the inventory (WAC) update failed — cost basis may be out of sync: ${msg}`);
    }
  }

  return { ok: true };
}

// --- petit_cash_entry --------------------------------------------------

// Forgotten petit cash entry — mirrors ApprovalsPage.jsx's
// entity_type === 'petit_cash_entry' && request_type === 'add' branch:
// balance leg first, row insert second, so a refused debit never leaves an
// entry logged for money that was never actually moved. The balance leg
// above already applied — this "add" approval IS the sign-off, so the row
// lands already-'approved' rather than the pending-by-default new entries
// get (see petitCashEntries.js's POST /, which never accepts status from
// the client).
async function handlePetitCashAdd(req, reviewerId) {
  const fc = req.field_changes;
  const isFx = !!fc.currency;
  const numAmt = Number(fc.amount) || 0;
  const sign = fc.direction === 'in' ? 1 : -1;
  // Same pricing this backfill's own account_movements leg needs, and the
  // same reporting value approve_petit_cash_entry (SQL) computes for the
  // live-submission path -- a foreign-only till's entry has no real RWF
  // leg (p_delta stays 0 by design), so without this both the movement's
  // amount_rwf AND the row's own amount_rwf column silently record 0.
  const fxRwfValue = isFx ? numAmt * (await getQuoteToRwfRate(req.branch_id, fc.currency)) : null;
  const occurredAt = parseOccurredAt(fc);

  const { error: rpcErr } = await updateAccountBalance({
    p_name: fc.payment_account, p_branch_id: req.branch_id,
    p_delta: isFx ? 0 : sign * numAmt,
    p_transaction_id: null,
    p_description: `[${fc.account_code}] Forgotten entry: ${fc.description || ''}`,
    p_statement_category: fc.direction === 'in' ? 'petit_cash_income' : 'petit_cash_expense',
    p_created_at: occurredAt,
    ...(isFx ? { p_amount_foreign: sign * numAmt, p_currency: fc.currency, p_amount_rwf_override: fxRwfValue } : {}),
  });
  if (rpcErr) return { ok: false, message: 'Entry not recorded — balance update failed: ' + rpcErr.message };

  const { error: insErr } = await serviceClient.from('petit_cash_entries').insert({
    teller_id: req.teller_id, branch_id: req.branch_id, shift_id: req.shift_id,
    direction: fc.direction, category: fc.category,
    amount_rwf: isFx ? (fxRwfValue || 0) : numAmt, currency: fc.currency || null, amount_foreign: isFx ? numAmt : null,
    description: `[${fc.account_code}] ${fc.description || ''}`, payment_account: fc.payment_account,
    status: 'approved', approved_by: reviewerId, approved_at: new Date().toISOString(),
    ...(occurredAt ? { recorded_at: occurredAt } : {}),
  });
  if (insErr) return { ok: false, message: 'Balance updated but the entry failed to save — contact admin: ' + insErr.message };
  return { ok: true };
}

// Petit cash entries post a single account leg immediately at creation
// (see TellerPetitCash.jsx), same as internal transfers but with only one
// side to reverse/re-apply. amount_rwf is the RWF-denominated leg; FX-only
// tills instead carry amount_foreign/currency with amount_rwf = 0 —
// reverse/re-apply whichever one the entry actually used.
async function handlePetitCashDeleteOrEdit(req, reviewerId) {
  const { data: origPc } = await serviceClient.from('petit_cash_entries').select('*').eq('id', req.petit_cash_entry_id).maybeSingle();
  if (!origPc || origPc.voided) return { ok: true };

  if (origPc.status === 'pending') {
    // Still awaiting its own admin/accountant approval — no balance leg
    // was ever applied (see approve_petit_cash_entry), so there is
    // nothing to reverse. A delete just rejects it outright; an edit just
    // updates the still-pending row's fields directly.
    if (req.request_type === 'delete') {
      const { error } = await serviceClient.from('petit_cash_entries').update({
        status: 'rejected', approved_by: reviewerId, approved_at: new Date().toISOString(),
        reject_reason: 'Deleted via edit/delete request before approval',
      }).eq('id', origPc.id);
      if (error) return { ok: false, message: 'Failed to reject the pending entry: ' + error.message };
      return { ok: true };
    }
    if (req.request_type === 'edit' && req.field_changes) {
      const changes = req.field_changes;
      const newDirection = changes.direction || origPc.direction;
      const newAccount = changes.payment_account || origPc.payment_account;
      const origCcy = origPc.currency || null;
      const newAmount = changes.amount !== undefined ? Number(changes.amount) : (origCcy ? Number(origPc.amount_foreign) || 0 : Number(origPc.amount_rwf) || 0);
      // Still pending, so no balance leg exists yet to corrupt directly --
      // but a bad amount stored here becomes real once approve_petit_cash_
      // entry applies it, so it's validated at the same point every other
      // edit path in this file validates its own amount.
      if (!Number.isFinite(newAmount) || newAmount <= 0) {
        return { ok: false, message: `Amount must be a positive number (got ${changes.amount})` };
      }
      const { error } = await serviceClient.from('petit_cash_entries').update({
        direction: newDirection, payment_account: newAccount,
        amount_rwf: origCcy ? 0 : newAmount, amount_foreign: origCcy ? newAmount : null,
        description: changes.description !== undefined ? changes.description : origPc.description,
      }).eq('id', origPc.id);
      if (error) return { ok: false, message: 'Failed to update the pending entry: ' + error.message };
      return { ok: true };
    }
    return { ok: true };
  }

  const sign = origPc.direction === 'in' ? 1 : -1;
  const origRwf = Number(origPc.amount_rwf) || 0;
  const origForeign = Number(origPc.amount_foreign) || 0;
  const origCcy = origPc.currency || null;
  // Don't trust origPc.amount_rwf for the reporting override -- rows
  // created before approve_petit_cash_entry started keeping it in sync
  // (see that function's own comment) still carry a stale 0 for a
  // foreign-currency entry. Re-quote a live rate the same way every other
  // reversal in this codebase does rather than propagate that 0 forward.
  const origRwfOverride = origCcy ? origForeign * (await getQuoteToRwfRate(origPc.branch_id, origCcy)) : null;

  if (req.request_type === 'delete') {
    // Atomic guard against double-reversal — see the transactions delete
    // path's own comment. Claim the void first (only the caller that
    // actually flips false→true gets to reverse the balance).
    const { data: voidedRows, error: voidErr } = await serviceClient
      .from('petit_cash_entries').update({ voided: true }).eq('id', origPc.id).eq('voided', false).select('id');
    if (voidErr) return { ok: false, message: 'Failed to void the entry: ' + voidErr.message };
    if (!voidedRows?.length) return { ok: true, message: `${req.tx_ref} was already voided by another approved request — balance left untouched.`, info: true };

    const { error: revErr } = await updateAccountBalance({
      p_name: origPc.payment_account, p_branch_id: origPc.branch_id,
      p_delta: -sign * origRwf,
      p_description: `VOID petit cash ${req.tx_ref} [reversed]`,
      p_statement_category: origPc.direction === 'in' ? 'petit_cash_income' : 'petit_cash_expense',
      ...(origCcy ? { p_amount_foreign: -sign * origForeign, p_currency: origCcy, p_amount_rwf_override: origRwfOverride } : {}),
    });
    if (revErr) return { ok: false, message: `${req.tx_ref} marked voided, but reversing the balance failed — correct manually: ` + revErr.message };
    return { ok: true };
  }

  if (req.request_type === 'edit' && req.field_changes) {
    const changes = req.field_changes;
    const newDirection = changes.direction || origPc.direction;
    const newSign = newDirection === 'in' ? 1 : -1;
    const newAccount = changes.payment_account || origPc.payment_account;
    const newAmount = changes.amount !== undefined ? Number(changes.amount) : (origCcy ? origForeign : origRwf);
    // TellerActivity.jsx's petit-cash edit request has no positivity gate
    // on its amount field -- a raw request with amount <= 0 would otherwise
    // reverse the original balance and re-apply a zero/negative one
    // unchecked (same bug class fixed for internal_transfer/
    // float_channel_transaction's own edit handlers).
    if (!Number.isFinite(newAmount) || newAmount <= 0) {
      return { ok: false, message: `Amount must be a positive number (got ${changes.amount})` };
    }
    const newRwf = origCcy ? 0 : newAmount;
    const newForeign = origCcy ? newAmount : 0;
    const newRwfOverride = origCcy ? newForeign * (await getQuoteToRwfRate(origPc.branch_id, origCcy)) : null;

    // Reverse the original leg on its original account, then apply the
    // edited leg on the (possibly new) account — two independent calls
    // since a petit cash entry only ever touches one account, unlike
    // internal transfers' two-account apply_balance_legs case.
    const { error: revErr } = await updateAccountBalance({
      p_name: origPc.payment_account, p_branch_id: origPc.branch_id,
      p_delta: -sign * origRwf,
      p_description: `Edit petit cash ${req.tx_ref} [reversal]`,
      p_statement_category: origPc.direction === 'in' ? 'petit_cash_income' : 'petit_cash_expense',
      ...(origCcy ? { p_amount_foreign: -sign * origForeign, p_currency: origCcy, p_amount_rwf_override: origRwfOverride } : {}),
    });
    if (revErr) return { ok: false, message: 'Failed to reverse original balance — nothing was applied: ' + revErr.message };

    const { error: applyErr } = await updateAccountBalance({
      p_name: newAccount, p_branch_id: origPc.branch_id,
      p_delta: newSign * newRwf,
      p_description: `Edit petit cash ${req.tx_ref} [applied]`,
      p_statement_category: newDirection === 'in' ? 'petit_cash_income' : 'petit_cash_expense',
      ...(origCcy ? { p_amount_foreign: newSign * newForeign, p_currency: origCcy, p_amount_rwf_override: newRwfOverride } : {}),
    });
    if (applyErr) return { ok: false, message: 'Original reversed but re-applying the edit failed — contact admin: ' + applyErr.message };

    const { error: updErr } = await serviceClient.from('petit_cash_entries').update({
      direction: newDirection, payment_account: newAccount,
      amount_rwf: origCcy ? (newRwfOverride || 0) : newRwf, amount_foreign: origCcy ? newForeign : null,
      description: changes.description !== undefined ? changes.description : origPc.description,
    }).eq('id', origPc.id);
    if (updErr) return { ok: false, message: 'Balances updated but the entry failed to save — contact admin: ' + updErr.message };
    return { ok: true };
  }

  return { ok: true };
}

// --- float_channel_transaction -------------------------------------------

// Forgotten BK/Equity/Amin Agent Float entry — straight same-currency,
// no-fee move between two accounts, mirrors TellerFloatTransfer.jsx's/
// SuperTellerAmin.jsx's handleSubmit (balance leg first, row insert
// second, so a refused debit never leaves an entry logged for money that
// was never actually moved).
async function handleFloatChannelAdd(req) {
  const fc = req.field_changes;
  const ref = 'FLT-' + crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase() + '-26';
  const numAmt = Number(fc.amount) || 0;
  const feeAmt = Number(fc.fee_amount) || 0;
  // A non-RWF leg's real balance change lives entirely in amount_foreign
  // (delta stays 0 by design) -- see floatChannelTransactions.js's own
  // comment. This backfill path shares the same create_float_channel_transaction
  // function as the live create route but was missed when that route's own
  // p_amount_rwf_override fix shipped (the exact class of bug that produced
  // the 48 historical "Amin deposit" zero-amount_rwf rows). Same rate covers
  // a backfilled transfer-fee leg (fc.fee_amount), same reasoning as the
  // live route's own feeRwfOverride.
  const isFx = fc.currency && fc.currency !== 'RWF';
  const rwfRate = isFx ? await getQuoteToRwfRate(req.branch_id, fc.currency) : 0;
  const amountRwfOverride = isFx ? numAmt * rwfRate : null;
  const feeRwfOverride = isFx && feeAmt > 0 ? feeAmt * rwfRate : null;

  // Legs + row insert now happen atomically in one Postgres function — see
  // 20260826120200_atomic_channel_creation.sql. Previously a two-step
  // apply-then-insert, same gap as the live create route had before it was
  // fixed: an insert failure here left real balance legs committed with no
  // float_channel_transactions row to show for it.
  const { error } = await callRpcAsService('create_float_channel_transaction', {
    p_reference: ref, p_channel: fc.channel, p_type: fc.type, p_amount: numAmt, p_currency: fc.currency,
    p_source_account: fc.source_account, p_dest_account: fc.dest_account,
    p_branch_id: req.branch_id, p_teller_id: req.teller_id, p_notes: fc.notes || null,
    p_desc_override: `Forgotten ${ref}`, p_amount_rwf_override: amountRwfOverride,
    p_created_at: parseOccurredAt(fc),
    p_fee_amount: feeAmt, p_fee_amount_rwf_override: feeRwfOverride,
  });
  if (error) return { ok: false, message: 'Balance update failed — nothing was applied: ' + error.message };
  return { ok: true };
}

// BK/Equity/Amin Agent Float entries post their 2-account leg immediately
// at creation — reverse/re-apply using the row's own source_account/
// dest_account/channel/currency, same shape as Ria. floatChannelLegs skips
// whichever side is the 'External' sentinel (see floatChannelOps.js for
// why the original version of this reversal — which didn't — was a bug).
async function handleFloatChannelDeleteOrEdit(req, warnings, reviewerId) {
  const { data: origFc } = await serviceClient.from('float_channel_transactions').select('*').eq('id', req.float_channel_transaction_id).maybeSingle();
  if (!origFc || origFc.status === 'voided') return { ok: true };

  if (req.request_type === 'delete') {
    const { data: voidedRows, error: voidErr } = await serviceClient
      .from('float_channel_transactions').update({ status: 'voided' }).eq('id', origFc.id).neq('status', 'voided').select('id');
    if (voidErr) return { ok: false, message: 'Failed to void the record: ' + voidErr.message };
    if (!voidedRows?.length) return { ok: true, message: `${req.tx_ref} was already voided by another approved request — balances left untouched.`, info: true };

    const fcRate = await getQuoteToRwfRate(origFc.branch_id, origFc.currency);
    const { error: revErr } = await applyBalanceLegs(floatChannelLegs(origFc, -1, `VOID ${req.tx_ref} [reversed]`, fcRate));
    if (revErr) return { ok: false, message: `${req.tx_ref} marked voided, but reversing balances failed — correct manually: ` + revErr.message };
    return { ok: true };
  }

  if (req.request_type === 'edit' && req.field_changes) {
    const changes = req.field_changes;
    const newType = changes.type !== undefined ? changes.type : origFc.type;
    const newSrc = changes.source_account !== undefined ? changes.source_account : origFc.source_account;
    const newDest = changes.dest_account !== undefined ? changes.dest_account : origFc.dest_account;

    // type is just a label — floatChannelLegs signs the ledger purely off
    // source_account/dest_account, so an edit that flips type without also
    // swapping the accounts leaves the record's label and its real money
    // movement pointing opposite ways (see FLT-278D4B7B-26: type edited to
    // 'withdraw' with source/dest left as-is from the original 'deposit').
    // Require the accounts to swap in lockstep with the type.
    if (newType !== origFc.type && (newSrc !== origFc.dest_account || newDest !== origFc.source_account)) {
      return { ok: false, message: `Changing type from '${origFc.type}' to '${newType}' must also swap source_account and dest_account (to '${origFc.dest_account}' and '${origFc.source_account}') — resubmit the edit with both accounts swapped so the record stays consistent with the ledger.` };
    }

    // TellerActivity.jsx's FloatChannelRequestModal has no positivity gate
    // on its amount field (unlike WuMgRequestModal/RiaRequestModal's own
    // paidOffBand check) -- a raw request with amount <= 0 would otherwise
    // reverse the original legs and re-apply a zero/negative one unchecked,
    // silently corrupting the balance this "edit" is supposed to correct.
    const editAmount = changes.amount !== undefined ? Number(changes.amount) : Number(origFc.amount);
    if (!Number.isFinite(editAmount) || editAmount <= 0) {
      return { ok: false, message: `Amount must be a positive number (got ${changes.amount})` };
    }

    const origFcRate = await getQuoteToRwfRate(origFc.branch_id, origFc.currency);
    const { error: revErr } = await applyBalanceLegs(floatChannelLegs(origFc, -1, `Edit ${req.tx_ref} [reversal]`, origFcRate));
    if (revErr) return { ok: false, message: 'Failed to reverse original balances — nothing was applied: ' + revErr.message };

    const merged = { ...origFc, ...changes };
    const mergedFcRate = merged.currency === origFc.currency ? origFcRate : await getQuoteToRwfRate(merged.branch_id, merged.currency);
    const { error: applyErr } = await applyBalanceLegs(floatChannelLegs(merged, +1, `Edit ${req.tx_ref} [applied]`, mergedFcRate));
    if (applyErr) return { ok: false, message: 'Original reversed but re-applying the edit failed — contact admin: ' + applyErr.message };

    const newAmount = changes.amount !== undefined ? Number(changes.amount) : origFc.amount;
    const newCurrency = changes.currency !== undefined ? changes.currency : origFc.currency;
    const newNotes = changes.notes !== undefined ? changes.notes : origFc.notes;

    const { error: updErr } = await serviceClient.from('float_channel_transactions').update({
      type: newType,
      source_account: newSrc,
      dest_account: newDest,
      currency: newCurrency,
      amount: newAmount,
      notes: newNotes,
    }).eq('id', origFc.id);
    if (updErr) return { ok: false, message: 'Balances updated but the record failed to save — contact admin: ' + updErr.message };

    const { error: auditErr } = await serviceClient.from('audit_logs').insert({
      actor: reviewerId,
      action: 'edit',
      object_type: 'float_channel_transaction',
      object_id: origFc.id,
      details: {
        tx_ref: req.tx_ref,
        reason: req.reason,
        previous: { type: origFc.type, source_account: origFc.source_account, dest_account: origFc.dest_account, amount: origFc.amount, currency: origFc.currency, notes: origFc.notes },
        updated: { type: newType, source_account: newSrc, dest_account: newDest, amount: newAmount, currency: newCurrency, notes: newNotes },
      },
    });
    if (auditErr) warnings.push(`${req.tx_ref} edited, but the audit log entry failed to save: ${auditErr.message}`);

    return { ok: true };
  }

  return { ok: true };
}

// --- ria_transaction -------------------------------------------------

// Forgotten Ria entry — mirrors ApprovalsPage.jsx's entity_type ===
// 'ria_transaction' && request_type === 'add' branch. source_account/
// dest_account are derived from type, same as TellerRia.jsx/the create
// route.
async function handleRiaAdd(req) {
  const ref = 'RIA-' + crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase() + '-26';
  const fc = req.field_changes;

  // Legs + row insert now happen atomically — see
  // 20260826120200_atomic_channel_creation.sql (same fix as handleFloatChannelAdd).
  const { error } = await callRpcAsService('create_ria_transaction', {
    p_reference: ref, p_type: fc.type, p_amount: Number(fc.amount) || 0, p_amount_paid: Number(fc.amount_paid) || 0,
    p_branch_id: req.branch_id, p_teller_id: req.teller_id,
    p_customer_name: fc.customer_name || null, p_notes: fc.notes || null,
    p_desc_override: `Forgotten ${ref}`, p_created_at: parseOccurredAt(fc),
  });
  if (error) return { ok: false, message: 'Balance update failed — nothing was applied: ' + error.message };
  return { ok: true };
}

async function handleRiaDeleteOrEdit(req) {
  const { data: origRia } = await serviceClient.from('ria_transactions').select('*').eq('id', req.ria_transaction_id).maybeSingle();
  if (!origRia || origRia.status === 'voided') return { ok: true };

  if (req.request_type === 'delete') {
    const { data: voidedRows, error: voidErr } = await serviceClient
      .from('ria_transactions').update({ status: 'voided' }).eq('id', origRia.id).neq('status', 'voided').select('id');
    if (voidErr) return { ok: false, message: 'Failed to void the record: ' + voidErr.message };
    if (!voidedRows?.length) return { ok: true, message: `${req.tx_ref} was already voided by another approved request — balances left untouched.`, info: true };

    const { error: revErr } = await applyBalanceLegs(riaLegs(origRia, -1, `VOID ${req.tx_ref} [reversed]`));
    if (revErr) return { ok: false, message: `${req.tx_ref} marked voided, but reversing balances failed — correct manually: ` + revErr.message };
    return { ok: true };
  }

  if (req.request_type === 'edit' && req.field_changes) {
    const changes = req.field_changes;
    // RiaRequestModal's own paidOffBand check is client-side only — a raw
    // API call bypasses it entirely. riaLegs reads amount_paid (not
    // amount) to compute the real balance legs below, so that's the field
    // that actually matters; amount is validated too since it's stored and
    // displayed alongside it (same pair the WU/MG edit path already checks).
    const newAmount = changes.amount !== undefined ? Number(changes.amount) : Number(origRia.amount);
    const newAmountPaid = changes.amount_paid !== undefined ? Number(changes.amount_paid) : Number(origRia.amount_paid);
    if (!Number.isFinite(newAmount) || newAmount <= 0) {
      return { ok: false, message: `Amount must be a positive number (got ${changes.amount})` };
    }
    if (!Number.isFinite(newAmountPaid) || newAmountPaid <= 0) {
      return { ok: false, message: `Amount paid must be a positive number (got ${changes.amount_paid})` };
    }

    const { error: revErr } = await applyBalanceLegs(riaLegs(origRia, -1, `Edit ${req.tx_ref} [reversal]`));
    if (revErr) return { ok: false, message: 'Failed to reverse original balances — nothing was applied: ' + revErr.message };

    const merged = { ...origRia, ...changes };
    const { error: applyErr } = await applyBalanceLegs(riaLegs(merged, +1, `Edit ${req.tx_ref} [applied]`));
    if (applyErr) return { ok: false, message: 'Original reversed but re-applying the edit failed — contact admin: ' + applyErr.message };

    const newRiaType = changes.type !== undefined ? changes.type : origRia.type;
    const { error: updErr } = await serviceClient.from('ria_transactions').update({
      type: newRiaType,
      amount: changes.amount !== undefined ? Number(changes.amount) : origRia.amount,
      amount_paid: changes.amount_paid !== undefined ? Number(changes.amount_paid) : origRia.amount_paid,
      source_account: newRiaType === 'receive' ? 'Cash(RWF)' : 'Equity Bank (RIA,MG,WU)',
      dest_account: newRiaType === 'receive' ? 'Equity Bank (RIA,MG,WU)' : 'Cash(RWF)',
      customer_name: changes.customer_name !== undefined ? changes.customer_name : origRia.customer_name,
      notes: changes.notes !== undefined ? changes.notes : origRia.notes,
    }).eq('id', origRia.id);
    if (updErr) return { ok: false, message: 'Balances updated but the record failed to save — contact admin: ' + updErr.message };
    return { ok: true };
  }

  return { ok: true };
}

// --- western_union_transaction -------------------------------------------

// Forgotten Western Union entry — mirrors ApprovalsPage.jsx's
// (entity_type === 'western_union_transaction' || 'money_gram_transaction')
// && request_type === 'add' branch, scoped to just western_union_transaction
// (money_gram_transaction still runs the original frontend code — see the
// module comment above). source_account/dest_account are derived the same
// way the create route does (svcAccounts), never taken from field_changes.
async function handleWuAdd(req, warnings) {
  const ref = 'WU-' + crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase() + '-26';
  const fc = req.field_changes;
  // See westernUnionTransactions.js's own comment: a pure-USD payment has no
  // RWF leg at all (both legs delta=0 by design), so without this override
  // both legs' account_movements.amount_rwf silently land on 0. This
  // backfill path shares the same SQL function as the live create route but
  // was missed when that route's own p_amount_rwf_override fix shipped.
  const amountRwfOverride = fc.pay_currency === 'usd' ? (Number(fc.pay_fx) || 0) * (await getQuoteToRwfRate(req.branch_id, 'USD')) : null;

  // Legs + row insert now happen atomically — see
  // 20260826120200_atomic_channel_creation.sql (same fix as handleFloatChannelAdd).
  // source_account/dest_account are derived server-side inside that
  // function, same as the create route already does.
  const { error } = await callRpcAsService('create_western_union_transaction', {
    p_reference: ref, p_type: fc.type, p_currency: fc.currency, p_amount: Number(fc.amount) || 0,
    p_rate_applied: fc.rate_applied ? Number(fc.rate_applied) : null,
    p_equivalent_rwf: Number(fc.equivalent_rwf) || 0, p_amount_paid: Number(fc.amount_paid) || 0,
    p_pay_currency: fc.pay_currency, p_pay_rwf: fc.pay_rwf != null ? Number(fc.pay_rwf) : null,
    p_pay_fx: fc.pay_fx != null ? Number(fc.pay_fx) : null,
    p_branch_id: req.branch_id, p_teller_id: req.teller_id,
    p_customer_name: fc.customer_name || null, p_notes: fc.notes || null,
    p_desc_override: `Forgotten ${ref}`, p_amount_rwf_override: amountRwfOverride,
    p_created_at: parseOccurredAt(fc),
  });
  if (error) return { ok: false, message: 'Balance update failed — nothing was applied: ' + error.message };

  // See svcWacOp's own comment — this backfill path shares the same SQL
  // function as the live create route but was missing this WAC step
  // entirely: a USD order paid in RWF/split really did move USD stock (the
  // settle-account/till legs above prove it), but without this,
  // wac_inventory's quantity/cost basis for this branch+USD never reflected
  // it, leaving it permanently out of sync with the real balance_fx.
  const wacResult = await svcWacOp({ ...fc, branch_id: req.branch_id }, +1);
  if (wacResult?.error) warnings.push(`${ref} recorded, but the inventory (WAC) update failed — cost basis may be out of sync: ${wacResult.error.message}`);

  return { ok: true };
}

// Mirrors ApprovalsPage.jsx's (entity_type === 'western_union_transaction'
// || 'money_gram_transaction') && request_type in (delete, edit) branch,
// scoped to just western_union_transaction.
async function handleWuDeleteOrEdit(req, warnings) {
  const { data: origWu } = await serviceClient.from('western_union_transactions').select('*').eq('id', req.western_union_transaction_id).maybeSingle();
  if (!origWu || origWu.status === 'voided') return { ok: true };
  // Only needed for a pure-USD row's own two delta=0 legs -- see svcLegs'
  // own comment. Re-quoted live rather than trusted from the row, same
  // reasoning as handlePetitCashDeleteOrEdit's origRwfOverride (a row from
  // before this fix shipped still carries stale/0 amount_rwf).
  const wuRate = origWu.pay_currency === 'usd' ? await getQuoteToRwfRate(origWu.branch_id, 'USD') : 0;

  if (req.request_type === 'delete') {
    const { data: voidedRows, error: voidErr } = await serviceClient
      .from('western_union_transactions').update({ status: 'voided' }).eq('id', origWu.id).neq('status', 'voided').select('id');
    if (voidErr) return { ok: false, message: 'Failed to void the record: ' + voidErr.message };
    if (!voidedRows?.length) return { ok: true, message: `${req.tx_ref} was already voided by another approved request — balances left untouched.`, info: true };

    const { error: revErr } = await applyBalanceLegs(svcLegs(origWu, -1, `VOID ${req.tx_ref} [reversed]`, wuRate));
    if (revErr) return { ok: false, message: `${req.tx_ref} marked voided, but reversing balances failed — correct manually: ` + revErr.message };

    // See svcWacOp's own comment — reverses whatever WAC effect this row's
    // creation had. Previously missing entirely: voiding a pickup left
    // phantom USD stock behind (balance reversed but wac_inventory never
    // depleted back), and voiding a send never restored the stock it had
    // depleted.
    const wacResult = await svcWacOp(origWu, -1);
    if (wacResult?.error) warnings.push(`${req.tx_ref} voided, but the inventory (WAC) reversal failed — cost basis may be out of sync: ${wacResult.error.message}`);

    return { ok: true };
  }

  if (req.request_type === 'edit' && req.field_changes) {
    const changes = req.field_changes;
    const { error: revErr } = await applyBalanceLegs(svcLegs(origWu, -1, `Edit ${req.tx_ref} [reversal]`, wuRate));
    if (revErr) return { ok: false, message: 'Failed to reverse original balances — nothing was applied: ' + revErr.message };

    const merged = { ...origWu, ...changes };
    const mergedWuRate = merged.pay_currency === origWu.pay_currency ? wuRate : (merged.pay_currency === 'usd' ? await getQuoteToRwfRate(merged.branch_id, 'USD') : 0);
    const { error: applyErr } = await applyBalanceLegs(svcLegs(merged, +1, `Edit ${req.tx_ref} [applied]`, mergedWuRate));
    if (applyErr) return { ok: false, message: 'Original reversed but re-applying the edit failed — contact admin: ' + applyErr.message };

    // Same reverse-then-reapply shape as the balance legs just above.
    const wacRevResult = await svcWacOp(origWu, -1);
    if (wacRevResult?.error) warnings.push(`${req.tx_ref} edited, but reversing the original inventory (WAC) effect failed — cost basis may be out of sync: ${wacRevResult.error.message}`);
    const wacApplyResult = await svcWacOp(merged, +1);
    if (wacApplyResult?.error) warnings.push(`${req.tx_ref} edited, but applying the new inventory (WAC) effect failed — cost basis may be out of sync: ${wacApplyResult.error.message}`);

    const { source_account, dest_account } = svcAccounts(merged);
    const { error: updErr } = await serviceClient.from('western_union_transactions').update({
      type: merged.type,
      source_account, dest_account,
      amount_paid: changes.amount_paid !== undefined ? Number(changes.amount_paid) : origWu.amount_paid,
      customer_name: changes.customer_name !== undefined ? changes.customer_name : origWu.customer_name,
      notes: changes.notes !== undefined ? changes.notes : origWu.notes,
    }).eq('id', origWu.id);
    if (updErr) return { ok: false, message: 'Balances updated but the record failed to save — contact admin: ' + updErr.message };
    return { ok: true };
  }

  return { ok: true };
}

// --- money_gram_transaction ------------------------------------------------

// Forgotten Money Gram entry — mirrors ApprovalsPage.jsx's
// (entity_type === 'western_union_transaction' || 'money_gram_transaction')
// && request_type === 'add' branch, scoped to just money_gram_transaction
// (identical shape to handleWuAdd — same svcLegs/svcAccounts, different
// table and reference prefix).
async function handleMgAdd(req, warnings) {
  const ref = 'MG-' + crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase() + '-26';
  const fc = req.field_changes;
  // See handleWuAdd's own comment — identical gap, identical fix.
  const amountRwfOverride = fc.pay_currency === 'usd' ? (Number(fc.pay_fx) || 0) * (await getQuoteToRwfRate(req.branch_id, 'USD')) : null;

  // Legs + row insert now happen atomically — see
  // 20260826120200_atomic_channel_creation.sql (same fix as handleFloatChannelAdd).
  const { error } = await callRpcAsService('create_money_gram_transaction', {
    p_reference: ref, p_type: fc.type, p_currency: fc.currency, p_amount: Number(fc.amount) || 0,
    p_rate_applied: fc.rate_applied ? Number(fc.rate_applied) : null,
    p_equivalent_rwf: Number(fc.equivalent_rwf) || 0, p_amount_paid: Number(fc.amount_paid) || 0,
    p_pay_currency: fc.pay_currency, p_pay_rwf: fc.pay_rwf != null ? Number(fc.pay_rwf) : null,
    p_pay_fx: fc.pay_fx != null ? Number(fc.pay_fx) : null,
    p_branch_id: req.branch_id, p_teller_id: req.teller_id,
    p_customer_name: fc.customer_name || null, p_notes: fc.notes || null,
    p_desc_override: `Forgotten ${ref}`, p_amount_rwf_override: amountRwfOverride,
    p_created_at: parseOccurredAt(fc),
  });
  if (error) return { ok: false, message: 'Balance update failed — nothing was applied: ' + error.message };

  // See svcWacOp's own comment — identical gap, identical fix as handleWuAdd.
  const wacResult = await svcWacOp({ ...fc, branch_id: req.branch_id }, +1);
  if (wacResult?.error) warnings.push(`${ref} recorded, but the inventory (WAC) update failed — cost basis may be out of sync: ${wacResult.error.message}`);

  return { ok: true };
}

// Mirrors ApprovalsPage.jsx's (entity_type === 'western_union_transaction'
// || 'money_gram_transaction') && request_type in (delete, edit) branch,
// scoped to just money_gram_transaction.
async function handleMgDeleteOrEdit(req, warnings) {
  const { data: origMg } = await serviceClient.from('money_gram_transactions').select('*').eq('id', req.money_gram_transaction_id).maybeSingle();
  if (!origMg || origMg.status === 'voided') return { ok: true };
  // See handleWuDeleteOrEdit's own comment — identical gap, identical fix.
  const mgRate = origMg.pay_currency === 'usd' ? await getQuoteToRwfRate(origMg.branch_id, 'USD') : 0;

  if (req.request_type === 'delete') {
    const { data: voidedRows, error: voidErr } = await serviceClient
      .from('money_gram_transactions').update({ status: 'voided' }).eq('id', origMg.id).neq('status', 'voided').select('id');
    if (voidErr) return { ok: false, message: 'Failed to void the record: ' + voidErr.message };
    if (!voidedRows?.length) return { ok: true, message: `${req.tx_ref} was already voided by another approved request — balances left untouched.`, info: true };

    const { error: revErr } = await applyBalanceLegs(svcLegs(origMg, -1, `VOID ${req.tx_ref} [reversed]`, mgRate));
    if (revErr) return { ok: false, message: `${req.tx_ref} marked voided, but reversing balances failed — correct manually: ` + revErr.message };

    const wacResult = await svcWacOp(origMg, -1);
    if (wacResult?.error) warnings.push(`${req.tx_ref} voided, but the inventory (WAC) reversal failed — cost basis may be out of sync: ${wacResult.error.message}`);

    return { ok: true };
  }

  if (req.request_type === 'edit' && req.field_changes) {
    const changes = req.field_changes;
    const { error: revErr } = await applyBalanceLegs(svcLegs(origMg, -1, `Edit ${req.tx_ref} [reversal]`, mgRate));
    if (revErr) return { ok: false, message: 'Failed to reverse original balances — nothing was applied: ' + revErr.message };

    const merged = { ...origMg, ...changes };
    const mergedMgRate = merged.pay_currency === origMg.pay_currency ? mgRate : (merged.pay_currency === 'usd' ? await getQuoteToRwfRate(merged.branch_id, 'USD') : 0);
    const { error: applyErr } = await applyBalanceLegs(svcLegs(merged, +1, `Edit ${req.tx_ref} [applied]`, mergedMgRate));
    if (applyErr) return { ok: false, message: 'Original reversed but re-applying the edit failed — contact admin: ' + applyErr.message };

    const wacRevResult = await svcWacOp(origMg, -1);
    if (wacRevResult?.error) warnings.push(`${req.tx_ref} edited, but reversing the original inventory (WAC) effect failed — cost basis may be out of sync: ${wacRevResult.error.message}`);
    const wacApplyResult = await svcWacOp(merged, +1);
    if (wacApplyResult?.error) warnings.push(`${req.tx_ref} edited, but applying the new inventory (WAC) effect failed — cost basis may be out of sync: ${wacApplyResult.error.message}`);

    const { source_account, dest_account } = svcAccounts(merged);
    const { error: updErr } = await serviceClient.from('money_gram_transactions').update({
      type: merged.type,
      source_account, dest_account,
      amount_paid: changes.amount_paid !== undefined ? Number(changes.amount_paid) : origMg.amount_paid,
      customer_name: changes.customer_name !== undefined ? changes.customer_name : origMg.customer_name,
      notes: changes.notes !== undefined ? changes.notes : origMg.notes,
    }).eq('id', origMg.id);
    if (updErr) return { ok: false, message: 'Balances updated but the record failed to save — contact admin: ' + updErr.message };
    return { ok: true };
  }

  return { ok: true };
}

// --- dispatch --------------------------------------------------------------

async function dispatch(req, warnings, reviewerId) {
  if (req.entity_type === 'internal_transfer') {
    return req.request_type === 'add' && req.field_changes
      ? handleInternalTransferAdd(req)
      : handleInternalTransferDeleteOrEdit(req, warnings);
  }
  if (req.entity_type === 'inter_branch_txn') {
    return req.request_type === 'add' && req.field_changes
      ? handleInterBranchAdd(req)
      : handleInterBranchDeleteOrEdit(req, warnings);
  }
  if (req.entity_type === 'branch_float_transfer') {
    return req.request_type === 'add' && req.field_changes
      ? handleBranchFloatAdd(req)
      : handleBranchFloatDeleteOrEdit(req, warnings);
  }
  if (req.entity_type === 'transaction') {
    if (req.request_type === 'add' && req.field_changes) return handleTransactionAdd(req, warnings);
    if (req.request_type === 'delete') return handleTransactionDelete(req, warnings);
    if (req.request_type === 'edit' && req.field_changes) return handleTransactionEdit(req, warnings);
    return { ok: false, message: `Unrecognized request (entity_type: transaction, request_type: ${req.request_type}) — nothing was applied. Contact support.` };
  }
  if (req.entity_type === 'petit_cash_entry') {
    return req.request_type === 'add' && req.field_changes
      ? handlePetitCashAdd(req, reviewerId)
      : handlePetitCashDeleteOrEdit(req, reviewerId);
  }
  if (req.entity_type === 'float_channel_transaction') {
    return req.request_type === 'add' && req.field_changes
      ? handleFloatChannelAdd(req)
      : handleFloatChannelDeleteOrEdit(req, warnings, reviewerId);
  }
  if (req.entity_type === 'ria_transaction') {
    return req.request_type === 'add' && req.field_changes
      ? handleRiaAdd(req)
      : handleRiaDeleteOrEdit(req);
  }
  if (req.entity_type === 'western_union_transaction') {
    return req.request_type === 'add' && req.field_changes
      ? handleWuAdd(req, warnings)
      : handleWuDeleteOrEdit(req, warnings);
  }
  if (req.entity_type === 'money_gram_transaction') {
    return req.request_type === 'add' && req.field_changes
      ? handleMgAdd(req, warnings)
      : handleMgDeleteOrEdit(req, warnings);
  }
  return { ok: false, message: `Unsupported entity_type '${req.entity_type}' for server-side approval` };
}

// Claims the tx_requests row atomically, dispatches to the entity-specific
// handler, and reopens the row to 'pending' if anything below the claim
// fails — same shape as the frontend's original try/finally, just
// server-side so every step happens in one request instead of racing
// separate browser-to-Supabase calls.
async function approveTxRequest(reqRow, reviewerId) {
  const { data: claimedRows, error: claimErr } = await serviceClient
    .from('tx_requests')
    .update({ status: 'approved', reviewed_by: reviewerId, reviewed_at: new Date().toISOString() })
    .eq('id', reqRow.id).eq('status', 'pending')
    .select('id');
  if (claimErr) return { ok: false, message: 'Failed: ' + claimErr.message };
  if (!claimedRows?.length) return { ok: false, message: 'This request was already handled by another approver.', alreadyHandled: true };

  const warnings = [];
  let result;
  try {
    result = await dispatch(reqRow, warnings, reviewerId);
  } catch (e) {
    result = { ok: false, message: e.message || 'Unexpected error' };
  }

  if (!result.ok) {
    await serviceClient.from('tx_requests').update({ status: 'pending', reviewed_by: null, reviewed_at: null }).eq('id', reqRow.id);
    return result;
  }

  // The "already voided by another approved request" case still shows its
  // info toast on the frontend, but that doesn't stop the original code
  // from falling through to the shared success path (approved toast +
  // requester notification) — no early return there, so this always fires
  // on success, info case included.
  await notifyRequester(reqRow, warnings);

  return { ok: true, message: result.message, info: result.info, warnings };
}

module.exports = { approveTxRequest, SUPPORTED_ENTITY_TYPES };
