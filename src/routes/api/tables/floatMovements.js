const { Router } = require('express');
const { requireUser } = require('../../../middleware/auth');
const { validateBody } = require('../../../middleware/validate');
const { asyncWrapper } = require('../../../utils/asyncWrapper');
const { ApiError } = require('../../../utils/ApiError');
const { serviceClient } = require('../../../services/rpc');

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// Audit log of vault<->branch float movements — no void/edit flow exists
// anywhere in the app (not in tx_requests' ENTITY_CONFIG), same shape as
// ledger_entries. The real money movement (updateAccountBalance,
// reduceWacInventory, upsertWacInventory) already happens via separate,
// already-authorized backend RPC calls before the frontend ever reaches
// this insert (see FloatPage.jsx's handleSubmit) — this endpoint only
// owns the log row itself, mirrors float_insert_admin's own RLS (admin,
// super_teller, or teller — no accountant, no branch-membership check).
// Accepts a single object (FloatPage.jsx) or an array (InventoryPage.jsx's
// TransferModal inserts a paired return+dispatch row with no balance
// movement at all — a pure paper-trail entry between two branches).
function validateRow(row) {
  if (typeof row?.currency !== 'string' || !row.currency) return 'currency is required';
  if (!isNum(row?.amount) || row.amount <= 0) return 'amount must be a positive number';
  if (!['dispatch', 'return', 'incoming'].includes(row?.movement_type)) return "movement_type must be 'dispatch', 'return', or 'incoming'";
  if (!isUuid(row?.branch_id)) return 'branch_id must be a uuid';
  if (row.shift_id != null && !isUuid(row.shift_id)) return 'shift_id must be a uuid';
  return true;
}

function validateCreate(body) {
  const rows = Array.isArray(body) ? body : [body];
  if (rows.length === 0) return 'at least one entry is required';
  for (const row of rows) {
    const result = validateRow(row);
    if (result !== true) return result;
  }
  return true;
}

router.post('/', requireUser, validateBody(validateCreate), asyncWrapper(async (req, res) => {
  const role = req.user.role;
  if (!(role === 'admin' || role === 'super_teller' || role === 'teller')) {
    throw new ApiError(403, 'Not authorized to record float movements');
  }

  const rows = (Array.isArray(req.body) ? req.body : [req.body]).map((row) => ({
    branch_id: row.branch_id,
    teller_id: req.user.id,
    currency: row.currency,
    amount: row.amount,
    movement_type: row.movement_type,
    notes: row.notes ?? null,
    shift_id: row.shift_id ?? null,
    wac_rate_snapshot: isNum(row.wac_rate_snapshot) ? row.wac_rate_snapshot : null,
  }));

  const { data, error } = await serviceClient.from('float_movements').insert(rows).select();
  if (error) throw new ApiError(400, error.message);

  res.json(Array.isArray(req.body) ? data : data[0]);
}));

module.exports = router;
