const express = require('express');
const { query, validationResult, matchedData } = require('express-validator');
const { buscarPedidosCompra, BASES_PEDIDOS_COMPRA } = require('../services/pedidosCompraQuery');
const { requireAuth } = require('../middleware/auth');
const { validatePaginacao, limitReads } = require('../middleware/readLimits');
const router = express.Router();
router.use(requireAuth);

const codigo = campo => query(campo).optional().isString().trim().matches(/^[A-Za-z0-9 ._-]{1,30}$/);
const inteiro = campo => query(campo).optional().isInt({ min: 0, max: 2147483647 }).toInt();
const data = campo => query(campo).optional().matches(/^\d{4}-\d{2}-\d{2}$/).isISO8601({ strict: true });

const validatePedidosCompra = [
  query('base').optional().isString().trim().toUpperCase().isIn(BASES_PEDIDOS_COMPRA),
  codigo('empresa'), codigo('fornecedor'), codigo('produto'),
  inteiro('pedido'), inteiro('status'),
  data('dataDe'), data('dataAte'),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ erro: 'Dados inválidos.', detalhes: errors.array().map(e => ({ campo: e.path, mensagem: e.msg })) });
    }
    const f = matchedData(req, { locations: ['query'] });
    // Strings ISO 'YYYY-MM-DD' comparam corretamente em ordem lexicográfica.
    if (f.dataDe && f.dataAte && f.dataDe > f.dataAte) {
      return res.status(400).json({ erro: 'Dados inválidos.', detalhes: [{ campo: 'periodo', mensagem: 'Data inicial maior que a final.' }] });
    }
    req.filtrosPedidosCompra = f;
    next();
  },
];

/**
 * GET /pedidoscompra
 * Uma linha por ITEM de pedido (cabeçalho repetido). `total` conta itens, não pedidos.
 * Filtros opcionais: base (AL | SE), empresa, pedido, fornecedor (do cabeçalho), produto,
 * status (código numérico), dataDe, dataAte (data do pedido, YYYY-MM-DD).
 * Paginação: page, pageSize (mesmas regras de /estoque/lotes).
 */
router.get('/', validatePedidosCompra, validatePaginacao, limitReads, async (req, res, next) => {
  try {
    const { rows, total } = await buscarPedidosCompra(req.filtrosPedidosCompra, req.paginacao);
    const { page, pageSize } = req.paginacao;
    res.json({ success: true, total, page, pageSize, totalPaginas: Math.max(1, Math.ceil(total / pageSize)), filtros: req.filtrosPedidosCompra, data: rows });
  } catch (err) { next(err); } finally { req.releaseReadSlot(); }
});

module.exports = router;
