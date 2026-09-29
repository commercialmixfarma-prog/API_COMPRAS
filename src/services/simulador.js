const { getPool } = require('../config/sqlServer');
const logger = require('../config/logger');
const { databaseName, getDatabases } = require('../config/settings');

/**
 * Consulta do simulador: consolida 4 views (uma por UF) direto do SQL Server,
 * SELECT * + coluna UF literal. Sem filtro e sem paginação.
 * Nomes de banco vêm de configuração validada; nada da requisição entra no SQL.
 */
function buildSimuladorQuery(dbAl, dbSe) {
  databaseName(dbAl); databaseName(dbSe);
  const al = `[${dbAl}].dbo`, se = `[${dbSe}].dbo`;
  return `
SELECT *, 'AL F' AS UF FROM ${al}.PlanilhaDadosPro01_FIL_AL
UNION ALL
SELECT *, 'AL'   AS UF FROM ${al}.PlanilhaDadosPro01_MTZ_AL
UNION ALL
SELECT *, 'PE'   AS UF FROM ${al}.PlanilhaDadosPro01_MTZ_PE
UNION ALL
SELECT *, 'SE'   AS UF FROM ${se}.PlanilhaDadosPro01_SE;
`;
}

let sqlCache = null;
function cachedQuery() {
  const { AL, SE } = getDatabases();
  const key = `${AL}:${SE}`;
  if (!sqlCache || sqlCache.key !== key) sqlCache = { key, sql: buildSimuladorQuery(AL, SE) };
  return sqlCache.sql;
}

async function buscarSimulador() {
  const pool = await getPool();
  const start = Date.now();
  const result = await pool.request().query(cachedQuery());
  logger.debug('Consulta simulador', { linhas: result.recordset.length, durationMs: Date.now() - start });
  return result.recordset;
}

module.exports = { buildSimuladorQuery, buscarSimulador };
