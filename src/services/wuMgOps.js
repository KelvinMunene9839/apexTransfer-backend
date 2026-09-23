// Ported from prestigevuntures/src/pages/ApprovalsPage.jsx's svcLegs/
// svcAccounts — Western Union and Money Gram (Nyamirambo only) share the
// exact same 4-account shape (two cash tills, one Equity Bank settlement
// account per currency) and the same row columns, so both tables' create/
// void/edit logic reuse this one module, mirroring how the original
// frontend code shared it between the two entity_types.
const { upsertWacInventory, reduceWacInventoryAcrossLots } = require('./balanceOps');

const CASH_ACCOUNT = { USD: 'Cash(USD)', RWF: 'Cash(RWF)' };
const SETTLE_ACCOUNT = { USD: 'Equity Bank (MG,WU)', RWF: 'Equity Bank (RIA,MG,WU)' };

// Rebuilds the exact 2-3 balance legs a WU/MG row posted at creation,
// negated when sign is -1. Fully reconstructable from the row alone —
// pay_currency/pay_rwf/pay_fx capture which till(s) actually moved and how
// much.
// rate: RWF-per-USD, only needed (and only looked up by the caller) for the
// isPureUsd case -- both its legs are real FX movements with delta=0 by
// design (see update_account_balance's v_is_fx_leg branch), so without a
// rate their account_movements.amount_rwf silently lands on 0. Same bug,
// same fix as create_western_union_transaction/create_money_gram_transaction
// (this session) and floatChannelLegs' own rate param -- confirmed live: 8
// existing rows / $3,784 unreported this way before those SQL functions
// were fixed; this reversal/edit path had the identical gap and was missed
// in that pass.
function svcLegs(row, sign, desc, rate = 0) {
  const isReceiveLeg = row.type === 'pickup' || row.type === 'receive';
  const tillSign = (isReceiveLeg ? -1 : 1) * sign;
  const settleSign = -tillSign;
  const isFx = row.currency === 'USD';
  const isPureUsd = row.pay_currency === 'usd';
  const isSplit = row.pay_currency === 'split';
  const paidRwf = Number(row.amount_paid || 0);
  const numAmount = Number(row.amount || 0);
  const payFx = Number(row.pay_fx || 0);
  const payRwf = Number(row.pay_rwf || 0);
  const settleAccount = SETTLE_ACCOUNT[row.currency] || SETTLE_ACCOUNT.RWF;
  const pureUsdRwfOverride = isPureUsd && rate > 0 ? payFx * rate : null;

  const legs = [{
    name: settleAccount, branch_id: row.branch_id,
    delta: isPureUsd ? 0 : settleSign * paidRwf,
    amount_foreign: isFx ? settleSign * (isPureUsd ? payFx : numAmount) : null,
    currency: isFx ? 'USD' : null,
    description: desc, statement_category: 'remittance_settlement',
    ...(pureUsdRwfOverride != null ? { amount_rwf_override: pureUsdRwfOverride } : {}),
  }];
  if (isPureUsd) {
    legs.push({
      name: CASH_ACCOUNT.USD, branch_id: row.branch_id, delta: 0, amount_foreign: tillSign * payFx, currency: 'USD', description: desc, statement_category: 'remittance_settlement',
      ...(pureUsdRwfOverride != null ? { amount_rwf_override: pureUsdRwfOverride } : {}),
    });
  } else if (isSplit) {
    if (payRwf > 0) legs.push({ name: CASH_ACCOUNT.RWF, branch_id: row.branch_id, delta: tillSign * payRwf, amount_foreign: null, currency: null, description: desc, statement_category: 'remittance_settlement' });
    if (payFx > 0) legs.push({ name: CASH_ACCOUNT.USD, branch_id: row.branch_id, delta: tillSign * (payFx * Number(row.rate_applied || 0)), amount_foreign: tillSign * payFx, currency: 'USD', description: desc, statement_category: 'remittance_settlement' });
  } else {
    legs.push({ name: CASH_ACCOUNT.RWF, branch_id: row.branch_id, delta: tillSign * paidRwf, amount_foreign: null, currency: null, description: desc, statement_category: 'remittance_settlement' });
  }
  return legs;
}

// source_account/dest_account for a WU/MG row — both columns are NOT NULL,
// but svcLegs() never needs them (it derives everything from
// type/currency/pay_currency directly), so a forgotten-transaction "add"
// request has nowhere else to get them from.
function svcAccounts(row) {
  const isReceiveLeg = row.type === 'pickup' || row.type === 'receive';
  const settleAccount = SETTLE_ACCOUNT[row.currency] || SETTLE_ACCOUNT.RWF;
  const tillLabel = row.pay_currency === 'split'
    ? `${CASH_ACCOUNT.USD} + ${CASH_ACCOUNT.RWF}`
    : row.pay_currency === 'usd' ? CASH_ACCOUNT.USD : CASH_ACCOUNT.RWF;
  return isReceiveLeg
    ? { source_account: tillLabel, dest_account: settleAccount }
    : { source_account: settleAccount, dest_account: tillLabel };
}

// Applies (sign +1) or reverses (sign -1) whichever WAC inventory op a WU/MG
// row's own creation implied — the exact same isFx && !isPureUsd condition
// and netQty/netCostRwf formula create_western_union_transaction/
// create_money_gram_transaction's caller uses (see
// westernUnionTransactions.js/moneyGramTransactions.js), fully
// reconstructable from the row's own stored fields rather than needing a
// dedicated wac_cost_rate column the way transactions has. A pickup/receive
// order restocks USD at creation (upsert) and depletes it on reversal
// (reduce); a send order does the reverse — the isReceiveLeg/sign
// combination below picks the right direction for both "undo the original"
// (void, or an edit's old side) and "(re)apply" (create, or an edit's new
// side) callers.
//
// Found missing entirely from handleWuAdd/handleMgAdd (this session) and,
// more seriously, from handleWuDeleteOrEdit/handleMgDeleteOrEdit — voiding
// or editing an order that ever moved real USD stock left wac_inventory
// permanently out of sync with the reversed/reapplied balance: phantom
// stock left behind after voiding a pickup, or stock never restored after
// voiding a send.
async function svcWacOp(row, sign) {
  const isFx = row.currency === 'USD';
  const isPureUsd = row.pay_currency === 'usd';
  const isSplit = row.pay_currency === 'split';
  if (!isFx || isPureUsd) return { error: null };
  const numAmt = Number(row.amount) || 0;
  const payFx = Number(row.pay_fx) || 0;
  const netQty = isSplit ? (numAmt - payFx) : numAmt;
  const netCostRwf = isSplit ? (Number(row.pay_rwf) || 0) : (Number(row.amount_paid) || 0);
  if (netQty <= 0) return { error: null };
  const isReceiveLeg = row.type === 'pickup' || row.type === 'receive';
  const wantsUpsert = isReceiveLeg ? sign > 0 : sign < 0;
  return wantsUpsert
    ? upsertWacInventory({ p_branch_id: row.branch_id, p_currency: row.currency, p_quantity: netQty, p_cost_rwf: netCostRwf })
    : reduceWacInventoryAcrossLots(row.branch_id, row.currency, netQty, 'RWF');
}

module.exports = { svcLegs, svcAccounts, svcWacOp, CASH_ACCOUNT, SETTLE_ACCOUNT };
