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

// Replaces a teller's whole weekly schedule in one call — mirrors
// UsersPage.jsx's saveSchedule (delete all existing rows for the teller,
// then insert whichever days now have an assignment) and
// schedules_admin's own RLS (admin only, full stop — reads stay open to
// everyone via schedules_read, untouched by this migration). rows may be
// empty (clearing the whole schedule).
function validateReplace(body) {
  if (!Array.isArray(body?.rows)) return 'rows must be an array';
  for (const r of body.rows) {
    if (!Number.isInteger(r?.day_of_week) || r.day_of_week < 0 || r.day_of_week > 6) return 'each row needs day_of_week between 0 and 6';
    if (!isUuid(r?.branch_id)) return 'each row needs a branch_id uuid';
  }
  return true;
}

router.put('/:tellerId', requireUser, validateBody(validateReplace), asyncWrapper(async (req, res) => {
  if (!isUuid(req.params.tellerId)) throw new ApiError(400, 'tellerId must be a uuid');
  if (!isAdmin(req.user)) throw new ApiError(403, 'Not authorized to edit teller schedules');

  const { error: delErr } = await serviceClient.from('teller_schedules').delete().eq('teller_id', req.params.tellerId);
  if (delErr) throw new ApiError(400, delErr.message);

  if (req.body.rows.length > 0) {
    const { error: insErr } = await serviceClient.from('teller_schedules').insert(
      req.body.rows.map((r) => ({ teller_id: req.params.tellerId, day_of_week: r.day_of_week, branch_id: r.branch_id }))
    );
    if (insErr) throw new ApiError(400, insErr.message);
  }

  res.json({ ok: true });
}));

module.exports = router;
