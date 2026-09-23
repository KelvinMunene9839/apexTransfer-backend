// Ported from prestigevuntures/src/pages/ApprovalsPage.jsx's floatChannelLegs
// (used for the tx_requests void/edit reversal path) — extended to also
// serve TellerFloatTransfer.jsx's and SuperTellerAmin.jsx's create-time
// leg logic, which turned out to be the exact same "debit source, credit
// dest" shape at sign=+1.
//
// Bug fixed while porting: the original floatChannelLegs built a leg for
// BOTH source_account and dest_account unconditionally, but create-time
// code stores the literal string 'External' in whichever column has no
// real account (SuperTellerAmin.jsx: every single transaction has one
// side External; TellerFloatTransfer.jsx: an externalDeposit tab's
// deposits do). update_account_balance RAISEs 'Account "External" not
// found' for any branch — so voiding or editing a real Amin-channel
// tx_requests row through ApprovalsPage.jsx would always fail with that
// exact error. Skipping the 'External' side here (matching what
// create-time code already does) fixes it.
// rate: RWF-per-unit for row.currency, only needed (and only looked up by
// the caller) when row.currency isn't RWF -- see this file's own header
// comment on why an FX leg needs this at all (p_delta is always 0 for it,
// amount_rwf is purely reporting). A reversal/edit doesn't have the
// original creation-time rate on hand (float_channel_transactions has no
// rate column), so it re-quotes a live one via getQuoteToRwfRate the same
// way create-time now does -- close enough for a reporting figure, and
// certainly better than the 0 every one of these rows carried before.
function floatChannelLegs(row, sign, desc, rate = 0) {
  const isFx = row.currency !== 'RWF';
  const numAmt = Number(row.amount) || 0;
  const feeAmt = Number(row.fee_amount) || 0;
  const category = ['amin', 'super-teller-amin', 'super-teller-simon'].includes(row.channel) ? 'custodial_float_liability' : 'agent_channel_settlement';
  const rwfOverride = isFx && rate > 0 ? numAmt * rate : null;
  const feeRwfOverride = isFx && rate > 0 ? feeAmt * rate : null;
  const legs = [];
  if (row.source_account && row.source_account !== 'External') {
    legs.push({
      name: row.source_account, branch_id: row.branch_id,
      delta: isFx ? 0 : -sign * numAmt,
      amount_foreign: isFx ? -sign * numAmt : null, currency: isFx ? row.currency : null,
      description: desc, statement_category: category,
      ...(rwfOverride != null ? { amount_rwf_override: rwfOverride } : {}),
    });
  }
  if (row.dest_account && row.dest_account !== 'External') {
    legs.push({
      name: row.dest_account, branch_id: row.branch_id,
      delta: isFx ? 0 : sign * numAmt,
      amount_foreign: isFx ? sign * numAmt : null, currency: isFx ? row.currency : null,
      description: desc, statement_category: category,
      ...(rwfOverride != null ? { amount_rwf_override: rwfOverride } : {}),
    });
  }
  // Real transfer charge (see 20260901130000_float_channel_send_fee.sql) —
  // same source_account as the main leg, same "only if it's real" guard;
  // a 'deposit' row has fee_amount=0 by construction (SuperTellerAmin.jsx
  // only shows the fee field on Send), so this naturally never fires for one.
  if (feeAmt > 0 && row.source_account && row.source_account !== 'External') {
    legs.push({
      name: row.source_account, branch_id: row.branch_id,
      delta: isFx ? 0 : -sign * feeAmt,
      amount_foreign: isFx ? -sign * feeAmt : null, currency: isFx ? row.currency : null,
      description: desc + ' [transfer fee]', statement_category: category,
      ...(feeRwfOverride != null ? { amount_rwf_override: feeRwfOverride } : {}),
    });
  }
  return legs;
}

module.exports = { floatChannelLegs };
