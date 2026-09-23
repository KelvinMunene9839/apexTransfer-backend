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

// Replaces a super teller's whole account-assignment set in one call —
// mirrors BranchAccountsPage.jsx's save() (diff-based add/remove against
// the currently-assigned set) but simplified to a full replace, since the
// frontend already holds the complete target set (`selected`) and a
// replace is equivalent to add-the-new/remove-the-dropped for this table
// (no other columns to preserve per row). Mirrors sta_admin_write's own
// RLS (admin only — reads stay open to everyone via sta_select, untouched
// by this migration).
function validateReplace(body) {
  if (!Array.isArray(body?.accountIds)) return 'accountIds must be an array';
  for (const id of body.accountIds) {
    if (!isUuid(id)) return 'each accountIds entry must be a uuid';
  }
  return true;
}

router.put('/:superTellerId', requireUser, validateBody(validateReplace), asyncWrapper(async (req, res) => {
  if (!isUuid(req.params.superTellerId)) throw new ApiError(400, 'superTellerId must be a uuid');
  if (!isAdmin(req.user)) throw new ApiError(403, 'Not authorized to edit super teller account assignments');

  const { error: delErr } = await serviceClient.from('super_teller_accounts').delete().eq('super_teller_id', req.params.superTellerId);
  if (delErr) throw new ApiError(400, delErr.message);

  if (req.body.accountIds.length > 0) {
    const { error: insErr } = await serviceClient.from('super_teller_accounts').insert(
      req.body.accountIds.map((account_id) => ({ super_teller_id: req.params.superTellerId, account_id }))
    );
    if (insErr) throw new ApiError(400, insErr.message);
  }

  res.json({ ok: true });
}));

module.exports = router;
