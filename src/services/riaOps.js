// Ported from prestigevuntures/src/pages/ApprovalsPage.jsx's riaLegs — Ria
// (Nyamirambo only) is always a plain 2-leg RWF movement between the till
// (Cash(RWF)) and the fixed Ria settlement account, mirrors
// TellerRia.jsx's handleSubmit. Unlike float_channel_transactions, both
// accounts are always real (no 'External' sentinel), so no equivalent bug
// exists here.
const RIA_ACCOUNT = 'Equity Bank (RIA,MG,WU)';
const CASH_RWF = 'Cash(RWF)';

function riaLegs(row, sign, desc) {
  const tillSign = (row.type === 'receive' ? -1 : 1) * sign;
  const settleSign = -tillSign;
  const paidRwf = Number(row.amount_paid || 0);
  return [
    { name: RIA_ACCOUNT, branch_id: row.branch_id, delta: settleSign * paidRwf, amount_foreign: null, currency: null, description: desc, statement_category: 'remittance_settlement' },
    { name: CASH_RWF, branch_id: row.branch_id, delta: tillSign * paidRwf, amount_foreign: null, currency: null, description: desc, statement_category: 'remittance_settlement' },
  ];
}

module.exports = { riaLegs, RIA_ACCOUNT, CASH_RWF };
