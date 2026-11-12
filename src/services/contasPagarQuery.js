const { getPool, sql } = require('../config/sqlServer');
const logger = require('../config/logger');
const { databaseName, getDatabases } = require('../config/settings');

/**
 * Contas a pagar (MIX-AL.ContasPagar + Fornecedor).
 * Filtros e paginação sempre como parâmetros SQL; nada da requisição é interpolado.
 * Datas de filtro chegam como 'YYYY-MM-DD' (varchar) e são convertidas no SQL (estilo 23).
 *
 * Mapa de colunas (consulta recebida -> API):
 *   Empresa -> empresa | Fornecedor -> fornecedor | Prazo -> prazo | [Lead Time] -> lead_time
 *   [Cod. Fornecedor] -> codigo_fornecedor | [Tipo Fornecedor] -> tipo_fornecedor
 *   [Data Emissão] -> data_emissao | [Data Vencimento] -> data_vencimento
 *   Valor -> valor | [Data Entrada] -> data_entrada
 */
function buildContasPagarQuery(dbAl) {
  databaseName(dbAl);
  const al = `[${dbAl}].dbo`;
  return `
WITH base AS (
    SELECT
        cp.Empresa_tpg        AS empresa,
        f.Abrev_For           AS fornecedor,
        f.Prazo_For           AS prazo,
        f.PrazoEntreg_For     AS lead_time,
        cp.Fornecedor_tpg     AS codigo_fornecedor,
        cp.Tipo_tpg           AS tipo_fornecedor,
        cp.Emissao_tpg        AS emissao_dt,
        cp.Vencimento_tpg     AS vencimento_dt,
        cp.Valor_tpg          AS valor,
        cp.DataEntrada_Tpg    AS entrada_dt
    FROM ${al}.ContasPagar cp
    INNER JOIN ${al}.Fornecedor f
        ON f.ID_for = cp.Fornecedor_tpg
    WHERE (@empresa IS NULL OR CAST(cp.Empresa_tpg AS varchar(30)) = @empresa)
      AND (@fornecedor IS NULL OR CAST(cp.Fornecedor_tpg AS varchar(30)) = @fornecedor)
      AND (@tipo IS NULL OR CAST(cp.Tipo_tpg AS varchar(30)) = @tipo)
      AND (@vencimentoDe  IS NULL OR cp.Vencimento_tpg >= CONVERT(date, @vencimentoDe, 23))
      AND (@vencimentoAte IS NULL OR cp.Vencimento_tpg <  DATEADD(day, 1, CONVERT(date, @vencimentoAte, 23)))
      AND (@emissaoDe     IS NULL OR cp.Emissao_tpg    >= CONVERT(date, @emissaoDe, 23))
      AND (@emissaoAte    IS NULL OR cp.Emissao_tpg    <  DATEADD(day, 1, CONVERT(date, @emissaoAte, 23)))
)
SELECT
    empresa, fornecedor, prazo, lead_time, codigo_fornecedor, tipo_fornecedor,
    CONVERT(varchar(10), TRY_CONVERT(date, emissao_dt), 23)     AS data_emissao,
    CONVERT(varchar(10), TRY_CONVERT(date, vencimento_dt), 23)  AS data_vencimento,
    valor,
    CONVERT(varchar(10), TRY_CONVERT(date, entrada_dt), 23)     AS data_entrada,
    COUNT(*) OVER()                                             AS total_registros
FROM base
-- TODO: fechar com a PK de ContasPagar para paginação estável.
ORDER BY vencimento_dt, empresa, codigo_fornecedor, emissao_dt, valor
OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY
OPTION (RECOMPILE);
`;
}

let sqlCache = null;
function cachedQuery() {
  const { AL } = getDatabases();
  if (!sqlCache || sqlCache.key !== AL) sqlCache = { key: AL, sql: buildContasPagarQuery(AL) };
  return sqlCache.sql;
}

async function buscarContasPagar(filtros, paginacao) {
  const pool = await getPool();
  const request = pool.request();
  request.input('empresa', sql.VarChar(30), filtros.empresa ?? null);
  request.input('fornecedor', sql.VarChar(30), filtros.fornecedor ?? null);
  request.input('tipo', sql.VarChar(30), filtros.tipo ?? null);
  request.input('vencimentoDe', sql.VarChar(10), filtros.vencimentoDe ?? null);
  request.input('vencimentoAte', sql.VarChar(10), filtros.vencimentoAte ?? null);
  request.input('emissaoDe', sql.VarChar(10), filtros.emissaoDe ?? null);
  request.input('emissaoAte', sql.VarChar(10), filtros.emissaoAte ?? null);
  request.input('offset', sql.Int, (paginacao.page - 1) * paginacao.pageSize);
  request.input('pageSize', sql.Int, paginacao.pageSize);
  const start = Date.now();
  const result = await request.query(cachedQuery());
  const rows = result.recordset;
  const total = rows.length ? Number(rows[0].total_registros) : 0;
  for (const row of rows) delete row.total_registros;
  logger.debug('Consulta contas a pagar', { filtros, ...paginacao, linhas: rows.length, total, durationMs: Date.now() - start });
  return { rows, total };
}

module.exports = { buildContasPagarQuery, buscarContasPagar };
