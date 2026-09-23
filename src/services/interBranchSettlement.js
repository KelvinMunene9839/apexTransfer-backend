// Ported 1:1 from prestigevuntures/src/pages/ApprovalsPage.jsx's
// approveEditRequest, entity_type === 'inter_branch_txn' branch — the
// multi-leg (RWF + FX + optional split payment + WAC + wire fee) reversal/
// reapplication math for editing or deleting an already-settled inter-
// branch transaction. Kept in its own module because it's genuinely
// intricate and deserves to be readable on its own, not buried in route
// wiring.
const { applyBalanceLegs, updateAccountBalance, upsertWacInventory, reduceWacInventoryAcrossLots } = require('./balanceOps');

// sign: +1 to apply (forward), -1 to reverse.
function settleOps(row, sign) {
  const ccy = row.currency;
  const quoteCcy = row.quote_currency || 'RWF';
  const isRwfQuote = quoteCcy === 'RWF';
  // Only default to Cash(RWF) for a genuinely RWF-quoted trade — defaulting
  // it for a cross-currency quote (row.quote_account missing/null) would
  // post that leg's real FX currency onto an account named "Cash(RWF)",
  // which every account in this system that isn't actually RWF-only-named
  // is not configured to hold (see 20260720000001_fx_only_accounts_no_rwf_pollution.sql).
  // Left null here, quoteLeg's own `name && (...)` guard drops the leg
  // instead of posting it to the wrong account.
  const quoteAcct = row.quote_account || (isRwfQuote ? 'Cash(RWF)' : null);
  const fxUnits = Number(row.amount_foreign);
  const rwfEquiv = Number(row.equivalent_quote) || Number(row.equivalent_rwf) || (fxUnits * Number(row.rate_applied || 1));
  const rate = Number(row.rate_applied) || (fxUnits > 0 ? rwfEquiv / fxUnits : 0);
  const isSplitPay = row.pay_currency && row.pay_currency !== 'rwf';
  const payRwf = isSplitPay ? Number(row.pay_rwf || 0) : Number(row.amount_paid || 0);
  const payFx = isSplitPay ? Number(row.pay_fx || 0) : 0;
  const payFxRwf = payFx * rate;
  const fxAcctTo = row.to_account;
  const desc = `${sign > 0 ? '' : 'VOID '}Inter-branch ${row.type} ${row.amount_foreign} ${ccy} — ${row.reference}`;

  const quoteLeg = (name, branchId, delta) => name && (
    isRwfQuote
      ? { name, branch_id: branchId, delta: delta * sign, amount_foreign: null, currency: null, description: desc, statement_category: 'inter_branch_trade' }
      : { name, branch_id: branchId, delta: 0, amount_foreign: delta * sign, currency: quoteCcy, description: desc, statement_category: 'inter_branch_trade' }
  );
  const fxLeg = (name, branchId, bookDelta, units) => name && { name, branch_id: branchId, delta: bookDelta * sign, amount_foreign: units * sign, currency: ccy, description: desc, statement_category: 'inter_branch_trade' };

  return (row.type === 'buy'
    ? [
        payRwf > 0 && quoteLeg(quoteAcct, row.from_branch_id, -payRwf),
        payFx > 0 && fxLeg(row.pay_account_fx, row.from_branch_id, -payFxRwf, -payFx),
        fxLeg(fxAcctTo, row.to_branch_id, +rwfEquiv, +fxUnits),
      ]
    : [
        payRwf > 0 && quoteLeg(quoteAcct, row.from_branch_id, +payRwf),
        payFx > 0 && fxLeg(row.pay_account_fx, row.from_branch_id, +payFxRwf, +payFx),
        fxLeg(fxAcctTo, row.to_branch_id, -rwfEquiv, -fxUnits),
      ]
  ).filter(Boolean);
}

function wacOps(row, sign) {
  const ccy = row.currency;
  const quoteCcy = row.quote_currency || 'RWF';
  const fxUnits = Number(row.amount_foreign);
  // A sell's fee leg (settleOps/feeOp) debits the SAME to_branch/ccy account
  // the main FX-out leg already reduces (see approve_inter_branch_txn's own
  // matching fix) -- the real balance drops by fxUnits + feeForeign, so the
  // WAC in/out on to_branch must match, or wac_inventory silently drifts
  // above the real held quantity by the fee amount on every reversal/reapply
  // of a fee-bearing sell. Buys never carry this fee (see approve_inter_
  // branch_txn's own buy branch), so this only ever applies to sell legs.
  const feeForeign = row.type === 'sell' ? Number(row.fee_foreign || 0) : 0;
  const toBranchUnits = fxUnits + feeForeign;
  const rwfEquiv = Number(row.equivalent_quote) || Number(row.equivalent_rwf) || (fxUnits * Number(row.rate_applied || 1));
  const rate = Number(row.rate_applied) || (fxUnits > 0 ? rwfEquiv / fxUnits : 0);
  const isSplitPay = row.pay_currency && row.pay_currency !== 'rwf';
  const payFx = isSplitPay ? Number(row.pay_fx || 0) : 0;
  const wacIn = (branchId, units) => upsertWacInventory({ p_branch_id: branchId, p_currency: ccy, p_quantity: units, p_cost_rwf: units * rate, p_cost_currency: quoteCcy });
  const wacOut = (branchId, units) => reduceWacInventoryAcrossLots(branchId, ccy, units, quoteCcy);
  const forwardBuy = () => [wacIn(row.to_branch_id, fxUnits), payFx > 0 && wacOut(row.from_branch_id, payFx)].filter(Boolean);
  const forwardSell = () => [wacOut(row.to_branch_id, toBranchUnits), payFx > 0 && wacIn(row.from_branch_id, payFx)].filter(Boolean);
  const reverseBuy = () => [wacOut(row.to_branch_id, fxUnits), payFx > 0 && wacIn(row.from_branch_id, payFx)].filter(Boolean);
  const reverseSell = () => [wacIn(row.to_branch_id, toBranchUnits), payFx > 0 && wacOut(row.from_branch_id, payFx)].filter(Boolean);
  if (fxUnits <= 0) return [];
  if (sign > 0) return row.type === 'buy' ? forwardBuy() : forwardSell();
  return row.type === 'buy' ? reverseBuy() : reverseSell();
}

function feeOp(row, sign) {
  const feeForeign = Number(row.fee_foreign || 0);
  if (row.type !== 'sell' || feeForeign <= 0 || !row.to_account) return null;
  const feeCcy = row.fee_currency || row.currency;
  return updateAccountBalance({
    p_name: row.to_account, p_branch_id: row.to_branch_id,
    p_delta: -Number(row.fee_rwf || 0) * sign, p_amount_foreign: -feeForeign * sign, p_currency: feeCcy,
    p_description: `${sign > 0 ? '' : 'VOID '}Transaction fee ${feeForeign} ${feeCcy} — inter-branch ${row.type} ${row.reference}`,
    p_source_type: 'float', p_statement_category: 'inter_branch_trade',
  });
}

// Returns an error object on failure, null on success — mirrors the
// frontend's own reverse() return shape so callers can `if (error) ...`.
async function reverse(row, warnings) {
  const { error } = await applyBalanceLegs(settleOps(row, -1));
  if (error) return error;
  const wacResults = await Promise.allSettled(wacOps(row, -1));
  const wacFailed = wacResults.find((r) => r.status === 'rejected' || r.value?.error);
  if (wacFailed) {
    const msg = wacFailed.reason?.message || wacFailed.value?.error?.message || 'unknown error';
    warnings.push(`${row.reference} reversed, but the inventory (WAC) update failed — cost basis may be out of sync: ${msg}`);
  }
  const feeR = feeOp(row, -1);
  if (feeR) {
    const { error: feeErr } = await feeR;
    if (feeErr) return feeErr;
  }
  return null;
}

async function reapply(row, warnings) {
  const { error } = await applyBalanceLegs(settleOps(row, +1));
  if (error) return error;
  const wacResults = await Promise.allSettled(wacOps(row, +1));
  const wacFailed = wacResults.find((r) => r.status === 'rejected' || r.value?.error);
  if (wacFailed) {
    const msg = wacFailed.reason?.message || wacFailed.value?.error?.message || 'unknown error';
    warnings.push(`edited, but the inventory (WAC) update failed — cost basis may be out of sync: ${msg}`);
  }
  const feeR = feeOp(row, +1);
  if (feeR) {
    const { error: feeErr } = await feeR;
    if (feeErr) warnings.push(`edit applied, but the transaction fee failed to re-apply — contact admin: ${feeErr.message}`);
  }
  return null;
}

module.exports = { reverse, reapply };
