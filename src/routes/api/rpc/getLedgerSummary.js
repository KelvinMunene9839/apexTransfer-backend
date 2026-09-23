const { Router } = require('express');
const { requireUser } = require('../../../middleware/auth');
const { asyncWrapper } = require('../../../utils/asyncWrapper');
const { ApiError } = require('../../../utils/ApiError');
const { callRpcAsService } = require('../../../services/rpc');

const router = Router();

// Read-only, no-parameter aggregate (system-wide totals, not linked to a
// specific branch/customer) — no branch/role gate needed beyond being
// logged in, matching current behavior.
router.post('/', requireUser, asyncWrapper(async (req, res) => {
  const { data, error } = await callRpcAsService('get_ledger_summary');
  if (error) throw new ApiError(400, error.message);

  res.json(data);
}));

module.exports = router;
