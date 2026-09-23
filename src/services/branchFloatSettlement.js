// Ported 1:1 from prestigevuntures/src/pages/ApprovalsPage.jsx's
// approveEditRequest, entity_type === 'branch_float_transfer' branch.
// Simpler than inter-branch (no split payment, no wire fee currency
// choice) but same reverse(-1)/reapply(+1) shape.
const { applyBalanceLegs, upsertWacInventory, reduceWacInventoryAcrossLots } = require('./balanceOps');
const { serviceClient } = require('./rpc');

async function getBranchName(branchId) {
  if (!branchId) return null;
  const { data } = await serviceClient.from('branches').select('name').eq('id', branchId).maybeSingle();
  return data?.name ?? null;
}

// Description shape now matches create time's own two-sided wording
// ("Float transfer out to X — REF" / "... in from Y — REF", see
// TellerBranchTransfer.jsx/BranchApprovalsPage.jsx's acceptBranchFloatTransfer
// params) instead of the flatter "Float transfer REF" this edit/void path
// used to produce — same BFT- reference either way, so Paid-in Capital
// exclusion was never affected, but the two forms read as two different
// events for the same channel in the ledger.
async function settleOps(row, sign) {
  const ccy = row.currency;
  const amt = Number(row.amount);
  const feeAmt = Number(row.fee_amount || 0);
  const [fromName, toName] = await Promise.all([getBranchName(row.from_branch_id), getBranchName(row.to_branch_id)]);
  const voidPrefix = sign > 0 ? '' : 'VOID ';
  const descOut = `${voidPrefix}Float transfer out to ${toName || row.to_branch_id} — ${row.reference}`;
  const descIn  = `${voidPrefix}Float transfer in from ${fromName || row.from_branch_id} — ${row.reference}`;
  const descFee = `${voidPrefix}Float transfer fee ${feeAmt} ${ccy} — ${row.reference}`;
  const legs = [];
  if (row.from_account) legs.push({
    name: row.from_account, branch_id: row.from_branch_id,
    delta: ccy === 'RWF' ? -amt * sign : 0, description: descOut,
    amount_foreign: ccy !== 'RWF' ? -amt * sign : null, currency: ccy !== 'RWF' ? ccy : null,
    statement_category: 'internal_float_transfer',
  });
  if (row.to_account) legs.push({
    name: row.to_account, branch_id: row.to_branch_id,
    delta: ccy === 'RWF' ? +amt * sign : 0, description: descIn,
    amount_foreign: ccy !== 'RWF' ? +amt * sign : null, currency: ccy !== 'RWF' ? ccy : null,
    statement_category: 'internal_float_transfer',
  });
  if (feeAmt > 0 && row.from_account) legs.push({
    name: row.from_account, branch_id: row.from_branch_id,
    delta: ccy === 'RWF' ? -feeAmt * sign : 0, description: descFee,
    amount_foreign: ccy !== 'RWF' ? -feeAmt * sign : null, currency: ccy !== 'RWF' ? ccy : null,
    statement_category: 'internal_float_transfer',
  });
  return legs;
}

function wacOps(row, sign) {
  const ccy = row.currency;
  const amt = Number(row.amount);
  if (ccy === 'RWF' || amt <= 0) return [];
  const rate = Number(row.wac_rate_snapshot || 0);
  // The fee leg (settleOps' descFee) debits the SAME from_branch/ccy account
  // the main transfer-out leg already reduces (see accept_branch_float_
  // transfer's own matching fix) -- the real balance drops by amt + feeAmt,
  // so the WAC in/out on from_branch must match, or wac_inventory silently
  // drifts above the real held quantity on every fee-bearing transfer.
  const feeAmt = Number(row.fee_amount || 0);
  const fromBranchUnits = amt + feeAmt;
  if (sign > 0) {
    return [
      reduceWacInventoryAcrossLots(row.from_branch_id, ccy, fromBranchUnits, 'RWF'),
      rate > 0 && upsertWacInventory({ p_branch_id: row.to_branch_id, p_currency: ccy, p_quantity: amt, p_cost_rwf: amt * rate }),
    ].filter(Boolean);
  }
  if (rate <= 0) return [];
  return [
    upsertWacInventory({ p_branch_id: row.from_branch_id, p_currency: ccy, p_quantity: fromBranchUnits, p_cost_rwf: fromBranchUnits * rate }),
    reduceWacInventoryAcrossLots(row.to_branch_id, ccy, amt, 'RWF'),
  ];
}

async function reverse(row, warnings) {
  const { error } = await applyBalanceLegs(await settleOps(row, -1));
  if (error) return error;
  const wacResults = await Promise.allSettled(wacOps(row, -1));
  const wacFailed = wacResults.find((r) => r.status === 'rejected' || r.value?.error);
  if (wacFailed) {
    const msg = wacFailed.reason?.message || wacFailed.value?.error?.message || 'unknown error';
    warnings.push(`${row.reference} reversed, but the inventory (WAC) update failed — cost basis may be out of sync: ${msg}`);
  }
  return null;
}

async function reapply(row, warnings) {
  const { error } = await applyBalanceLegs(await settleOps(row, +1));
  if (error) return error;
  const wacResults = await Promise.allSettled(wacOps(row, +1));
  const wacFailed = wacResults.find((r) => r.status === 'rejected' || r.value?.error);
  if (wacFailed) {
    const msg = wacFailed.reason?.message || wacFailed.value?.error?.message || 'unknown error';
    warnings.push(`${row.reference} edited, but the inventory (WAC) update failed — cost basis may be out of sync: ${msg}`);
  }
  return null;
}

module.exports = { reverse, reapply };
