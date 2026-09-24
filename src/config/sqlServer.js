const sql = require('mssql');
const logger = require('./logger');
const { intEnv, boolEnv, databaseName } = require('./settings');

function buildConfig() {
  for (const key of ['SQLSERVER_HOST','SQLSERVER_USER','SQLSERVER_PASSWORD']) {
    if (!process.env[key]) throw new Error(`Falta configurar ${key}.`);
  }
  return {
    server: process.env.SQLSERVER_HOST,
    port: intEnv('SQLSERVER_PORT',1433,1,65535),
    database: databaseName(process.env.SQLSERVER_DATABASE || 'master'),
    user: process.env.SQLSERVER_USER,
    password: process.env.SQLSERVER_PASSWORD,
    connectionTimeout: intEnv('SQLSERVER_CONNECTION_TIMEOUT_MS',30000,1000,120000),
    requestTimeout: intEnv('SQLSERVER_REQUEST_TIMEOUT_MS',120000,1000,600000),
    options: {
      encrypt: boolEnv('SQLSERVER_ENCRYPT',true),
      // Excecao autorizada pelo TI em 14/09/2026, conforme solicitacao do responsavel.
      // Mantem encrypt independente; dispensa validacao de identidade/cadeia apenas no SQL Server.
      trustServerCertificate: true,
      enableArithAbort: true,
    },
    pool: { max:intEnv('SQLSERVER_POOL_MAX',3,1,20), min:0, idleTimeoutMillis:30000 },
  };
}
let poolPromise = null;
function getPool() {
  if (poolPromise) {
    const current = poolPromise;
    return current.then(async pool => {
      if (pool.connected) return pool;
      if (poolPromise === current) {
        poolPromise = null;
        try { await pool.close(); } catch (_) { /* pool já desconectado */ }
      }
      return getPool();
    });
  }
  const pending = Promise.resolve().then(async () => {
    const pool = new sql.ConnectionPool(buildConfig());
    pool.on('error', err => logger.error('Erro no pool SQL Server', {error:err.message}));
    try {
      await pool.connect();
      logger.info('Pool SQL Server conectado.');
      return pool;
    } catch (err) {
      try { await pool.close(); } catch (_) { /* preservar erro da conexão */ }
      throw err;
    }
  });
  poolPromise = pending;
  pending.catch(() => { if (poolPromise === pending) poolPromise = null; });
  return pending;
}
async function closeAllPools() {
  const pending = poolPromise;
  poolPromise = null;
  if (!pending) return;
  try { const pool = await pending; await pool.close(); }
  catch (err) { logger.warn('Erro ao fechar pool SQL Server', {error:err.message}); }
}
module.exports = { getPool, closeAllPools, sql, buildConfig };
