const { Router } = require('express');
const { requireUser } = require('../../../middleware/auth');
const { validateBody } = require('../../../middleware/validate');
const { asyncWrapper } = require('../../../utils/asyncWrapper');
const { ApiError } = require('../../../utils/ApiError');
const { callRpcAsService } = require('../../../services/rpc');
const { canCreateTransactionForTeller } = require('../../../services/balanceAuth');
const { findRecentDuplicate } = require('../../../services/duplicateGuard');

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function resolveTellerId(user, bodyTellerId) {
  if (user.role === 'admin' || user.role === 'accountant') {
    return (isUuid(bodyTellerId) ? bodyTellerId : null) || user.id;
  }
  return user.id;
}

// Create — mirrors ria_teller_insert (teller/super_teller, own id) +
// ria_accountant_insert (accountant, any id) + ria_admin_all (admin, any
// id), same identity-vs-role shape as transactions' insert rule. Void/edit
// only ever happen through the tx_requests approval flow (no direct UI
// action outside it), so this is the only public endpoint this table
// needs — source_account/dest_account are derived server-side from type,
// never accepted from the client.
function validateCreate(body) {
  if (typeof body?.reference !== 'string' || !body.reference) return 'reference is required';
  if (body?.type !== 'receive' && body?.type !== 'send') return "type must be 'receive' or 'send'";
  if (!isNum(body?.amount) || body.amount <= 0) return 'amount must be a positive number';
  if (!isNum(body?.amount_paid) || body.amount_paid <= 0) return 'amount_paid must be a positive number';
  if (!isUuid(body?.branch_id)) return 'branch_id must be a uuid';
  if (body.teller_id != null && !isUuid(body.teller_id)) return 'teller_id must be a uuid';
  return true;
}

router.post('/', requireUser, validateBody(validateCreate), asyncWrapper(async (req, res) => {
  const b = req.body;
  const tellerId = resolveTellerId(req.user, b.teller_id);
  if (!canCreateTransactionForTeller(req.user, tellerId)) {
    throw new ApiError(403, 'Not authorized to create a Ria entry for this teller');
  }

  // See westernUnionTransactions.js's/duplicateGuard.js's own comment —
  // same double-submit race guard, same reasoning (no `voided` boolean
  // column on this table either, so excludeVoided is off).
  const { duplicate, error: dupErr } = await findRecentDuplicate('ria_transactions', {
    teller_id: tellerId, branch_id: b.branch_id, type: b.type,
    amount: b.amount, amount_paid: b.amount_paid,
  }, { excludeVoided: false });
  if (dupErr) throw new ApiError(400, dupErr.message);
  if (duplicate) {
    throw new ApiError(409, `This looks like a duplicate of ${duplicate.reference}, submitted ${Math.max(1, Math.round((Date.now() - new Date(duplicate.created_at).getTime()) / 1000))}s ago. If this is really a separate entry, wait a moment and resubmit.`);
  }

  // Legs + row insert now happen atomically in one Postgres function — see
  // 20260826120200_atomic_channel_creation.sql. source_account/dest_account
  // are derived server-side inside that function, same as before.
  const { data, error } = await callRpcAsService('create_ria_transaction', {
    p_reference: b.reference, p_type: b.type, p_amount: b.amount, p_amount_paid: b.amount_paid,
    p_branch_id: b.branch_id, p_teller_id: tellerId,
    p_customer_name: b.customer_name ?? null, p_notes: b.notes ?? null,
  });
  if (error) throw new ApiError(400, error.message);

  res.json(data);
}));

module.exports = router;
