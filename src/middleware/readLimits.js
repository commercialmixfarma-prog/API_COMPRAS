const { intEnv, UFS_ESTOQUE } = require('../config/settings');

function parseDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10) !== value) return null;
  if (Number(value.slice(0,4)) < 1) return null;
  return parsed;
}
// Identificadores simples (código, EAN, empresa, fornecedor): sem espaço, aspas ou curinga.
const ID_RE = /^[A-Za-z0-9._-]{1,30}$/;
// Lote: cadastro livre no ERP, aceitar caracteres imprimíveis comuns e limitar tamanho.
const LOTE_RE = /^[A-Za-z0-9 ._\/-]{1,60}$/;

function str(q, name) {
  const v = q[name];
  if (v === undefined || v === '') return undefined;
  return typeof v === 'string' ? v.trim() : Symbol.for('invalido');
}
/**
 * Valida filtros opcionais da query string e deixa em req.filtros.
 * Sem filtro => consulta completa (todas as UFs). Nunca repassa texto cru ao SQL.
 */
function validateFiltros(req,res,next) {
  const erros = [], f = {};
  const uf = str(req.query,'uf');
  if (uf !== undefined) {
    const up = typeof uf === 'string' ? uf.toUpperCase() : uf;
    if (!UFS_ESTOQUE.includes(up)) erros.push(`uf deve ser um de: ${UFS_ESTOQUE.join(', ')}.`); else f.uf = up;
  }
  for (const name of ['empresa','produto','ean','fornecedor']) {
    const v = str(req.query,name);
    if (v === undefined) continue;
    if (typeof v !== 'string' || !ID_RE.test(v)) erros.push(`${name} inválido (até 30 caracteres alfanuméricos).`); else f[name] = v;
  }
  const lote = str(req.query,'lote');
  if (lote !== undefined) {
    if (typeof lote !== 'string' || !LOTE_RE.test(lote)) erros.push('lote inválido (até 60 caracteres).'); else f.lote = lote;
  }
  for (const name of ['vencimentoDe','vencimentoAte']) {
    const v = str(req.query,name);
    if (v === undefined) continue;
    if (typeof v !== 'string' || !parseDate(v)) erros.push(`${name} deve ser uma data real no formato YYYY-MM-DD.`); else f[name] = v;
  }
  if (f.vencimentoDe && f.vencimentoAte && f.vencimentoAte < f.vencimentoDe) erros.push('vencimentoAte deve ser igual ou posterior a vencimentoDe.');
  const sce = str(req.query,'somenteComEstoque');
  if (sce !== undefined) {
    if (sce !== 'true' && sce !== 'false') erros.push('somenteComEstoque deve ser true ou false.'); else f.somenteComEstoque = sce === 'true';
  }
  if (erros.length) return res.status(400).json({success:false,error:erros.join(' ')});
  req.filtros = f;
  next();
}
function validatePaginacao(req,res,next) {
  const maxPage = intEnv('API_MAX_PAGE_SIZE',20000,1,100000);
  const defPage = intEnv('API_DEFAULT_PAGE_SIZE',5000,1,100000);
  const page = req.query.page === undefined ? '1' : req.query.page;
  const pageSize = req.query.pageSize === undefined ? String(defPage) : req.query.pageSize;
  if (typeof page !== 'string' || !/^\d{1,7}$/.test(page) || Number(page) < 1) return res.status(400).json({success:false,error:'page deve ser um inteiro a partir de 1.'});
  if (typeof pageSize !== 'string' || !/^\d{1,6}$/.test(pageSize) || Number(pageSize) < 1 || Number(pageSize) > maxPage) return res.status(400).json({success:false,error:`pageSize deve ser um inteiro entre 1 e ${maxPage}.`});
  req.paginacao = { page: Number(page), pageSize: Number(pageSize) };
  next();
}
// Limite por processo e somente sobre consultas HTTP de estoque. Não é lock distribuído.
let active = 0;
function limitReads(req,res,next) {
  const max = intEnv('API_MAX_CONCURRENT_READS',2,1,20);
  if (active >= max) {
    res.set('Retry-After','5');
    return res.status(503).json({success:false,error:'Consultas simultâneas no limite. Tente novamente após alguns segundos.'});
  }
  active++;
  // Soltar no fim do handler, não no close do cliente: o SQL pode continuar rodando.
  let released = false;
  req.releaseReadSlot = () => { if (!released) { released = true; active--; } };
  next();
}
module.exports = {validateFiltros,validatePaginacao,limitReads,parseDate};
