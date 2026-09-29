const express = require('express');
const { buscarSimulador } = require('../services/simulador');
const { requireAuth } = require('../middleware/auth');
const { limitReads } = require('../middleware/readLimits');
const router = express.Router();
router.use(requireAuth);

/**
 * GET /simulador
 * Devolve as 4 views consolidadas (UF: AL F, AL, PE, SE), sem filtro e sem paginação.
 */
router.get('/', limitReads, async (req, res, next) => {
  try {
    const data = await buscarSimulador();
    res.json({ success: true, total: data.length, data });
  } catch (err) { next(err); } finally { req.releaseReadSlot(); }
});

module.exports = router;
