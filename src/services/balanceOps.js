// Low-level balance-op callers for server-side business logic that's
// already been authorized once at the top of its own route (the tx-requests
// approve flow, admin/accountant/super_teller only) — these call the RPCs
// directly as service_role instead of going through the public
// routes/api/rpc/ HTTP layer (which would just be an unnecessary self-call
// re-checking authorization that's already been checked).
const { callRpcAsService, serviceClient } = require('./rpc');

function applyBalanceLegs(legs) {
  return callRpcAsService('apply_balance_legs', { p_legs: legs });
}

function updateAccountBalance(params) {
  return callRpcAsService('update_account_balance', params);
}

function reduceWacInventory(params) {
  return callRpcAsService('reduce_wac_inventory', params);
}

function upsertWacInventory(params) {
  return callRpcAsService('upsert_wac_inventory', params);
}

// A branch can hold the same currency costed in more than one cost_currency
// lot at once (e.g. Super Teller's TZS bought against both KES and ZMW).
// reduce_wac_inventory (SQL) only ever touches the ONE lot matching
// p_cost_currency exactly -- correct when that lot alone covers the
// disposal, but a disposal quoted in a currency whose own lot is thin or
// empty needs to draw from the branch's OTHER lots of the same currency
// too, or it silently strands quantity in those other lots forever while
// the matching one clamps to zero (confirmed live: Super Teller's TZS/KES
// and TZS/ZMW lots stayed overstated by millions of units while TZS/RWF
// sat at 0, because every real disposal was RWF-quoted).
//
// The lot-selection decision lives here, in the backend, not in SQL --
// reduce_wac_inventory stays the single dumb "reduce exactly this one
// (branch, currency, cost_currency) lot, clamped at zero" primitive it
// always was; this function just decides which lot(s) to call it on and
// with how much of p_quantity each. Preferred lot (matching
// preferredCostCurrency) drawn from first if it has stock, then whichever
// other lots remain, largest quantity first, until the full quantity is
// covered or every lot is exhausted (same clamp-at-the-pooled-total
// outcome as before, just decided here instead of inside a SQL loop).
async function reduceWacInventoryAcrossLots(branchId, currency, quantity, preferredCostCurrency = 'RWF') {
  const qty = Number(quantity);
  if (!(qty > 0)) return { error: null };

  const { data: lots, error: fetchErr } = await serviceClient
    .from('wac_inventory')
    .select('cost_currency, quantity')
    .eq('branch_id', branchId).eq('currency', currency).gt('quantity', 0);
  if (fetchErr) return { error: fetchErr };

  const ordered = (lots || []).slice().sort((a, b) => {
    const aMatch = a.cost_currency === preferredCostCurrency ? 1 : 0;
    const bMatch = b.cost_currency === preferredCostCurrency ? 1 : 0;
    if (aMatch !== bMatch) return bMatch - aMatch;
    return Number(b.quantity) - Number(a.quantity);
  });

  let remaining = qty;
  for (const lot of ordered) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, Number(lot.quantity));
    const { error: redErr } = await callRpcAsService('reduce_wac_inventory', {
      p_branch_id: branchId, p_currency: currency, p_quantity: take, p_cost_currency: lot.cost_currency,
    });
    if (redErr) return { error: redErr };
    remaining -= take;
  }
  // Any remainder beyond total stock across every lot is simply dropped --
  // same clamp-at-zero behavior the old single-lot call always had.
  return { error: null };
}

module.exports = { applyBalanceLegs, updateAccountBalance, reduceWacInventory, upsertWacInventory, reduceWacInventoryAcrossLots };
