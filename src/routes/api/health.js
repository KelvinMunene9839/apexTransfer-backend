const { Router } = require('express');

const router = Router();

router.get('/', (req, res) => {
  res.json({ ok: true, service: 'apex-transfer-backend' });
});

module.exports = router;
