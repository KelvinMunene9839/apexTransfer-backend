const { Router } = require('express');
const { requireUser } = require('../../../middleware/auth');
const { validateBody } = require('../../../middleware/validate');
const { asyncWrapper } = require('../../../utils/asyncWrapper');
const { ApiError } = require('../../../utils/ApiError');
const { serviceClient } = require('../../../services/rpc');
const { isAdminOrAccountant, isAdminAccountantOrSuperTeller } = require('../../../services/balanceAuth');

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);

// Create a branch payment account — mirrors pa_insert's RLS
// (admin/accountant/super_teller). balance_rwf/balance_fx are always
// zero here regardless of what's sent: a bare INSERT with a non-zero
// balance creates real Current Assets with no account_movements row
// behind it, invisible to Paid-in Capital and every financial statement.
// Any opening balance goes through POST /api/rpc/update-account-balance
// (source_type 'equity') separately, same as the frontend already did.
function validateCreate(body) {
  if (typeof body?.name !== 'string' || !body.name) return 'name is required';
  if (!isUuid(body?.branch_id)) return 'branch_id must be a uuid';
  if (!isUuid(body?.catalog_id)) return 'catalog_id must be a uuid';
  if (body.currencies != null && !Array.isArray(body.currencies)) return 'currencies must be an array';
  return true;
}

router.post('/', requireUser, validateBody(validateCreate), asyncWrapper(async (req, res) => {
  if (!isAdminAccountantOrSuperTeller(req.user)) {
    throw new ApiError(403, 'Not authorized to create payment accounts');
  }

  const { data, error } = await serviceClient
    .from('payment_accounts')
    .insert({
      name: req.body.name,
      branch_id: req.body.branch_id,
      catalog_id: req.body.catalog_id,
      currencies: req.body.currencies ?? [],
      balance_rwf: 0,
      balance_fx: {},
      active: true,
    })
    .select()
    .single();
  if (error) throw new ApiError(400, error.message);

  res.json(data);
}));

// Activate/deactivate — mirrors the table's own update policy
// (admin/accountant only, no super_teller exception here).
function validateActive(body) {
  if (typeof body?.active !== 'boolean') return 'active must be a boolean';
  return true;
}

router.patch('/:id/active', requireUser, validateBody(validateActive), asyncWrapper(async (req, res) => {
  if (!isUuid(req.params.id)) throw new ApiError(400, 'id must be a uuid');
  if (!isAdminOrAccountant(req.user)) {
    throw new ApiError(403, 'Not authorized to change account status');
  }

  // Deactivating (not deleting) an account with a real balance would still
  // leave that money in balance_rwf/balance_fx, but every Balance Sheet
  // computation (currentAssetsByBranch and its equivalents) filters to
  // active accounts only -- the real money doesn't move, it just silently
  // stops being counted as a Current Asset, the exact Assets-vs-
  // Liabilities+Equity imbalance this whole audit exists to prevent.
  if (req.body.active === false) {
    const { data: acct, error: fetchErr } = await serviceClient
      .from('payment_accounts').select('balance_rwf, balance_fx').eq('id', req.params.id).maybeSingle();
    if (fetchErr) throw new ApiError(400, fetchErr.message);
    if (!acct) throw new ApiError(404, 'Account not found');
    const hasFxBalance = Object.values(acct.balance_fx || {}).some((v) => Number(v) !== 0);
    if (Number(acct.balance_rwf) !== 0 || hasFxBalance) {
      throw new ApiError(409, 'Cannot deactivate — this account still holds a real balance. Move or adjust it to zero first.');
    }
  }

  const { error } = await serviceClient
    .from('payment_accounts')
    .update({ active: req.body.active })
    .eq('id', req.params.id);
  if (error) throw new ApiError(400, error.message);

  res.json({ ok: true });
}));

// Permanently delete — mirrors pa_delete's RLS (admin/accountant/
// super_teller). Never delete an account with real movement history:
// account_movements has ON DELETE CASCADE on account_id, so that would
// silently destroy the audit trail. Node re-checks this itself rather
// than trusting the frontend already did.
router.delete('/:id', requireUser, asyncWrapper(async (req, res) => {
  if (!isUuid(req.params.id)) throw new ApiError(400, 'id must be a uuid');
  if (!isAdminAccountantOrSuperTeller(req.user)) {
    throw new ApiError(403, 'Not authorized to delete payment accounts');
  }

  const { count, error: countErr } = await serviceClient
    .from('account_movements')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', req.params.id);
  if (countErr) throw new ApiError(400, countErr.message);
  if ((count || 0) > 0) {
    throw new ApiError(409, `Cannot delete — ${count} recorded movement(s) exist for this account`);
  }

  const { error } = await serviceClient.from('payment_accounts').delete().eq('id', req.params.id);
  if (error) throw new ApiError(400, error.message);

  res.json({ ok: true });
}));

// Propagate an account_catalog rename/currency change to every branch
// payment_accounts row sharing that catalog_id (name/currencies are
// copied at creation, not a live join, so they'd otherwise go stale
// forever). Node doesn't touch account_catalog itself — that write stays
// on the frontend for now (not one of Phase 3's 6 tables).
function validatePropagate(body) {
  if (body.name == null && body.currencies == null) return 'name or currencies is required';
  if (body.name != null && typeof body.name !== 'string') return 'name must be a string';
  if (body.currencies != null && !Array.isArray(body.currencies)) return 'currencies must be an array';
  return true;
}

router.patch('/by-catalog/:catalogId', requireUser, validateBody(validatePropagate), asyncWrapper(async (req, res) => {
  if (!isUuid(req.params.catalogId)) throw new ApiError(400, 'catalogId must be a uuid');
  if (!isAdminOrAccountant(req.user)) {
    throw new ApiError(403, 'Not authorized to update payment accounts');
  }

  const patch = {};
  if (req.body.name != null) patch.name = req.body.name;
  if (req.body.currencies != null) patch.currencies = req.body.currencies;

  const { error } = await serviceClient
    .from('payment_accounts')
    .update(patch)
    .eq('catalog_id', req.params.catalogId);
  if (error) throw new ApiError(400, error.message);

  res.json({ ok: true });
}));

module.exports = router;
