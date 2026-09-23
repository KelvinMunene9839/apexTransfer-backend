const { Router } = require('express');
const { requireUser } = require('../../middleware/auth');
const { asyncWrapper } = require('../../utils/asyncWrapper');

const router = Router();

// Sanity-check endpoint for Phase 1: proves JWT verification and the DB
// round trip both work end to end. Not part of the real API surface.
router.get('/', requireUser, asyncWrapper(async (req, res) => {
  res.json({ user: req.user });
}));

module.exports = router;
