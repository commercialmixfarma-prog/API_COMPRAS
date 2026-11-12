const { getPool } = require('../config/sqlServer');
const logger = require('../config/logger');
const { databaseName, getDatabases } = require('../config/settings');

/**
 * Produtos para incineração (view Cust_Produtos Incineração Serquipe) de MIX-AL e MIX-SE.
 * SELECT * + coluna `base` (AL | SE). Sem paginação.
 * Uma consulta por banco, concatenadas no Node: evita conflito de collation e de
 * estrutura entre as duas views, que um UNION ALL com SELECT * não toleraria.
 * Nomes de banco vêm de configuração validada; nada da requisição entra no SQL.
 */
const BASES_INCINERACAO = ['AL', 'SE'];
const VIEW = '[Cust_Lista de Produtos Incinerados e com Compra]';

function buildIncineracaoQuery(db, base) {
  databaseName(db);
  if (!BASES_INCINERACAO.includes(base)) throw new Error(`Base inválida: ${base}`);
  return `SELECT '${base}' AS base, v.* FROM [${db}].dbo.${VIEW} v;`;
}

async function buscarIncineracao(filtros = {}) {
  const dbs = getDatabases();
  const bases = filtros.base ? [filtros.base] : BASES_INCINERACAO;
  const pool = await getPool();
  const start = Date.now();
  const data = [];
  const porBase = {};
  for (const base of bases) {
    const result = await pool.request().query(buildIncineracaoQuery(dbs[base], base));
    porBase[base] = result.recordset.length;
    for (const row of result.recordset) data.push(row);
  }
  logger.debug('Consulta incineração', { filtros, porBase, linhas: data.length, durationMs: Date.now() - start });
  return { data, porBase };
}

module.exports = { buildIncineracaoQuery, buscarIncineracao, BASES_INCINERACAO };
