const crypto = require('crypto');
const { Router } = require('express');
const { requireUser } = require('../../../middleware/auth');
const { validateBody } = require('../../../middleware/validate');
const { asyncWrapper } = require('../../../utils/asyncWrapper');
const { ApiError } = require('../../../utils/ApiError');
const { callRpcAsService } = require('../../../services/rpc');
const { canModifyBranchBalance } = require('../../../services/balanceAuth');

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function validateParams(body) {
  if (!isUuid(body?.p_branch_id)) return 'p_branch_id must be a uuid';
  if (!isNum(body?.p_amount_rwf) || body.p_amount_rwf <= 0) return 'p_amount_rwf must be a positive number';
  if (body.p_teller_id != null && !isUuid(body.p_teller_id)) return 'p_teller_id must be a uuid';
  if (body.p_description != null && typeof body.p_description !== 'string') return 'p_description must be a string';
  return true;
}

// Same "who is this for" shape as petit_cash_entries' resolveTellerId, but
// a loss may legitimately have no specific teller (an accountant/admin
// recording a branch-level shortfall with no individual attributed) —
// unlike petit cash, non-admin/accountant callers still always get
// themselves; admin/accountant get whatever they passed (including null).
function resolveTellerId(user, bodyTellerId) {
  if (user.role === 'admin' || user.role === 'accountant') {
    return isUuid(bodyTellerId) ? bodyTellerId : null;
  }
  return user.id;
}

router.post('/', requireUser, validateBody(validateParams), asyncWrapper(async (req, res) => {
  if (!canModifyBranchBalance(req.user, req.body.p_branch_id)) {
    throw new ApiError(403, 'Not authorized to record a loss for this branch');
  }

  const reference = 'LOSS-' + crypto.randomBytes(4).toString('hex').toUpperCase();

  const { data, error } = await callRpcAsService('record_loss', {
    p_branch_id: req.body.p_branch_id,
    // Always 'Cash(RWF)' — a loss is specifically a till shortfall on that
    // account, never a client-supplied choice.
    p_payment_account: 'Cash(RWF)',
    p_amount_rwf: req.body.p_amount_rwf,
    p_reference: reference,
    p_teller_id: resolveTellerId(req.user, req.body.p_teller_id),
    p_description: req.body.p_description ?? '',
    p_recorded_by: req.user.id,
  });
  if (error) throw new ApiError(400, error.message);

  res.json({ ok: true, id: data, reference });
}));

module.exports = router;
