const express = require('express');
const {buscarLotes,resumirLotes} = require('../services/lotesQuery');
const {summarize} = require('../services/resumoLotes');
const {requireAuth} = require('../middleware/auth');
const {validateFiltros,validatePaginacao,limitReads} = require('../middleware/readLimits');
const router=express.Router();
router.use(requireAuth);
/**
 * GET /estoque/lotes
 * Filtros opcionais: uf, empresa, produto, ean, lote, fornecedor, vencimentoDe, vencimentoAte, somenteComEstoque.
 * Paginação: page (>=1), pageSize (<= API_MAX_PAGE_SIZE). total é o total filtrado, não da página.
 * A tabela é viva: entre páginas o estoque pode mudar; para foto consistente consumir rápido ou usar poucas páginas.
 */
router.get('/lotes',validateFiltros,validatePaginacao,limitReads,async(req,res,next)=>{
  try {
    const {rows,total}=await buscarLotes(req.filtros,req.paginacao);
    const {page,pageSize}=req.paginacao;
    res.json({success:true,total,page,pageSize,totalPaginas:Math.max(1,Math.ceil(total/pageSize)),filtros:req.filtros,data:rows});
  } catch(err) {next(err);} finally {req.releaseReadSlot();}
});
/**
 * GET /estoque/lotes/resumo — agregação por UF/empresa feita no SQL Server (mesmos filtros, sem paginação).
 */
router.get('/lotes/resumo',validateFiltros,limitReads,async(req,res,next)=>{
  try {
    const grupos=await resumirLotes(req.filtros);
    res.json(summarize(grupos,req.filtros));
  } catch(err) {next(err);} finally {req.releaseReadSlot();}
});
module.exports=router;
