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

// Publish — mirrors RatesPage.jsx's publish(): deactivate the pair's
// current active rate, then insert the new one. idx_rates_one_active_per_pair
// (a partial unique index on pair_id WHERE active=true) is what actually
// prevents two concurrent publishes for the same pair from both landing an
// active row — the deactivate isn't atomic with the insert, same as the
// original frontend code, just moved server-side. Mirrors rates_admin —
// admin only. created_by is forced server-side (the original frontend
// insert never set it at all).
function validateCreate(body) {
  if (!isUuid(body?.pair_id)) return 'pair_id must be a uuid';
  if (!isNum(body?.buy) || body.buy <= 0) return 'buy must be a positive number';
  if (!isNum(body?.sell) || body.sell <= 0) return 'sell must be a positive number';
  return true;
}

router.post('/', requireUser, validateBody(validateCreate), asyncWrapper(async (req, res) => {
  if (!isAdmin(req.user)) throw new ApiError(403, 'Not authorized to publish rates');

  const { pair_id, buy, sell } = req.body;

  const { error: deactivateErr } = await serviceClient
    .from('exchange_rates')
    .update({ active: false })
    .eq('pair_id', pair_id)
    .eq('active', true);
  if (deactivateErr) throw new ApiError(400, 'Failed to publish: ' + deactivateErr.message);

  const { data, error: insertErr } = await serviceClient
    .from('exchange_rates')
    .insert({ pair_id, buy, sell, created_by: req.user.id })
    .select()
    .single();
  if (insertErr) {
    throw new ApiError(400, insertErr.code === '23505'
      ? 'Another publish for this pair landed at the same moment — reload and try again.'
      : 'Failed to publish: ' + insertErr.message);
  }

  res.json(data);
}));

module.exports = router;
