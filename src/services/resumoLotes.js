const Decimal = require('decimal.js');
function decimal(value) {
  if (value === null || value === undefined || value === '') return new Decimal(0);
  const d = new Decimal(value);
  if (!d.isFinite()) throw new Error('Valor numérico inválido no retorno de lotes.');
  return d;
}
const CONTADORES = ['total_lotes','lotes_sem_vencimento','lotes_vencidos','lotes_vencem_30d','lotes_vencem_60d','lotes_vencem_90d','lotes_sem_cadastro_produto','lotes_sem_planilha'];
const QUANTIDADES = ['estoque_total','estoque_vencido','estoque_vence_30d','estoque_vence_60d','estoque_vence_90d'];
/**
 * Recebe os grupos (uf, empresa) já agregados pelo SQL Server e monta o envelope:
 * totais gerais + por UF + por empresa. Contagens distintas (produtos/fornecedores)
 * não são somadas entre grupos porque somar distintos de grupos diferentes é incorreto.
 */
function summarize(grupos, filtros) {
  const geral = {};
  for (const k of CONTADORES) geral[k] = 0;
  for (const k of QUANTIDADES) geral[k] = new Decimal(0);
  const porUf = new Map();
  const porEmpresa = [];
  for (const g of grupos) {
    const uf = g.uf ?? 'Desconhecido';
    if (!porUf.has(uf)) {
      const acc = { uf };
      for (const k of CONTADORES) acc[k] = 0;
      for (const k of QUANTIDADES) acc[k] = new Decimal(0);
      porUf.set(uf, acc);
    }
    const acc = porUf.get(uf);
    for (const k of CONTADORES) { const v = Number(g[k] ?? 0); acc[k] += v; geral[k] += v; }
    for (const k of QUANTIDADES) { const v = decimal(g[k]); acc[k] = acc[k].plus(v); geral[k] = geral[k].plus(v); }
    const linha = { uf, empresa: g.empresa, produtos_distintos: Number(g.produtos_distintos ?? 0), fornecedores_distintos: Number(g.fornecedores_distintos ?? 0) };
    for (const k of CONTADORES) linha[k] = Number(g[k] ?? 0);
    for (const k of QUANTIDADES) linha[k] = Number(decimal(g[k]).toFixed(3));
    porEmpresa.push(linha);
  }
  const fechar = obj => { for (const k of QUANTIDADES) obj[k] = Number(obj[k].toFixed(3)); return obj; };
  return {
    success: true,
    filtros,
    referencia: new Date().toISOString().slice(0, 10),
    geral: fechar(geral),
    porUf: Array.from(porUf.values(), fechar),
    porEmpresa,
  };
}
module.exports = { summarize };
