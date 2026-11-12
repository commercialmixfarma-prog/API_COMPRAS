const express = require('express');
const { query, validationResult, matchedData } = require('express-validator');
const { buscarIncineracao, BASES_INCINERACAO } = require('../services/incineracaoQuery');
const { requireAuth } = require('../middleware/auth');
const { limitReads } = require('../middleware/readLimits');
const router = express.Router();
router.use(requireAuth);

const validateIncineracao = [
  query('base').optional().isString().trim().toUpperCase().isIn(BASES_INCINERACAO),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ erro: 'Dados inválidos.', detalhes: errors.array().map(e => ({ campo: e.path, mensagem: e.msg })) });
    }
    req.filtrosIncineracao = matchedData(req, { locations: ['query'] });
    next();
  },
];

/**
 * GET /incineracao
 * Devolve a view de produtos para incineração de AL e SE, com a coluna `base`.
 * Filtro opcional: base (AL | SE). Sem paginação.
 */
router.get('/', validateIncineracao, limitReads, async (req, res, next) => {
  try {
    const { data, porBase } = await buscarIncineracao(req.filtrosIncineracao);
    res.json({ success: true, total: data.length, porBase, filtros: req.filtrosIncineracao, data });
  } catch (err) { next(err); } finally { req.releaseReadSlot(); }
});

module.exports = router;


