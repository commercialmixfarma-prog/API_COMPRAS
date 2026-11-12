const express = require('express');
const { query, validationResult, matchedData } = require('express-validator');
const { buscarContasPagar, BASES_CONTAS_PAGAR } = require('../services/contasPagarQuery');
const { requireAuth } = require('../middleware/auth');
const { validatePaginacao, limitReads } = require('../middleware/readLimits');
const router = express.Router();
router.use(requireAuth);

const codigo = campo => query(campo).optional().isString().trim().matches(/^[A-Za-z0-9 ._-]{1,30}$/);
const data = campo => query(campo).optional().matches(/^\d{4}-\d{2}-\d{2}$/).isISO8601({ strict: true });

const validateContasPagar = [
  query('base').optional().isString().trim().toUpperCase().isIn(BASES_CONTAS_PAGAR),
  codigo('empresa'), codigo('fornecedor'), codigo('tipo'),
  data('vencimentoDe'), data('vencimentoAte'), data('emissaoDe'), data('emissaoAte'),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ erro: 'Dados inválidos.', detalhes: errors.array().map(e => ({ campo: e.path, mensagem: e.msg })) });
    }
    const f = matchedData(req, { locations: ['query'] });
    // Strings ISO 'YYYY-MM-DD' comparam corretamente em ordem lexicográfica.
    if ((f.vencimentoDe && f.vencimentoAte && f.vencimentoDe > f.vencimentoAte) ||
        (f.emissaoDe && f.emissaoAte && f.emissaoDe > f.emissaoAte)) {
      return res.status(400).json({ erro: 'Dados inválidos.', detalhes: [{ campo: 'periodo', mensagem: 'Data inicial maior que a final.' }] });
    }
    req.filtrosContasPagar = f;
    next();
  },
];

/**
 * GET /contaspagar
 * Filtros opcionais: base (AL | SE), empresa, fornecedor, tipo,
 * vencimentoDe, vencimentoAte, emissaoDe, emissaoAte (YYYY-MM-DD).
 * Paginação: page, pageSize (mesmas regras de /estoque/lotes).
 */
router.get('/', validateContasPagar, validatePaginacao, limitReads, async (req, res, next) => {
  try {
    const { rows, total } = await buscarContasPagar(req.filtrosContasPagar, req.paginacao);
    const { page, pageSize } = req.paginacao;
    res.json({ success: true, total, page, pageSize, totalPaginas: Math.max(1, Math.ceil(total / pageSize)), filtros: req.filtrosContasPagar, data: rows });
  } catch (err) { next(err); } finally { req.releaseReadSlot(); }
});

module.exports = router;
