const { Router } = require('express');
const { requireUser } = require('../../../middleware/auth');
const { validateBody } = require('../../../middleware/validate');
const { asyncWrapper } = require('../../../utils/asyncWrapper');
const { ApiError } = require('../../../utils/ApiError');
const { serviceClient } = require('../../../services/rpc');
const { isAdmin } = require('../../../services/balanceAuth');

const router = Router();

// Create — mirrors currencies_admin_all, admin only. No edit/deactivate
// UI exists for this table (RatesPage.jsx's addCurrency is the only write
// call site), so this is the only endpoint it needs.
function validateCreate(body) {
  if (typeof body?.code !== 'string' || !body.code.trim()) return 'code is required';
  if (typeof body?.name !== 'string' || !body.name.trim()) return 'name is required';
  return true;
}

router.post('/', requireUser, validateBody(validateCreate), asyncWrapper(async (req, res) => {
  if (!isAdmin(req.user)) throw new ApiError(403, 'Not authorized to add currencies');

  const { data, error } = await serviceClient
    .from('currencies')
    .insert({
      code: req.body.code.trim().toUpperCase(),
      name: req.body.name.trim(),
      symbol: req.body.symbol?.trim() || null,
      active: true,
    })
    .select('id, code, name, symbol, active, created_at')
    .single();
  if (error) throw new ApiError(400, error.message);

  res.json(data);
}));

module.exports = router;
