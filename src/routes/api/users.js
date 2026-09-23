const { Router } = require('express');
const { requireUser } = require('../../middleware/auth');
const { validateBody } = require('../../middleware/validate');
const { asyncWrapper } = require('../../utils/asyncWrapper');
const { ApiError } = require('../../utils/ApiError');
const { serviceClient } = require('../../services/rpc');
const { isAdmin } = require('../../services/balanceAuth');

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);
const ALLOWED_ROLES = ['teller', 'super_teller', 'branch_manager', 'admin', 'auditor', 'accountant'];
// 10 years — effectively permanent without a dedicated "banned forever" API.
const PERMANENT_BAN = '87600h';

// Folded from supabase/functions/create-user (Phase 7 close-out) —
// UsersPage.jsx's InviteUserModal. Same two-step create: Auth user first,
// then the profiles row; if the profile insert fails, the orphaned auth
// user is rolled back so a half-created account never lingers.
function validateCreate(body) {
  const fullName = body?.full_name?.trim?.();
  const email = body?.email?.trim?.();
  const role = body?.role?.trim?.();
  const password = body?.password?.trim?.();
  if (!fullName || !email || !role || !password) return 'full_name, email, role, and password are required';
  if (password.length < 8) return 'Password must be at least 8 characters long';
  if (!ALLOWED_ROLES.includes(role)) return 'Invalid role';
  if (body.branch_id !== undefined && body.branch_id !== null && !isUuid(body.branch_id)) return 'branch_id must be a uuid or null';
  return true;
}

router.post('/', requireUser, validateBody(validateCreate), asyncWrapper(async (req, res) => {
  const fullName = req.body.full_name.trim();
  const email = req.body.email.trim().toLowerCase();
  const role = req.body.role.trim();
  const password = req.body.password.trim();
  const branchId = req.body.branch_id ?? null;

  // A branch_manager may onboard tellers into their own branch only —
  // everything else (any other role, any other branch, no branch at all)
  // stays admin-only. Mirrors the same "manage my own branch" scope this
  // role already has on transactions/shifts/petit_cash/losses via RLS.
  const isBranchManagerOnboardingOwnTeller =
    req.user.role === 'branch_manager' && role === 'teller' && branchId && branchId === req.user.branchId;
  if (!isAdmin(req.user) && !isBranchManagerOnboardingOwnTeller) {
    throw new ApiError(403, 'Not authorized to create users');
  }

  if (branchId) {
    const { data: branch } = await serviceClient.from('branches').select('id').eq('id', branchId).maybeSingle();
    if (!branch) throw new ApiError(400, 'Unknown branch_id');
  }

  const { data: createdUser, error: createError } = await serviceClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, role },
  });
  if (createError || !createdUser.user) {
    throw new ApiError(400, createError?.message || 'Could not create auth user');
  }

  const { error: profileError } = await serviceClient.from('profiles').insert({
    id: createdUser.user.id,
    full_name: fullName,
    role,
    branch_id: branchId,
  });
  if (profileError) {
    await serviceClient.auth.admin.deleteUser(createdUser.user.id);
    throw new ApiError(400, profileError.message);
  }

  res.json({ ok: true, id: createdUser.user.id, email, full_name: fullName, role, branch_id: branchId });
}));

// Folded from supabase/functions/delete-user — UsersPage.jsx's
// handleDeleteOrReactivate('delete'). Tries a hard delete first; when
// the account has existing activity on record (shifts/transactions
// FK-restrict the auth.users -> profiles cascade), falls back to a
// permanent ban + profiles.active = false so it reads clearly as removed
// throughout the app without breaking referential integrity.
router.delete('/:id', requireUser, asyncWrapper(async (req, res) => {
  if (!isUuid(req.params.id)) throw new ApiError(400, 'id must be a uuid');
  if (!isAdmin(req.user)) throw new ApiError(403, 'Not authorized to remove users');

  const targetId = req.params.id;
  if (targetId === req.user.id) throw new ApiError(400, 'You cannot delete or reactivate your own account');

  const { data: targetProfile, error: targetError } = await serviceClient
    .from('profiles')
    .select('id, role')
    .eq('id', targetId)
    .maybeSingle();
  if (targetError || !targetProfile) throw new ApiError(404, 'User not found');

  if (targetProfile.role === 'admin') {
    const { count, error: countError } = await serviceClient
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'admin')
      .eq('active', true)
      .neq('id', targetId);
    if (countError) throw new ApiError(400, countError.message);
    if (!count) throw new ApiError(400, 'Cannot remove the last active administrator');
  }

  const { error: deleteError } = await serviceClient.auth.admin.deleteUser(targetId);
  if (!deleteError) return res.json({ ok: true, mode: 'deleted' });

  const { error: banError } = await serviceClient.auth.admin.updateUserById(targetId, { ban_duration: PERMANENT_BAN });
  const { error: deactivateError } = await serviceClient.from('profiles').update({ active: false }).eq('id', targetId);
  if (banError || deactivateError) throw new ApiError(400, deleteError.message);

  res.json({
    ok: true,
    mode: 'deactivated',
    reason: 'This account has existing activity on record and cannot be permanently deleted, so it was deactivated instead — the user can no longer log in.',
  });
}));

// Folded from supabase/functions/delete-user — UsersPage.jsx's
// handleDeleteOrReactivate('reactivate').
router.post('/:id/reactivate', requireUser, asyncWrapper(async (req, res) => {
  if (!isUuid(req.params.id)) throw new ApiError(400, 'id must be a uuid');
  if (!isAdmin(req.user)) throw new ApiError(403, 'Not authorized to reactivate users');

  const targetId = req.params.id;
  if (targetId === req.user.id) throw new ApiError(400, 'You cannot delete or reactivate your own account');

  const { data: targetProfile, error: targetError } = await serviceClient
    .from('profiles')
    .select('id')
    .eq('id', targetId)
    .maybeSingle();
  if (targetError || !targetProfile) throw new ApiError(404, 'User not found');

  const { error: unbanError } = await serviceClient.auth.admin.updateUserById(targetId, { ban_duration: 'none' });
  if (unbanError) throw new ApiError(400, unbanError.message);

  const { error: reactivateError } = await serviceClient.from('profiles').update({ active: true }).eq('id', targetId);
  if (reactivateError) throw new ApiError(400, reactivateError.message);

  res.json({ ok: true, mode: 'reactivated' });
}));

module.exports = router;
