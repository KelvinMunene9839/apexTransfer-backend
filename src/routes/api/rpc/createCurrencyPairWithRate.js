const { Router } = require('express');
const { requireUser } = require('../../../middleware/auth');
const { validateBody } = require('../../../middleware/validate');
const { asyncWrapper } = require('../../../utils/asyncWrapper');
const { ApiError } = require('../../../utils/ApiError');
const { callRpcAsService } = require('../../../services/rpc');
const { isAdmin } = require('../../../services/balanceAuth');

const router = Router();

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function validateParams(body) {
  if (typeof body?.pair_code !== 'string' || !body.pair_code) return 'pair_code is required';
  if (typeof body?.base_code !== 'string' || !body.base_code) return 'base_code is required';
  if (typeof body?.quote_code !== 'string' || !body.quote_code) return 'quote_code is required';
  // Matches exchangeRates.js's own publish validation for an existing pair
  // — a new pair created at 0 would silently block every trade on it from
  // the moment it exists (see TransactionForm.jsx's own rate > 0 gate). The
  // frontend's AddPairModal already requires this too; this closes the gap
  // for any other caller of this admin-only route.
  if (!isNum(body?.buy_rate) || body.buy_rate <= 0) return 'buy_rate must be a positive number';
  if (!isNum(body?.sell_rate) || body.sell_rate <= 0) return 'sell_rate must be a positive number';
  return true;
}

// currency_pairs/exchange_rates are admin-only via their own RLS
// (pairs_admin_all, rates_admin), but this SECURITY DEFINER function
// bypassed that entirely with no check of its own — any authenticated
// user could create pairs/rates system-wide. Node supplies the missing
// check (isAdmin, matching the table's own RLS). p_created_by set from
// the verified caller — auth.uid() would resolve to NULL under
// service_role (see 20260817052732_create_currency_pair_with_rate_explicit_created_by.sql).
router.post('/', requireUser, validateBody(validateParams), asyncWrapper(async (req, res) => {
  if (!isAdmin(req.user)) {
    throw new ApiError(403, 'Only admin can create a currency pair');
  }

  const { data, error } = await callRpcAsService('create_currency_pair_with_rate', {
    pair_code: req.body.pair_code,
    base_code: req.body.base_code,
    quote_code: req.body.quote_code,
    buy_rate: req.body.buy_rate,
    sell_rate: req.body.sell_rate,
    p_created_by: req.user.id,
  });
  if (error) throw new ApiError(400, error.message);

  res.json(data);
}));

module.exports = router;
