function intEnv(name, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) {
  const raw = process.env[name] ?? String(fallback);
  if (!/^\d+$/.test(raw)) throw new Error(`${name} deve ser um inteiro entre ${min} e ${max}.`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${name} fora do intervalo ${min}..${max}.`);
  return value;
}
function boolEnv(name, fallback = false) {
  const value = process.env[name] ?? String(fallback);
  if (!['true', 'false'].includes(value)) throw new Error(`${name} deve ser true ou false.`);
  return value === 'true';
}
function databaseName(value) {
  // Identificadores não são parâmetros SQL: aceitar somente nomes administrativos simples.
  if (typeof value !== 'string' || !/^[A-Za-z0-9_ -]{1,128}$/.test(value) || !value.trim()) {
    throw new Error('Nome de database inválido; use letras, números, espaço, hífen ou underscore.');
  }
  return value;
}
/**
 * A consulta de lotes cruza os DOIS bancos numa única instrução
 * (NextLotes fica em MIX-AL; Produtos/Fornecedor/Planilha vêm de MIX-AL ou MIX-SE
 * conforme a UF da linha). Por isso os dois nomes são obrigatórios e fixos.
 */
function getDatabases() {
  const al = process.env.SQLSERVER_AL_DATABASE, se = process.env.SQLSERVER_SE_DATABASE;
  if (!al) throw new Error('Falta configurar SQLSERVER_AL_DATABASE.');
  if (!se) throw new Error('Falta configurar SQLSERVER_SE_DATABASE.');
  return { AL: databaseName(al), SE: databaseName(se) };
}
/**
 * Valores da coluna NextLotes.UF tratados pela consulta. Não é configurável por env
 * porque cada valor está amarrado a uma tabela PlanilhaDadosPro01_* específica no SQL.
 */
const UFS_ESTOQUE = Object.freeze(['AL', 'AL-FILIAL', 'PE', 'SE']);
const AUTH_SCOPE = 'estoque:read';

function validateStartup() {
  for (const key of ['SQLSERVER_HOST','SQLSERVER_USER','SQLSERVER_PASSWORD','SERVICE_CLIENT_ID','SERVICE_CLIENT_SECRET','JWT_SECRET']) {
    if (!process.env[key]) throw new Error(`Variável obrigatória não preenchida: ${key}`);
  }
  if (!/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(process.env.SERVICE_CLIENT_SECRET)) throw new Error('SERVICE_CLIENT_SECRET deve conter hash bcrypt, não senha em texto.');
  if (process.env.JWT_SECRET.length < 32) throw new Error('JWT_SECRET deve ter no mínimo 32 caracteres aleatórios.');
  const jwt = require('jsonwebtoken');
  jwt.sign({sub:'config-check'}, process.env.JWT_SECRET, {algorithm:'HS256', expiresIn:process.env.JWT_EXPIRES_IN || '1h'});
  intEnv('PORT',3001,1,65535);
  intEnv('SQLSERVER_PORT',1433,1,65535);
  intEnv('SQLSERVER_REQUEST_TIMEOUT_MS',120000,1000,600000);
  intEnv('SQLSERVER_CONNECTION_TIMEOUT_MS',30000,1000,120000);
  intEnv('SQLSERVER_POOL_MAX',3,1,20);
  intEnv('API_DEFAULT_PAGE_SIZE',5000,1,100000);
  intEnv('API_MAX_PAGE_SIZE',20000,1,100000);
  if (intEnv('API_DEFAULT_PAGE_SIZE',5000,1,100000) > intEnv('API_MAX_PAGE_SIZE',20000,1,100000)) throw new Error('API_DEFAULT_PAGE_SIZE não pode exceder API_MAX_PAGE_SIZE.');
  intEnv('API_MAX_CONCURRENT_READS',2,1,20);
  intEnv('RATE_LIMIT_WINDOW_MS',60000,1000,3600000);
  intEnv('RATE_LIMIT_MAX',100,1,100000);
  intEnv('LOGIN_RATE_LIMIT_MAX',5,1,1000);
  intEnv('TRUST_PROXY_HOPS',0,0,10);
  boolEnv('SQLSERVER_ENCRYPT',true);
  databaseName(process.env.SQLSERVER_DATABASE || 'master');
  getDatabases();
}
module.exports = { intEnv, boolEnv, databaseName, getDatabases, validateStartup, UFS_ESTOQUE, AUTH_SCOPE };
