const { Router } = require('express');
const { requireUser } = require('../../../middleware/auth');
const { validateBody } = require('../../../middleware/validate');
const { asyncWrapper } = require('../../../utils/asyncWrapper');
const { ApiError } = require('../../../utils/ApiError');
const { serviceClient } = require('../../../services/rpc');
const { isAdmin } = require('../../../services/balanceAuth');

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// Admin-only — mirrors pairs_admin_all exactly. Pair creation already goes
// through the create_currency_pair_with_rate RPC (migrated in Phase 2);
// this covers RatesPage.jsx's remaining direct table writes — publishing
// threshold rates and toggling active — as one endpoint, the patch only
// ever containing whichever fields the caller actually sent. No delete
// endpoint: no call site removes a pair.
function validateUpdate(body) {
  for (const key of ['threshold_amount', 'threshold_buy', 'threshold_sell']) {
    if (body?.[key] !== undefined && body[key] !== null && !isNum(body[key])) return `${key} must be a number or null`;
  }
  if (body?.active != null && typeof body.active !== 'boolean') return 'active must be a boolean';
  if (body?.threshold_amount === undefined && body?.threshold_buy === undefined && body?.threshold_sell === undefined && body?.active === undefined) {
    return 'at least one field is required';
  }
  return true;
}

router.patch('/:id', requireUser, validateBody(validateUpdate), asyncWrapper(async (req, res) => {
  if (!isUuid(req.params.id)) throw new ApiError(400, 'id must be a uuid');
  if (!isAdmin(req.user)) throw new ApiError(403, 'Not authorized to edit currency pairs');

  const patch = {};
  if (req.body.threshold_amount !== undefined) patch.threshold_amount = req.body.threshold_amount;
  if (req.body.threshold_buy !== undefined) patch.threshold_buy = req.body.threshold_buy;
  if (req.body.threshold_sell !== undefined) patch.threshold_sell = req.body.threshold_sell;
  if (req.body.active !== undefined) patch.active = req.body.active;

  const { error } = await serviceClient.from('currency_pairs').update(patch).eq('id', req.params.id);
  if (error) throw new ApiError(400, error.message);

  res.json({ ok: true });
}));

module.exports = router;
