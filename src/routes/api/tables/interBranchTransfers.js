const { Router } = require('express');
const { requireUser } = require('../../../middleware/auth');
const { validateBody } = require('../../../middleware/validate');
const { asyncWrapper } = require('../../../utils/asyncWrapper');
const { ApiError } = require('../../../utils/ApiError');
const { serviceClient } = require('../../../services/rpc');
const { canModifyBranchBalance } = require('../../../services/balanceAuth');

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// Audit log of a completed inter-branch transfer — mirrors InterBranchPage.jsx's
// handleTransfer: the real money movement (two updateAccountBalance calls,
// debit then credit, with a rollback of the debit if the credit fails) has
// already happened via already-authorized backend RPC calls before the
// frontend ever reaches this insert. This endpoint only owns the log row
// itself, same shape as float_movements.
//
// Was gated to isAdminAccountantOrSuperTeller (mirroring ibr_write's old
// RLS exactly) while InterBranchPage.jsx's own RoleGuard allows a plain
// teller through too — a teller's transfer moved real money successfully
// (canModifyBranchBalance already allows a teller acting on their own
// branch) and then 403'd writing this log row, silently (the frontend
// fires this call with `void`, discarding the error) leaving a real
// transfer with zero row in inter_branch_transfers -- which
// interBranchFlows.js treats as a real, counted flow for branch-position/
// Financial Statements purposes. Confirmed live: the table is empty today
// (per interBranchFlows.js's own comment), so this hadn't corrupted
// anything YET, but would have the first time a teller used this page
// successfully. Now uses the exact same canModifyBranchBalance check (on
// from_branch_id) that already governs the real debit this log documents,
// instead of a narrower, independent role list. created_by is forced
// server-side. reference is left to the column's own generate_reference('IBR')
// default.
function validateCreate(body) {
  if (!isUuid(body?.from_branch_id)) return 'from_branch_id must be a uuid';
  if (!isUuid(body?.to_branch_id)) return 'to_branch_id must be a uuid';
  if (typeof body?.currency !== 'string' || !body.currency) return 'currency is required';
  if (!isNum(body?.amount) || body.amount <= 0) return 'amount must be a positive number';
  return true;
}

router.post('/', requireUser, validateBody(validateCreate), asyncWrapper(async (req, res) => {
  if (!canModifyBranchBalance(req.user, req.body?.from_branch_id)) throw new ApiError(403, 'Not authorized to log inter-branch transfers');

  const b = req.body;
  const { data, error } = await serviceClient
    .from('inter_branch_transfers')
    .insert({
      from_branch_id: b.from_branch_id,
      to_branch_id: b.to_branch_id,
      currency: b.currency,
      amount: b.amount,
      from_account_name: b.from_account_name ?? null,
      to_account_name: b.to_account_name ?? null,
      description: b.description ?? null,
      created_by: req.user.id,
    })
    .select()
    .single();
  if (error) throw new ApiError(400, error.message);

  res.json(data);
}));

module.exports = router;
