const { Router } = require('express');
const { requireUser } = require('../../../middleware/auth');
const { validateBody } = require('../../../middleware/validate');
const { asyncWrapper } = require('../../../utils/asyncWrapper');
const { ApiError } = require('../../../utils/ApiError');
const { serviceClient, callRpcAsService } = require('../../../services/rpc');
const { canCreatePetitCashEntry, isAdminAccountantOrSuperTeller } = require('../../../services/balanceAuth');

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// Any authenticated user may create a row for themselves (mirrors
// petit_insert's bare teller_id = auth.uid() check, no role restriction);
// admin/accountant may specify a different teller_id, defaulting to
// themselves if they don't — same pattern as every other "who did this"
// field across the migration.
function resolveTellerId(user, bodyTellerId) {
  if (user.role === 'admin' || user.role === 'accountant') {
    return (isUuid(bodyTellerId) ? bodyTellerId : null) || user.id;
  }
  return user.id;
}

// Covers both TellerPetitCash.jsx's live submission (amount_rwf/
// amount_foreign/currency pre-split by the caller for foreign-only tills)
// and ExpensesPage.jsx's admin entry (amount_rwf only, custom recorded_at).
// status is never accepted from the client — every entry starts 'pending'
// regardless of caller, same as both existing call sites already do; it
// only ever becomes 'approved' through approve_petit_cash_entry (already
// migrated in Phase 2) or the tx_requests 'petit_cash_entry' add flow
// (services/txRequestApproval.js).
function validateCreate(body) {
  if (body?.direction !== 'in' && body?.direction !== 'out') return "direction must be 'in' or 'out'";
  if (typeof body?.category !== 'string' || !body.category) return 'category is required';
  if (body.branch_id != null && !isUuid(body.branch_id)) return 'branch_id must be a uuid';
  if (body.shift_id != null && !isUuid(body.shift_id)) return 'shift_id must be a uuid';
  if (body.teller_id != null && !isUuid(body.teller_id)) return 'teller_id must be a uuid';
  if (!isNum(body.amount_rwf) && !isNum(body.amount_foreign)) return 'amount_rwf or amount_foreign is required';
  return true;
}

router.post('/', requireUser, validateBody(validateCreate), asyncWrapper(async (req, res) => {
  const b = req.body;
  const tellerId = resolveTellerId(req.user, b.teller_id);
  if (!canCreatePetitCashEntry(req.user, tellerId)) {
    throw new ApiError(403, 'Not authorized to create a cash entry for this teller');
  }

  const { data, error } = await serviceClient
    .from('petit_cash_entries')
    .insert({
      teller_id: tellerId,
      branch_id: b.branch_id ?? null,
      shift_id: b.shift_id ?? null,
      direction: b.direction,
      category: b.category,
      amount_rwf: isNum(b.amount_rwf) ? b.amount_rwf : 0,
      currency: b.currency ?? null,
      amount_foreign: isNum(b.amount_foreign) ? b.amount_foreign : null,
      description: b.description ?? null,
      payment_account: b.payment_account ?? null,
      recorded_at: b.recorded_at ?? new Date().toISOString(),
    })
    .select()
    .single();
  if (error) throw new ApiError(400, error.message);

  res.json(data);
}));

// ExpensesPage.jsx's delete button — used to be a raw hard DELETE with no
// reversal, the one channel in this whole system that didn't soft-void.
// Now calls void_petit_cash_entry() (20260826120100_petit_cash_soft_void.sql):
// flips `voided`, and — only if the entry had actually been approved and
// therefore posted a real balance leg — reverses that leg with a
// `[reversed]`-suffixed description. The row itself is never deleted, so
// its audit trail (including who approved it and when) survives. Same
// admin/accountant/super_teller gate as before; the RPC's own role check
// mirrors it independently.
router.delete('/:id', requireUser, asyncWrapper(async (req, res) => {
  if (!isUuid(req.params.id)) throw new ApiError(400, 'id must be a uuid');
  if (!isAdminAccountantOrSuperTeller(req.user)) {
    throw new ApiError(403, 'Not authorized to delete cash entries');
  }

  const { error } = await callRpcAsService('void_petit_cash_entry', {
    p_entry_id: req.params.id,
    p_reviewer_id: req.user.id,
    p_reason: null,
  });
  if (error) throw new ApiError(400, error.message);

  res.json({ ok: true });
}));

module.exports = router;
