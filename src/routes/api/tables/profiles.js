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

// profiles' own RLS (profiles_admin_all) only ever allowed admin to write
// this table at all — there was no self-update policy, so
// SettingsPage.jsx's "change my display name" silently updated 0 rows for
// every non-admin caller (confirmed live: a real PATCH as a teller
// returned 0 rows, no error, and the frontend showed a false "success"
// toast regardless). Fixed here by giving every authenticated user a
// narrow self-service path — only their own full_name, nothing else —
// matching what the UI already promised. Always operates on req.user.id;
// never accepts an id in the body, so there's no way to point this at
// someone else's row.
function validateSelfUpdate(body) {
  if (typeof body?.full_name !== 'string' || !body.full_name.trim()) return 'full_name is required';
  return true;
}

router.patch('/me', requireUser, validateBody(validateSelfUpdate), asyncWrapper(async (req, res) => {
  const { error } = await serviceClient.from('profiles').update({ full_name: req.body.full_name.trim() }).eq('id', req.user.id);
  if (error) throw new ApiError(400, error.message);
  res.json({ ok: true });
}));

// Admin-only — mirrors profiles_admin_all exactly. Covers both
// UsersPage.jsx's saveDetails (full_name + role, dropping branch_id for
// non-branch-scoped roles) and saveManagedBranch (branch_id only) as one
// endpoint: the patch only ever contains whichever fields the caller
// actually sent.
const NON_BRANCH_ROLES = ['admin', 'super_teller'];

function validateAdminUpdate(body) {
  if (body?.full_name != null && (typeof body.full_name !== 'string' || !body.full_name.trim())) return 'full_name must be a non-empty string';
  if (body?.role != null && typeof body.role !== 'string') return 'role must be a string';
  if (body?.branch_id !== undefined && body.branch_id !== null && !isUuid(body.branch_id)) return 'branch_id must be a uuid or null';
  if (body?.full_name === undefined && body?.role === undefined && body?.branch_id === undefined) return 'at least one field is required';
  return true;
}

router.patch('/:id', requireUser, validateBody(validateAdminUpdate), asyncWrapper(async (req, res) => {
  if (!isUuid(req.params.id)) throw new ApiError(400, 'id must be a uuid');
  if (!isAdmin(req.user)) throw new ApiError(403, 'Not authorized to edit user profiles');

  const patch = {};
  if (req.body.full_name !== undefined) patch.full_name = req.body.full_name.trim();
  if (req.body.role !== undefined) patch.role = req.body.role;
  if (req.body.branch_id !== undefined) patch.branch_id = req.body.branch_id;
  // Roles that aren't branch-scoped (admin/super_teller) drop any existing
  // assignment — mirrors UsersPage.jsx's needsBranchForRole exactly, moved
  // server-side so the rule can't be bypassed by a client that omits it.
  if (req.body.role !== undefined && NON_BRANCH_ROLES.includes(req.body.role)) patch.branch_id = null;

  const { error } = await serviceClient.from('profiles').update(patch).eq('id', req.params.id);
  if (error) throw new ApiError(400, error.message);

  res.json({ ok: true });
}));

module.exports = router;
