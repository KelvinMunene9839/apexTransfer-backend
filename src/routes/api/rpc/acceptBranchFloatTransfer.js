const { Router } = require('express');
const { requireUser } = require('../../../middleware/auth');
const { validateBody } = require('../../../middleware/validate');
const { asyncWrapper } = require('../../../utils/asyncWrapper');
const { ApiError } = require('../../../utils/ApiError');
const { callRpcAsService, serviceClient } = require('../../../services/rpc');
const { canModifyBranchBalance } = require('../../../services/balanceAuth');

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function validateParams(body) {
  if (!isUuid(body?.p_tx_id)) return 'p_tx_id must be a uuid';
  if (typeof body?.p_from_account !== 'string' || !body.p_from_account) return 'p_from_account is required';
  if (!isUuid(body?.p_from_branch_id)) return 'p_from_branch_id must be a uuid';
  if (typeof body?.p_to_account !== 'string' || !body.p_to_account) return 'p_to_account is required';
  if (!isUuid(body?.p_to_branch_id)) return 'p_to_branch_id must be a uuid';
  if (typeof body?.p_ccy !== 'string' || !body.p_ccy) return 'p_ccy is required';
  if (!isNum(body?.p_amount)) return 'p_amount must be a number';
  for (const key of ['p_fee_amount', 'p_sender_wac_rate']) {
    if (body[key] != null && !isNum(body[key])) return `${key} must be a number`;
  }
  for (const key of ['p_desc_out', 'p_desc_in', 'p_desc_fee']) {
    if (body[key] != null && typeof body[key] !== 'string') return `${key} must be a string`;
  }
  return true;
}

// Already had its own authorization check (caller must match
// p_to_branch_id or hold a cross-branch role) — same rule as
// canModifyBranchBalance. p_completed_by set from the verified caller.
router.post('/', requireUser, validateBody(validateParams), asyncWrapper(async (req, res) => {
  if (!canModifyBranchBalance(req.user, req.body.p_to_branch_id)) {
    throw new ApiError(403, 'Not authorized to accept this branch float transfer');
  }

  // Sender's cost basis, computed here server-side from a trusted read of
  // wac_inventory — not trusted from the client (BranchApprovalsPage.jsx/
  // TellerBranchTransfer.jsx used to look this up themselves and pass it in
  // p_sender_wac_rate, with a query that didn't even filter by cost_currency
  // and silently swallowed the resulting "more than one row" error whenever
  // the sender held that currency costed in more than one currency —
  // .maybeSingle() errors, only `data` was ever read, so the rate silently
  // came back 0). accept_branch_float_transfer always prices this in RWF
  // (branchFloatSettlement.js's own reader: `amount * wacRate` = RWF value),
  // so unlike the inter-branch trade case there is only ever one target
  // currency to convert into, never a per-trade quote currency.
  let senderWacRate = 0;
  if (req.body.p_ccy && req.body.p_ccy !== 'RWF') {
    const { data: lots, error: wacError } = await serviceClient
      .from('wac_inventory')
      .select('wac_rate, cost_currency, quantity')
      .eq('branch_id', req.body.p_from_branch_id)
      .eq('currency', req.body.p_ccy);
    if (wacError) throw new ApiError(400, wacError.message);

    const exact = (lots || []).find((l) => l.cost_currency === 'RWF' && Number(l.quantity) > 0);
    if (exact) {
      senderWacRate = Number(exact.wac_rate);
    } else {
      // No RWF-costed lot with stock -- confirmed live (BFT-AJS970,
      // Kisementi -> Super Teller, 269,174 KES) that this is a real,
      // legitimate case, not just a data gap: a branch can hold real,
      // transferable currency that never went through wac_inventory's own
      // purchase tracking at all (capital injected directly via an admin
      // balance adjustment, or the branch's own trading stock having been
      // fully sold down while custodial/capital-sourced units of the same
      // currency remain in the till). Prefer the pair's own defined rate
      // (an actual rate this business trades this exact pair at) over
      // synthesizing one from a different lot's cost_currency -- same
      // priority order and reasoning as approveInterBranchTxn.js's own
      // wac-rate lookup.
      const { data: pairRow } = await serviceClient
        .from('currency_pairs').select('id, mid_rate')
        .eq('base_currency', req.body.p_ccy).eq('quote_currency', 'RWF').maybeSingle();
      if (pairRow?.id) {
        const { data: rateRow } = await serviceClient
          .from('exchange_rates').select('buy')
          .eq('pair_id', pairRow.id).eq('active', true)
          .order('effective_from', { ascending: false }).limit(1).maybeSingle();
        if (Number(rateRow?.buy) > 0) senderWacRate = Number(rateRow.buy);
      }
      if (senderWacRate <= 0 && Number(pairRow?.mid_rate) > 0) senderWacRate = Number(pairRow.mid_rate);

      // Last resort: no defined rate for this pair either -- fall back to
      // whichever lot the branch actually holds stock in, converted via
      // that lot's own cost_currency's live RWF rate.
      if (senderWacRate <= 0) {
        const holding = (lots || [])
          .filter((l) => Number(l.quantity) > 0)
          .sort((a, b) => Number(b.quantity) - Number(a.quantity))[0];
        if (holding) {
          const { data: pairs, error: pairsError } = await serviceClient
            .from('currency_pairs').select('base_currency, mid_rate').eq('quote_currency', 'RWF');
          if (pairsError) throw new ApiError(400, pairsError.message);
          const costToRwf = holding.cost_currency === 'RWF'
            ? 1
            : Number((pairs || []).find((p) => p.base_currency === holding.cost_currency)?.mid_rate || 0);
          if (costToRwf > 0) senderWacRate = Number(holding.wac_rate) * costToRwf;
        }
      }
    }

    if (senderWacRate <= 0) {
      throw new ApiError(400, `No recorded ${req.body.p_ccy} cost basis found for the sending branch — check its wac_inventory before accepting this transfer.`);
    }
  }

  const { error } = await callRpcAsService('accept_branch_float_transfer', {
    p_tx_id: req.body.p_tx_id,
    p_from_account: req.body.p_from_account,
    p_from_branch_id: req.body.p_from_branch_id,
    p_to_account: req.body.p_to_account,
    p_to_branch_id: req.body.p_to_branch_id,
    p_ccy: req.body.p_ccy,
    p_amount: req.body.p_amount,
    p_fee_amount: req.body.p_fee_amount ?? 0,
    p_sender_wac_rate: senderWacRate,
    p_desc_out: req.body.p_desc_out ?? '',
    p_desc_in: req.body.p_desc_in ?? '',
    p_desc_fee: req.body.p_desc_fee ?? '',
    p_completed_by: req.user.id,
  });
  if (error) throw new ApiError(400, error.message);

  res.json({ ok: true });
}));

module.exports = router;
