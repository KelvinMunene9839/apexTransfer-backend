const { Router } = require('express');
const { requireUser } = require('../../../middleware/auth');
const { validateBody } = require('../../../middleware/validate');
const { asyncWrapper } = require('../../../utils/asyncWrapper');
const { ApiError } = require('../../../utils/ApiError');
const { serviceClient, callRpcAsService } = require('../../../services/rpc');
const { isAdminOrAccountant } = require('../../../services/balanceAuth');

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateParams(body) {
  if (typeof body?.p_entry_id !== 'string' || !UUID_RE.test(body.p_entry_id)) return 'p_entry_id must be a uuid';
  if (typeof body?.p_account_name !== 'string' || !body.p_account_name.trim()) return 'p_account_name is required';
  if (body.p_amount != null && (typeof body.p_amount !== 'number' || !Number.isFinite(body.p_amount))) return 'p_amount must be a number';
  return true;
}

// Mirrors settleDeferredTransaction.js's own auth comment:
// settle_manual_ledger_entry has no authorization check of its own, so Node
// supplies it. Gated to admin/accountant, same as LedgerPage.jsx's own
// SETTLE_ROLES (client-side gate — this is the server-side one it relies on).
router.post('/', requireUser, validateBody(validateParams), asyncWrapper(async (req, res) => {
  if (!isAdminOrAccountant(req.user)) throw new ApiError(403, 'Not authorized to settle ledger entries');

  const { data: entry, error: fetchErr } = await serviceClient
    .from('ledger_entries').select('id, transaction_id').eq('id', req.body.p_entry_id).maybeSingle();
  if (fetchErr) throw new ApiError(400, fetchErr.message);
  if (!entry) throw new ApiError(404, 'Ledger entry not found');
  if (entry.transaction_id) throw new ApiError(400, 'This entry is linked to a transaction — use the transaction settlement flow instead');

  const { error } = await callRpcAsService('settle_manual_ledger_entry', {
    p_entry_id: req.body.p_entry_id,
    p_account_name: req.body.p_account_name,
    p_amount: req.body.p_amount ?? null,
  });
  if (error) throw new ApiError(400, error.message);

  res.json({ ok: true });
}));

module.exports = router;
