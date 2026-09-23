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
const isStringArray = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string');

// All writes here mirror catalog_admin — admin only, full stop. No delete
// endpoint — AddCatalogModal's "remove" is deactivate (active: false),
// matching branches.js's own precedent.
function validateCreate(body) {
  if (typeof body?.name !== 'string' || !body.name.trim()) return 'name is required';
  if (body.currencies != null && !isStringArray(body.currencies)) return 'currencies must be an array of strings';
  return true;
}

router.post('/', requireUser, validateBody(validateCreate), asyncWrapper(async (req, res) => {
  if (!isAdmin(req.user)) throw new ApiError(403, 'Not authorized to create catalog entries');

  const { data, error } = await serviceClient
    .from('account_catalog')
    .insert({
      name: req.body.name.trim(),
      description: req.body.description?.trim() || null,
      currencies: req.body.currencies || [],
      active: true,
    })
    .select()
    .single();
  if (error) throw new ApiError(400, error.message);

  res.json(data);
}));

// Covers EditCatalogNameModal (name), EditCurrenciesModal (currencies),
// and the deactivate/restore toggle (active) — the patch only ever
// contains whichever field the caller actually sent.
function validateUpdate(body) {
  if (body?.name != null && (typeof body.name !== 'string' || !body.name.trim())) return 'name must be a non-empty string';
  if (body?.currencies != null && !isStringArray(body.currencies)) return 'currencies must be an array of strings';
  if (body?.active != null && typeof body.active !== 'boolean') return 'active must be a boolean';
  if (body?.name === undefined && body?.description === undefined && body?.currencies === undefined && body?.active === undefined) {
    return 'at least one field is required';
  }
  return true;
}

router.patch('/:id', requireUser, validateBody(validateUpdate), asyncWrapper(async (req, res) => {
  if (!isUuid(req.params.id)) throw new ApiError(400, 'id must be a uuid');
  if (!isAdmin(req.user)) throw new ApiError(403, 'Not authorized to edit catalog entries');

  const patch = {};
  if (req.body.name !== undefined) patch.name = req.body.name.trim();
  if (req.body.description !== undefined) patch.description = req.body.description?.trim() || null;
  if (req.body.currencies !== undefined) patch.currencies = req.body.currencies;
  if (req.body.active !== undefined) patch.active = req.body.active;

  const { error } = await serviceClient.from('account_catalog').update(patch).eq('id', req.params.id);
  if (error) throw new ApiError(400, error.message);

  res.json({ ok: true });
}));

module.exports = router;
