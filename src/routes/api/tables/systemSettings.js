const { Router } = require('express');
const { requireUser } = require('../../../middleware/auth');
const { validateBody } = require('../../../middleware/validate');
const { asyncWrapper } = require('../../../utils/asyncWrapper');
const { ApiError } = require('../../../utils/ApiError');
const { serviceClient } = require('../../../services/rpc');
const { isAdmin } = require('../../../services/balanceAuth');

const router = Router();

// Key/value settings store (AML thresholds, bureau profile, etc.) —
// mirrors settings_admin exactly: admin only, full stop. Shared by
// AmlPage.jsx's ThresholdModal and SettingsPage.jsx's saveSettings, both
// of which just upsert whichever rows changed. updated_by is forced
// server-side (never trusted from the client); updated_at is left to the
// column's own now() default.
function validateReplace(body) {
  if (!Array.isArray(body?.rows) || body.rows.length === 0) return 'rows must be a non-empty array';
  for (const row of body.rows) {
    if (typeof row?.key !== 'string' || !row.key) return 'each row needs a non-empty key';
    if (row.value === undefined) return 'each row needs a value';
  }
  return true;
}

router.put('/', requireUser, validateBody(validateReplace), asyncWrapper(async (req, res) => {
  if (!isAdmin(req.user)) throw new ApiError(403, 'Not authorized to edit system settings');

  const rows = req.body.rows.map((row) => ({ key: row.key, value: row.value, updated_by: req.user.id }));
  const { error } = await serviceClient.from('system_settings').upsert(rows, { onConflict: 'key' });
  if (error) throw new ApiError(400, error.message);

  res.json({ ok: true });
}));

module.exports = router;
