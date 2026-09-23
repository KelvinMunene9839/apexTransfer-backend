const { Router } = require('express');

const router = Router();

// Each resource gets its own route file under routes/api/, mounted at its
// path prefix here. Keep it that way as endpoints are added (Phase 2's RPC
// wrappers, Phase 3+'s per-table routes) rather than growing this file.
router.use('/health', require('./health'));
router.use('/me', require('./me'));
router.use('/rpc', require('./rpc'));
router.use('/tables', require('./tables'));
router.use('/users', require('./users'));

module.exports = router;
