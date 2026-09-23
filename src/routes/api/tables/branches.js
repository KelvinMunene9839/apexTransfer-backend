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

// All writes here mirror branches_admin_all — admin only, full stop.
function validateCreate(body) {
  if (typeof body?.code !== 'string' || !body.code.trim()) return 'code is required';
  if (typeof body?.name !== 'string' || !body.name.trim()) return 'name is required';
  return true;
}

router.post('/', requireUser, validateBody(validateCreate), asyncWrapper(async (req, res) => {
  if (!isAdmin(req.user)) throw new ApiError(403, 'Not authorized to create branches');

  const { data, error } = await serviceClient
    .from('branches')
    .insert({
      organization_id: req.user.organizationId,
      code: req.body.code.trim().toUpperCase(),
      name: req.body.name.trim(),
      address: req.body.address || null,
      phone: req.body.phone || null,
      email: req.body.email || null,
      active: true,
    })
    .select()
    .single();
  if (error) throw new ApiError(400, error.message);

  res.json(data);
}));

// Covers both EditBranchModal's full patch (name/address/phone/email/
// active) and DeleteBranchModal's "Deactivate instead" (active only) —
// the patch only ever contains whichever fields the caller actually sent.
function validateUpdate(body) {
  if (body?.name != null && (typeof body.name !== 'string' || !body.name.trim())) return 'name must be a non-empty string';
  if (body?.active != null && typeof body.active !== 'boolean') return 'active must be a boolean';
  if (body?.name === undefined && body?.address === undefined && body?.phone === undefined && body?.email === undefined && body?.active === undefined) {
    return 'at least one field is required';
  }
  return true;
}

router.patch('/:id', requireUser, validateBody(validateUpdate), asyncWrapper(async (req, res) => {
  if (!isUuid(req.params.id)) throw new ApiError(400, 'id must be a uuid');
  if (!isAdmin(req.user)) throw new ApiError(403, 'Not authorized to edit branches');

  const patch = {};
  if (req.body.name !== undefined) patch.name = req.body.name.trim();
  if (req.body.address !== undefined) patch.address = req.body.address || null;
  if (req.body.phone !== undefined) patch.phone = req.body.phone || null;
  if (req.body.email !== undefined) patch.email = req.body.email || null;
  if (req.body.active !== undefined) patch.active = req.body.active;

  const { error } = await serviceClient
    .from('branches')
    .update(patch)
    .eq('id', req.params.id)
    .eq('organization_id', req.user.organizationId);
  if (error) throw new ApiError(400, error.message);

  res.json({ ok: true });
}));

router.delete('/:id', requireUser, asyncWrapper(async (req, res) => {
  if (!isUuid(req.params.id)) throw new ApiError(400, 'id must be a uuid');
  if (!isAdmin(req.user)) throw new ApiError(403, 'Not authorized to delete branches');

  const { count, error: countErr } = await serviceClient
    .from('transactions')
    .select('id', { count: 'exact', head: true })
    .eq('branch_id', req.params.id)
    .eq('organization_id', req.user.organizationId);
  if (countErr) throw new ApiError(400, countErr.message);
  if ((count || 0) > 0) {
    throw new ApiError(409, `Cannot delete — ${count} transaction(s) recorded for this branch. Deactivate it instead.`);
  }

  const { data: accts, error: acctErr } = await serviceClient
    .from('payment_accounts').select('id, name, balance_rwf, balance_fx').eq('branch_id', req.params.id);
  if (acctErr) throw new ApiError(400, acctErr.message);
  const funded = (accts || []).find((a) => Number(a.balance_rwf) !== 0 || Object.values(a.balance_fx || {}).some((v) => Number(v) !== 0));
  if (funded) {
    throw new ApiError(409, `Cannot delete — "${funded.name}" still holds a real balance (payment_accounts cascade-deletes with the branch, which would destroy it). Zero it out or deactivate the branch instead.`);
  }
  if ((accts || []).length > 0) {
    const acctIds = accts.map((a) => a.id);
    const { count: movCount, error: movErr } = await serviceClient
      .from('account_movements').select('id', { count: 'exact', head: true }).in('account_id', acctIds);
    if (movErr) throw new ApiError(400, movErr.message);
    if ((movCount || 0) > 0) {
      throw new ApiError(409, `Cannot delete — this branch's accounts have ${movCount} recorded movement(s) in their audit trail (payment_accounts cascade-deletes with the branch). Deactivate it instead.`);
    }
  }

  const { error } = await serviceClient.from('branches').delete().eq('id', req.params.id);
  if (error) throw new ApiError(400, error.message);

  res.json({ ok: true });
}));

module.exports = router;
