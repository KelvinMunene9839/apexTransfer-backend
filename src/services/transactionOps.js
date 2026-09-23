// Server-side ports of prestigevuntures/src/lib/deferredTx.js and
// src/lib/pendingApprovalLegs.js (same rules, applied to raw DB rows —
// snake_case — instead of the frontend's mapped camelCase tx shape), plus
// a new buildCreateLegs() that generalizes TellerNewTx.jsx's and
// SuperTellerNewTx.jsx's near-identical post-insert leg logic into one
// function (SuperTellerNewTx's quote/base framing is a strict superset of
// TellerNewTx's plain-RWF framing — they're the same math with
// quote_currency defaulting to 'RWF').
const { serviceClient } = require('./rpc');
const { updateAccountBalance, upsertWacInventory, reduceWacInventoryAcrossLots } = require('./balanceOps');

function deferredTxLegs(type, paymentStatus) {
  if (paymentStatus === 'pending_approval') return { fx: false, rwf: false };
  const isDeferred = paymentStatus === 'awaiting_payment' || paymentStatus === 'customer_not_yet_paid';
  if (!isDeferred) return { fx: true, rwf: true };
  const fx = (type === 'buy' && paymentStatus === 'customer_not_yet_paid') ||
             (type === 'sell' && paymentStatus === 'awaiting_payment');
  return { fx, rwf: false };
}

async function getPairBase(pairId) {
  if (!pairId) return null;
  const { data } = await serviceClient.from('currency_pairs').select('base_currency').eq('id', pairId).maybeSingle();
  return data?.base_currency ?? null;
}

// tx: raw transactions row. pairBase: currency_pairs.base_currency for
// tx.pair_id. rate defaults to the row's own rate_applied but callers
// approving a special-rate request should pass the (possibly re-confirmed)
// requested rate explicitly — amount_paid never changes here, only what
// the FX/fee legs' RWF-equivalent bookkeeping is computed from.
async function buildApprovalLegs(tx, pairBase, rate = Number(tx.rate_applied) || 0) {
  const legs = [];
  const wacOps = [];
  const quoteCurrency = tx.quote_currency || 'RWF';
  const isRwfQuote = quoteCurrency === 'RWF';
  const amount = Number(tx.amount_foreign) || 0;
  const amountPaid = Number(tx.amount_paid) || 0;
  const desc = `${tx.type === 'buy' ? 'BUY' : 'SELL'} ${amount} ${pairBase || ''} @ ${rate} — ${tx.reference} [approved]`;
  // Only looked up when actually needed (a cross-currency trade whose
  // quote leg needs a real amount_rwf) -- see getQuoteToRwfRate's own
  // comment for why this exists and its fallback order.
  const quoteToRwfRate = isRwfQuote ? 1 : await getQuoteToRwfRate(tx.branch_id, quoteCurrency);

  function quoteLeg(account, amountQuote, legDesc) {
    return isRwfQuote
      ? { name: account, branch_id: tx.branch_id, transaction_id: tx.id, delta: amountQuote, description: legDesc, amount_foreign: null, currency: null, statement_category: 'customer_transaction' }
      : { name: account, branch_id: tx.branch_id, transaction_id: tx.id, delta: 0, description: legDesc, amount_foreign: amountQuote, currency: quoteCurrency, statement_category: 'customer_transaction', amount_rwf_override: Math.abs(amountQuote) * quoteToRwfRate };
  }
  function baseLeg(account, amountBase, legDesc) {
    return { name: account, branch_id: tx.branch_id, transaction_id: tx.id, delta: amountBase * rate, description: legDesc, amount_foreign: amountBase, currency: pairBase, statement_category: 'customer_transaction' };
  }

  // A sell fee leg (below) charged in pairBase currency -- whether it's the
  // no-fee-account fallback (drawn from source_account) or a dedicated
  // fee_account that happens to also hold pairBase currency -- debits the
  // SAME branch+currency pool the WAC reduce here already reduces (WAC is
  // tracked per branch+currency, not per account). Fold it into the reduce
  // quantity up front, or wac_inventory silently drifts above the real held
  // quantity by the fee amount on every such sell (see the matching fix in
  // approve_inter_branch_txn/accept_branch_float_transfer).
  const feeDepletesPairBase = tx.type === 'sell' && (!tx.fee_account || tx.tx_fee_currency === pairBase);
  const noFeeAcctSellFee = feeDepletesPairBase ? Number(tx.tx_fee_foreign) || 0 : 0;

  if (tx.type === 'sell') {
    if (tx.source_account && amount > 0) legs.push(baseLeg(tx.source_account, -amount, `${desc} [FX out]`));
    if (tx.dest_account && amountPaid > 0) legs.push(quoteLeg(tx.dest_account, amountPaid, desc));
    if (pairBase && amount > 0) {
      wacOps.push(reduceWacInventoryAcrossLots(tx.branch_id, pairBase, amount + noFeeAcctSellFee, isRwfQuote ? 'RWF' : quoteCurrency));
    }
    // See buildCreateLegs' matching fix: the customer's cross-currency
    // payment above (quoteLeg) credits a real quote-currency balance that
    // never gets a WAC cost basis otherwise, understating that currency's
    // wac_inventory by every such sell (confirmed live: Super Teller's
    // UGX/ZMW, 13.5M and 13K RWF-equivalent respectively). Valued at its
    // RWF-equivalent, same as an opening-capital/float adjustment.
    if (!isRwfQuote && amountPaid > 0) {
      wacOps.push(upsertWacInventory({
        p_branch_id: tx.branch_id, p_currency: quoteCurrency,
        p_quantity: amountPaid, p_cost_rwf: amountPaid * quoteToRwfRate,
      }));
    }
  } else if (tx.type === 'buy') {
    if (tx.source_account && amountPaid > 0) legs.push(quoteLeg(tx.source_account, -amountPaid, desc));
    if (tx.dest_account && amount > 0) legs.push(baseLeg(tx.dest_account, amount, `${desc} [FX in]`));
    if (pairBase && amount > 0) {
      const p = { p_branch_id: tx.branch_id, p_currency: pairBase, p_quantity: amount, p_cost_rwf: amountPaid };
      if (!isRwfQuote) p.p_cost_currency = quoteCurrency;
      wacOps.push(upsertWacInventory(p));
    }
    // Mirror image: paying for this buy out of a foreign quote-currency
    // balance disposes real WAC-tracked stock — never reducing it here
    // would overstate that currency's wac_inventory by every such buy.
    if (!isRwfQuote && amountPaid > 0) {
      wacOps.push(reduceWacInventoryAcrossLots(tx.branch_id, quoteCurrency, amountPaid, 'RWF'));
    }
  }

  const feeForeign = Number(tx.tx_fee_foreign) || 0;
  if (feeForeign > 0) {
    if (tx.fee_account) {
      const isFeeRwf = tx.tx_fee_currency === 'RWF';
      const isFeeBase = !isFeeRwf && tx.tx_fee_currency === pairBase;
      // Neither RWF nor pairBase leaves only the quote currency in
      // practice (a fee_account fee is always charged in whatever
      // currency the customer actually paid in) -- same amount_rwf
      // reporting gap as the main quote leg above, same fix.
      const isFeeQuote = !isFeeRwf && !isFeeBase;
      legs.push({
        name: tx.fee_account, branch_id: tx.branch_id, transaction_id: tx.id,
        delta: isFeeRwf ? -feeForeign : isFeeBase ? -feeForeign * rate : 0,
        description: `Transaction fee ${feeForeign} ${tx.tx_fee_currency} — ${tx.reference}`,
        amount_foreign: isFeeRwf ? null : -feeForeign,
        currency: isFeeRwf ? null : tx.tx_fee_currency,
        statement_category: 'customer_transaction',
        ...(isFeeQuote ? { amount_rwf_override: feeForeign * (tx.tx_fee_currency === quoteCurrency ? quoteToRwfRate : 0) } : {}),
      });
    } else if (tx.type === 'sell' && tx.source_account) {
      legs.push({
        name: tx.source_account, branch_id: tx.branch_id, transaction_id: tx.id,
        delta: -(Number(tx.tx_fee_rwf) || 0), description: `Transaction fee ${feeForeign} ${pairBase || ''} — ${tx.reference}`,
        amount_foreign: pairBase ? -feeForeign : null, currency: pairBase || null,
        statement_category: 'customer_transaction',
      });
    }
  }

  return { legs, wacOps };
}

// input: { id, reference, type, branchId, amount, rate, quoteCurrency,
// pairBase, amountPaid, sourceAccount, destAccount, destAccountBase,
// paymentCurrency ('quote'|'base'|'split'), amountPaidBase, txFeeForeign,
// txFeeCurrency, txFeeRwf, feeAccount, legs: {fx, rwf} } — mirrors
// TellerNewTx.jsx/SuperTellerNewTx.jsx's postOps construction exactly,
// including the legacy-vs-new-style fee split documented in
// buildApprovalLegs above (no feeAccount → sell-only, gated on legs.fx,
// drawn from sourceAccount; feeAccount present → gated on legs.rwf, drawn
// from feeAccount in whichever currency it holds).
async function buildCreateLegs(input) {
  const postOps = [];
  const isRwfQuote = !input.quoteCurrency || input.quoteCurrency === 'RWF';
  // Only looked up when actually needed (a cross-currency trade whose
  // quote leg needs a real amount_rwf) -- see getQuoteToRwfRate's own
  // comment for why this exists and its fallback order.
  const quoteToRwfRate = isRwfQuote ? 1 : await getQuoteToRwfRate(input.branchId, input.quoteCurrency);

  function updateBalance({ account, delta, amountForeign, currency, desc, amountRwfOverride }) {
    return updateAccountBalance({
      p_name: account, p_branch_id: input.branchId, p_delta: delta,
      p_transaction_id: input.id, p_description: desc,
      p_amount_foreign: amountForeign ?? null, p_currency: currency ?? null,
      p_source_type: 'float', p_statement_category: 'customer_transaction',
      p_amount_rwf_override: amountRwfOverride ?? null,
    });
  }
  function postQuoteLeg(account, amountQuote, desc) {
    return isRwfQuote
      ? updateBalance({ account, delta: amountQuote, desc })
      : updateBalance({ account, delta: 0, amountForeign: amountQuote, currency: input.quoteCurrency, desc, amountRwfOverride: Math.abs(amountQuote) * quoteToRwfRate });
  }
  function postBaseLeg(account, amountBase, desc) {
    return updateBalance({ account, delta: amountBase * input.rate, amountForeign: amountBase, currency: input.pairBase, desc });
  }

  // A sell fee leg (below) charged in pairBase currency -- whether it's the
  // no-feeAccount fallback (drawn from sourceAccount) or a dedicated
  // feeAccount that happens to also hold pairBase currency -- debits the
  // SAME branch+currency pool the WAC reduce here already reduces. Fold it
  // in up front, or wac_inventory silently drifts (see buildApprovalLegs'
  // matching fix above).
  const feeDepletesPairBase = input.type === 'sell' && input.legs.fx && (!input.feeAccount || input.txFeeCurrency === input.pairBase);
  const noFeeAcctSellFee = feeDepletesPairBase ? Number(input.txFeeForeign) || 0 : 0;

  if (input.legs.fx && input.pairBase && input.branchId) {
    if (input.type === 'buy') {
      postOps.push(upsertWacInventory({
        p_branch_id: input.branchId, p_currency: input.pairBase,
        p_quantity: input.amount, p_cost_rwf: input.amountPaid || input.equivalentQuote,
        ...(isRwfQuote ? {} : { p_cost_currency: input.quoteCurrency }),
      }));
    } else if (input.type === 'sell') {
      postOps.push(reduceWacInventoryAcrossLots(input.branchId, input.pairBase, input.amount + noFeeAcctSellFee, isRwfQuote ? 'RWF' : input.quoteCurrency));
    }
  }

  if (input.branchId && (input.legs.fx || input.legs.rwf)) {
    if (input.type === 'sell') {
      const payCurrency = input.paymentCurrency || 'quote';
      const paidBaseAmount = Number(input.amountPaidBase || 0);
      const paidQuoteAmount = Number(input.amountPaid || 0) - (payCurrency === 'split' ? paidBaseAmount * input.rate : 0);
      const desc = `SELL ${input.amount} ${input.pairBase} @ ${input.rate} — ${input.reference}`;

      if (input.legs.rwf) {
        if (payCurrency === 'quote' && input.destAccount && input.amountPaid > 0) {
          postOps.push(postQuoteLeg(input.destAccount, input.amountPaid, desc));
        } else if (payCurrency === 'base' && input.destAccountBase) {
          postOps.push(postBaseLeg(input.destAccountBase, paidBaseAmount, `${desc} [paid in ${input.pairBase}]`));
        } else if (payCurrency === 'split') {
          if (paidBaseAmount > 0 && input.destAccountBase) {
            postOps.push(postBaseLeg(input.destAccountBase, paidBaseAmount, `${desc} [${input.pairBase} portion]`));
          }
          if (paidQuoteAmount > 0 && input.destAccount) {
            postOps.push(postQuoteLeg(input.destAccount, paidQuoteAmount, `${desc} [${input.quoteCurrency} portion]`));
          }
        }
      }
      if (input.legs.fx && input.sourceAccount && input.amount > 0) {
        postOps.push(postBaseLeg(input.sourceAccount, -input.amount, `${desc} [FX out]`));
      }
      // A cross-currency sell's customer payment (postQuoteLeg above) really
      // credits the quote currency into destAccount — a real new balance the
      // WAC side of this trade never touched (only pairBase, disposed above,
      // did). Never establishing a cost basis for it left wac_inventory
      // silently understating that currency by the full amount every such
      // sell ever received, confirmed live on Super Teller: UGX WAC-tracked
      // at 666,732 against an actual till balance of 14,161,782 — a
      // 13,495,050 gap that traced exactly to "customer_transaction in UGX"
      // account_movements with no matching wac_inventory credit anywhere.
      // Valued the same way an opening-capital/float adjustment establishes
      // a fresh lot: at its RWF-equivalent (quoteToRwfRate), cost_currency
      // RWF, since it was received as sale proceeds, not itself purchased.
      if (!isRwfQuote && input.legs.rwf) {
        const quoteReceived = payCurrency === 'quote' ? Number(input.amountPaid || 0)
          : payCurrency === 'split' ? paidQuoteAmount : 0;
        if (quoteReceived > 0) {
          postOps.push(upsertWacInventory({
            p_branch_id: input.branchId, p_currency: input.quoteCurrency,
            p_quantity: quoteReceived, p_cost_rwf: quoteReceived * quoteToRwfRate,
          }));
        }
      }
    } else if (input.type === 'buy' && input.amount > 0) {
      const desc = `BUY ${input.amount} ${input.pairBase} @ ${input.rate} — ${input.reference}`;
      if (input.legs.rwf && input.sourceAccount && input.amountPaid > 0) {
        postOps.push(postQuoteLeg(input.sourceAccount, -input.amountPaid, desc));
        // Mirror image of the sell-side fix above: paying for this buy out
        // of a foreign quote-currency balance disposes real WAC-tracked
        // stock (when that currency was itself acquired as sale proceeds,
        // per the fix above, or bought outright) — never reducing it here
        // would overstate that currency's wac_inventory by every such buy.
        if (!isRwfQuote) {
          postOps.push(reduceWacInventoryAcrossLots(input.branchId, input.quoteCurrency, Number(input.amountPaid), 'RWF'));
        }
      }
      if (input.legs.fx && input.destAccount) {
        postOps.push(postBaseLeg(input.destAccount, input.amount, `${desc} [FX in]`));
      }
    }

    if (input.txFeeForeign > 0) {
      if (input.feeAccount) {
        if (input.legs.rwf) {
          const feeDesc = `Transaction fee ${input.txFeeForeign} ${input.txFeeCurrency} — ${input.reference}`;
          postOps.push(
            input.txFeeCurrency === input.pairBase
              ? postBaseLeg(input.feeAccount, -input.txFeeForeign, feeDesc)
              : postQuoteLeg(input.feeAccount, -input.txFeeForeign, feeDesc)
          );
        }
      } else if (input.type === 'sell' && input.legs.fx && input.sourceAccount) {
        postOps.push(updateBalance({
          account: input.sourceAccount, delta: -(input.txFeeRwf || 0),
          amountForeign: -input.txFeeForeign, currency: input.pairBase,
          desc: `Transaction fee ${input.txFeeForeign} ${input.pairBase || ''} — ${input.reference}`,
        }));
      }
    }
  }

  return postOps;
}

// Rate to use for a pair-change edit with no rate explicitly given — the
// average of the pair's latest active buy/sell exchange_rates row, falling
// back to whichever side exists, then to currency_pairs.mid_rate. Mirrors
// ApprovalsPage.jsx's `pairMap.get(...)` lookup (liveData.js's snapshot of
// the same "latest rate per pair" data), just queried fresh here instead
// of read from an already-loaded client-side cache.
async function getLatestPairRate(pairId) {
  if (!pairId) return 0;
  const [{ data: rateRow }, { data: pairRow }] = await Promise.all([
    serviceClient.from('exchange_rates').select('buy, sell').eq('pair_id', pairId).eq('active', true).order('effective_from', { ascending: false }).limit(1).maybeSingle(),
    serviceClient.from('currency_pairs').select('mid_rate').eq('id', pairId).maybeSingle(),
  ]);
  const buy = Number(rateRow?.buy) || 0;
  const sell = Number(rateRow?.sell) || 0;
  if (buy && sell) return (buy + sell) / 2;
  return buy || sell || Number(pairRow?.mid_rate) || 0;
}

// RWF-per-unit rate for a cross-currency (Super Teller) trade's quote-
// currency leg -- needed only so that leg's account_movements row can
// report a real amount_rwf instead of the 0 it gets by default (its
// p_delta is always 0 there on purpose: the account only holds
// quoteCurrency, never RWF, so there's nothing to actually credit/debit in
// RWF -- amount_rwf is purely a reporting figure, same
// p_amount_rwf_override mechanism accept_branch_float_transfer/
// approve_petit_cash_entry already use). Same fallback priority as
// approveInterBranchTxn.js's own wac-rate lookup: (1) this branch's own
// wac_inventory lot for quoteCurrency costed in RWF -- its real, precise
// cost basis; (2) the pair's own defined rate (currency_pairs id +
// exchange_rates.buy) -- an actual rate the business trades that exact
// pair at; (3) currency_pairs.mid_rate as a last resort. Returns 0 (never
// throws) if none of these exist yet -- this is a reporting nicety, not a
// balance-affecting operation, so a miss here should never block the trade
// itself the way a missing cost basis blocks a disposal elsewhere.
async function getQuoteToRwfRate(branchId, quoteCurrency) {
  if (!quoteCurrency || quoteCurrency === 'RWF') return 1;
  const { data: lot } = await serviceClient
    .from('wac_inventory').select('wac_rate')
    .eq('branch_id', branchId).eq('currency', quoteCurrency).eq('cost_currency', 'RWF')
    .maybeSingle();
  if (Number(lot?.wac_rate) > 0) return Number(lot.wac_rate);

  const { data: pairRow } = await serviceClient
    .from('currency_pairs').select('id, mid_rate')
    .eq('base_currency', quoteCurrency).eq('quote_currency', 'RWF').maybeSingle();
  if (pairRow?.id) {
    const { data: rateRow } = await serviceClient
      .from('exchange_rates').select('buy')
      .eq('pair_id', pairRow.id).eq('active', true)
      .order('effective_from', { ascending: false }).limit(1).maybeSingle();
    if (Number(rateRow?.buy) > 0) return Number(rateRow.buy);
  }
  return Number(pairRow?.mid_rate) || 0;
}

module.exports = { deferredTxLegs, buildApprovalLegs, buildCreateLegs, getPairBase, getLatestPairRate, getQuoteToRwfRate };
