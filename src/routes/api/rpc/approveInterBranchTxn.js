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
  if (typeof body?.p_type !== 'string' || !body.p_type) return 'p_type is required';
  if (!isUuid(body?.p_from_branch_id)) return 'p_from_branch_id must be a uuid';
  if (!isUuid(body?.p_to_branch_id)) return 'p_to_branch_id must be a uuid';
  if (typeof body?.p_ccy !== 'string' || !body.p_ccy) return 'p_ccy is required';
  if (typeof body?.p_fx_acct_to !== 'string' || !body.p_fx_acct_to) return 'p_fx_acct_to is required';
  if (body.p_pay_account_fx != null && typeof body.p_pay_account_fx !== 'string') return 'p_pay_account_fx must be a string';
  for (const key of ['p_pay_rwf', 'p_pay_fx', 'p_pay_fx_rwf', 'p_rwf_equiv', 'p_fx_units', 'p_fee_foreign', 'p_fee_rwf', 'p_rate', 'p_amount_paid', 'p_wac_cost_rate']) {
    if (body[key] != null && !isNum(body[key])) return `${key} must be a number`;
  }
  if (body.p_description != null && typeof body.p_description !== 'string') return 'p_description must be a string';
  if (body.p_quote_currency != null && typeof body.p_quote_currency !== 'string') return 'p_quote_currency must be a string';
  if (body.p_quote_account != null && typeof body.p_quote_account !== 'string') return 'p_quote_account must be a string';
  return true;
}

// Already had its own authorization check in the DB (caller must match
// p_to_branch_id or hold a cross-branch role) — same rule as
// canModifyBranchBalance, so it's reused directly rather than
// reimplemented. p_reviewed_by is set from the verified caller, not
// trusted from the request body — approving as someone else isn't
// something the client should be able to ask for.
router.post('/', requireUser, validateBody(validateParams), asyncWrapper(async (req, res) => {
  if (!canModifyBranchBalance(req.user, req.body.p_to_branch_id)) {
    throw new ApiError(403, 'Not authorized to settle this inter-branch transaction');
  }

  const quoteCurrency = req.body.p_quote_currency ?? 'RWF';

  // Cost basis is whichever branch's own stock the settlement actually
  // disposes of — SELL disposes to_branch's stock, BUY disposes
  // from_branch's (src/lib/profit.js ibtProfit's own comment). Computed
  // here, server-side, from a trusted read of wac_inventory — not trusted
  // from the client (BranchApprovalsPage.jsx used to look this up itself
  // and pass it in p_wac_cost_rate; a client that raced ahead of its own
  // wac_inventory fetch, or simply never had the field populated, could
  // silently submit 0, permanently leaving a settled trade with no
  // recorded cost basis and zero recognized profit for its initiator).
  const disposingBranchId = req.body.p_type === 'sell' ? req.body.p_to_branch_id : req.body.p_from_branch_id;
  let wacCostRate = 0;
  if (req.body.p_ccy) {
    // A branch can hold the same FX costed in more than one currency (e.g.
    // TZS paid for in KES on one purchase, in RWF on another) — prefer the
    // lot costed in this trade's own quote currency (no conversion needed,
    // most precise), but a real disposal never gets to silently fall back
    // to 0 just because THIS trade happens to be quoted in a currency that
    // lot isn't costed in (confirmed live: IBT-96CFF3DC-26 disposed real
    // TZS a branch held only in a KES-costed lot, against an RWF-quoted
    // trade — the exact-only lookup here used to return 0 for it).
    const { data: lots, error: wacError } = await serviceClient
      .from('wac_inventory')
      .select('wac_rate, cost_currency, quantity')
      .eq('branch_id', disposingBranchId)
      .eq('currency', req.body.p_ccy);
    if (wacError) throw new ApiError(400, wacError.message);

    const exact = (lots || []).find((l) => l.cost_currency === quoteCurrency && Number(l.quantity) > 0);
    if (exact) {
      wacCostRate = Number(exact.wac_rate);
    } else {
      // No lot costed in this trade's own quote currency — Super Teller
      // trades plenty of pairs where neither side is RWF (TZS/ZMW,
      // TZS/KES, ...), and currency_pairs.mid_rate is null for every one
      // of them (confirmed live). Synthesizing a cross-rate by routing
      // through each currency's own RWF reference rate looked plausible
      // but was actually WORSE than doing nothing: those RWF reference
      // rates are stale/unmaintained for exotic pairs relative to what the
      // business actually trades at, and produced an implied loss on real
      // trades that were profitable at the pair's own defined rate (a
      // TZS/ZMW trade priced at the pair's real sell rate, 0.0076, matched
      // its own amount_paid almost exactly; RWF-mediated synthesis implied
      // a ~1,000 ZMW loss on the same trade). Prefer the pair's own
      // defined buy rate (exchange_rates, keyed off currency_pairs) —
      // an actual rate this business trades this exact pair at — over any
      // synthesized cross-rate.
      const { data: pairRow } = await serviceClient
        .from('currency_pairs').select('id')
        .eq('base_currency', req.body.p_ccy).eq('quote_currency', quoteCurrency).maybeSingle();
      if (pairRow) {
        const { data: rateRow } = await serviceClient
          .from('exchange_rates').select('buy')
          .eq('pair_id', pairRow.id).eq('active', true)
          .order('effective_from', { ascending: false }).limit(1).maybeSingle();
        if (Number(rateRow?.buy) > 0) wacCostRate = Number(rateRow.buy);
      }

      // Last resort: no defined rate for this exact pair either — fall
      // back to whichever lot the branch actually holds stock in,
      // converted to quoteCurrency via each side's own live RWF rate.
      if (wacCostRate <= 0) {
        const holding = (lots || [])
          .filter((l) => Number(l.quantity) > 0)
          .sort((a, b) => Number(b.quantity) - Number(a.quantity))[0];
        if (holding) {
          const { data: pairs, error: pairsError } = await serviceClient
            .from('currency_pairs').select('base_currency, mid_rate').eq('quote_currency', 'RWF');
          if (pairsError) throw new ApiError(400, pairsError.message);
          const rwfRate = {};
          for (const p of pairs || []) rwfRate[p.base_currency] = Number(p.mid_rate || 0);
          const costToRwf  = holding.cost_currency === 'RWF' ? 1 : (rwfRate[holding.cost_currency] || 0);
          const quoteToRwf = quoteCurrency === 'RWF' ? 1 : (rwfRate[quoteCurrency] || 0);
          if (costToRwf > 0 && quoteToRwf > 0) wacCostRate = Number(holding.wac_rate) * (costToRwf / quoteToRwf);
        }
      }
    }

    // A SELL disposes real stock the branch is physically holding right
    // now (update_account_balance's own balance check already guarantees
    // that, or this trade could never settle) — there is no legitimate way
    // for its cost basis to be genuinely absent, only currency-mismatched
    // (handled above) or a real data gap. A BUY's disposing branch is a
    // different case: wac_cost_rate there is only a pre-purchase
    // comparison figure (BranchApprovalsPage.jsx's own comment), and a
    // branch legitimately has no prior average cost the very first time it
    // ever acquires a currency — 0 stays valid for buys.
    if (req.body.p_type === 'sell' && wacCostRate <= 0) {
      throw new ApiError(400, `No recorded ${req.body.p_ccy} cost basis found for the disposing branch — check its wac_inventory before approving this trade.`);
    }
  }

  // Same not-trusted-from-the-client fix as wacCostRate above, for the
  // exact same reason: BranchApprovalsPage.jsx computes p_fee_rwf as
  // feeForeign * rate (the trade's customer-facing rate_applied), but the
  // fee is deducted from the disposing branch's own WAC-tracked stock —
  // the same stock wacCostRate above already prices correctly. A
  // rate_applied-valued fee overstated the disposing branch's own
  // ibtFeeExpense (FinancialStatementsPage.jsx's computeNetEarnings reads
  // inter_branch_txns.fee_rwf straight off this row) by (rate_applied -
  // wacCostRate) * fee, with nothing on the Assets side to match — the
  // same mechanism as the regular-transaction fee bug, just for the
  // disposing side of an inter-branch trade instead of a customer sell.
  const feeForeign = req.body.p_fee_foreign ?? 0;
  const feeRwf = req.body.p_type === 'sell' && wacCostRate > 0 && feeForeign > 0
    ? feeForeign * wacCostRate
    : (req.body.p_fee_rwf ?? 0);

  const params = {
    p_tx_id: req.body.p_tx_id,
    p_type: req.body.p_type,
    p_from_branch_id: req.body.p_from_branch_id,
    p_to_branch_id: req.body.p_to_branch_id,
    p_ccy: req.body.p_ccy,
    p_fx_acct_to: req.body.p_fx_acct_to,
    p_pay_account_fx: req.body.p_pay_account_fx ?? null,
    p_pay_rwf: req.body.p_pay_rwf ?? 0,
    p_pay_fx: req.body.p_pay_fx ?? 0,
    p_pay_fx_rwf: req.body.p_pay_fx_rwf ?? 0,
    p_rwf_equiv: req.body.p_rwf_equiv ?? 0,
    p_fx_units: req.body.p_fx_units ?? 0,
    p_fee_foreign: feeForeign,
    p_fee_rwf: feeRwf,
    p_rate: req.body.p_rate ?? 0,
    p_description: req.body.p_description ?? '',
    p_amount_paid: req.body.p_amount_paid ?? 0,
    p_reviewed_by: req.user.id,
    p_wac_cost_rate: wacCostRate,
    p_quote_currency: quoteCurrency,
    // Only default to Cash(RWF) for a genuinely RWF-quoted trade — for a
    // cross-currency quote with no account supplied, update_account_balance
    // raises a clear "account not found" error instead of silently posting
    // that leg's real FX currency onto an account literally named
    // "Cash(RWF)" (see 20260720000001_fx_only_accounts_no_rwf_pollution.sql).
    p_quote_account: req.body.p_quote_account ?? (quoteCurrency === 'RWF' ? 'Cash(RWF)' : null),
  };

  const { error } = await callRpcAsService('approve_inter_branch_txn', params);
  if (error) throw new ApiError(400, error.message);

  res.json({ ok: true });
}));

module.exports = router;
