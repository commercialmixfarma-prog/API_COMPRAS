const { getPool, sql } = require('../config/sqlServer');
const logger = require('../config/logger');
const { databaseName, getDatabases, UFS_ESTOQUE } = require('../config/settings');

/**
 * Consulta de estoque por lote (NextLotes) — UMA execução cobre todas as UFs.
 *
 * Diferente da API de vendas (uma UF por execução), aqui a própria consulta já
 * cruza MIX-AL e MIX-SE na mesma instrução: NextLotes mora em MIX-AL e carrega a
 * coluna UF (AL, AL-FILIAL, PE, SE); Produtos/Fornecedor/Planilha são resolvidos
 * por LEFT JOIN condicionado à UF da linha. Rodar em duas partes exigiria
 * reescrever a lógica de negócio recebida; preferimos preservá-la.
 *
 * A consulta original fica na CTE `lotes`, verbatim exceto por:
 *   - nomes de banco vindos de configuração validada por allowlist;
 *   - aliases de saída em snake_case sem espaço/acento (ver mapa abaixo);
 *   - Vencimento e [Data Entrada] convertidos para 'YYYY-MM-DD' (TRY_CONVERT),
 *     evitando deslocamento de fuso na serialização JSON;
 *   - coluna derivada dias_para_vencer (negativo = vencido, NULL = sem data).
 *
 * Filtros e paginação são aplicados POR FORA, sempre como parâmetros SQL.
 * Nenhum texto vindo da requisição HTTP é interpolado.
 *
 * Mapa de colunas (consulta recebida -> API):
 *   Empresa -> empresa | UF -> uf | Código -> codigo | EAN -> ean | Lote -> lote
 *   Vencimento -> vencimento | [Data Entrada] -> data_entrada | Estoque -> estoque
 *   [Nome Produto] -> nome_produto | codigo_fornecedor -> codigo_fornecedor
 *   Fornecedor -> fornecedor | UFO -> ufo | DDE -> dde | [Tabela Imp] -> tabela_imp
 *   Substancia -> substancia | Media -> media | PF -> pf | [PC.Custo] -> pc_custo
 *   [% Custo ICM] -> pct_custo_icm | Tipo -> tipo
 */
function buildCte(dbAl, dbSe) {
  databaseName(dbAl); databaseName(dbSe);
  const al = `[${dbAl}].dbo`, se = `[${dbSe}].dbo`;
  return `
WITH lotes AS (
    SELECT
        nl.Empresa                                                       AS empresa,
        nl.UF                                                            AS uf,
        nl.Produto                                                       AS codigo,
        nl.EAN                                                           AS ean,
        nl.Lote                                                          AS lote,
        TRY_CONVERT(date, nl.Vencimento)                                 AS vencimento_data,
        TRY_CONVERT(date, nl.[Data Entrada])                             AS data_entrada_data,
        nl.Estoque                                                       AS estoque,
        COALESCE(p_al.descricao_pro, p_se.descricao_pro)                 AS nome_produto,
        COALESCE(f_al.ID_for, f_se.ID_for)                               AS codigo_fornecedor,
        COALESCE(f_al.abrev_for, f_se.abrev_for)                         AS fornecedor,
        COALESCE(pdpma.UFO, pdpfa.UFO, pdpmp.UFO, pdps.UFO)              AS ufo,
        COALESCE(pdpma.DDE, pdpfa.DDE, pdpmp.DDE, pdps.DDE)              AS dde,
        COALESCE(pdpma.[Tabela Imp], pdpfa.[Tabela Imp], pdpmp.[Tabela Imp], pdps.[Tabela Imp]) AS tabela_imp,
        COALESCE(pdpma.Substancia, pdpfa.Substancia, pdpmp.Substancia, pdps.Substancia)         AS substancia,
        COALESCE(pdpma.Media, pdpfa.Media, pdpmp.Media, pdps.Media)      AS media,
        COALESCE(pdpma.PF, pdpfa.PF, pdpmp.PF, pdps.PF)                  AS pf,
        COALESCE(pdpma.[PC.Custo], pdpfa.[PC.Custo], pdpmp.[PC.Custo], pdps.[PC.Custo])         AS pc_custo,
        COALESCE(pdpma.[% Custo ICM], pdpfa.[% Custo ICM], pdpmp.[% Custo ICM], pdps.[% Custo ICM]) AS pct_custo_icm,
        COALESCE(pdpma.Tipo, pdpfa.Tipo, pdpmp.Tipo, pdps.Tipo)          AS tipo
    FROM ${al}.NextLotes nl

    -- Produtos: MIX-AL para AL / AL-FILIAL / PE, MIX-SE apenas para SE
    LEFT JOIN ${al}.Produtos p_al
        ON p_al.codbarra_pro = nl.EAN
        AND nl.UF <> 'SE'
    LEFT JOIN ${se}.Produtos p_se
        ON p_se.codbarra_pro = nl.EAN
        AND nl.UF = 'SE'

    -- Fornecedor: mesma lógica, ligado ao Produtos correspondente
    LEFT JOIN ${al}.Fornecedor f_al
        ON f_al.ID_for = p_al.fornec_pro
        AND nl.UF <> 'SE'
    LEFT JOIN ${se}.Fornecedor f_se
        ON f_se.ID_for = p_se.fornec_pro
        AND nl.UF = 'SE'

    -- Planilhas: uma por UF
    LEFT JOIN ${al}.PlanilhaDadosPro01_MTZ_AL pdpma
        ON pdpma.EAN = nl.EAN
        AND pdpma.Código = nl.Produto
        AND nl.UF = 'AL'
    LEFT JOIN ${al}.PlanilhaDadosPro01_FIL_AL pdpfa
        ON pdpfa.EAN = nl.EAN
        AND pdpfa.Código = nl.Produto
        AND nl.UF = 'AL-FILIAL'
    LEFT JOIN ${al}.PlanilhaDadosPro01_MTZ_PE pdpmp
        ON pdpmp.EAN = nl.EAN
        AND pdpmp.Código = nl.Produto
        AND nl.UF = 'PE'
    LEFT JOIN ${se}.PlanilhaDadosPro01_SE pdps
        ON pdps.EAN = nl.EAN
        AND pdps.Código = nl.Produto
        AND nl.UF = 'SE'
),
filtrado AS (
    SELECT l.*
    FROM lotes l
    WHERE (@uf IS NULL OR l.uf = @uf)
      AND (@empresa IS NULL OR CAST(l.empresa AS varchar(30)) = @empresa)
      AND (@produto IS NULL OR CAST(l.codigo AS varchar(30)) = @produto)
      AND (@ean IS NULL OR CAST(l.ean AS varchar(30)) = @ean)
      AND (@lote IS NULL OR l.lote = @lote)
      AND (@fornecedor IS NULL OR CAST(l.codigo_fornecedor AS varchar(30)) = @fornecedor)
      AND (@vencimentoDe IS NULL OR l.vencimento_data >= @vencimentoDe)
      AND (@vencimentoAte IS NULL OR l.vencimento_data <= @vencimentoAte)
      AND (@somenteComEstoque = 0 OR l.estoque > 0)
)`;
}

function buildLotesQuery(dbAl, dbSe) {
  return `${buildCte(dbAl, dbSe)}
SELECT
    empresa, uf, codigo, ean, lote,
    CONVERT(varchar(10), vencimento_data, 23)                            AS vencimento,
    CONVERT(varchar(10), data_entrada_data, 23)                          AS data_entrada,
    DATEDIFF(day, CAST(GETDATE() AS date), vencimento_data)              AS dias_para_vencer,
    estoque, nome_produto, codigo_fornecedor, fornecedor,
    ufo, dde, tabela_imp, substancia, media, pf, pc_custo, pct_custo_icm, tipo,
    COUNT(*) OVER()                                                      AS total_registros
FROM filtrado
ORDER BY uf, empresa, codigo, ean, lote, vencimento_data
OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY;
`;
}

/**
 * Resumo agregado no próprio SQL Server (não carrega as linhas no Node).
 * Janelas de vencimento são cumulativas a partir de hoje: 30 ⊂ 60 ⊂ 90 dias.
 */
function buildResumoQuery(dbAl, dbSe) {
  return `${buildCte(dbAl, dbSe)},
hoje AS (SELECT CAST(GETDATE() AS date) AS d)
SELECT
    f.uf, f.empresa,
    COUNT(*)                                                             AS total_lotes,
    SUM(CAST(f.estoque AS decimal(18,3)))                                AS estoque_total,
    COUNT(DISTINCT f.codigo)                                             AS produtos_distintos,
    COUNT(DISTINCT f.codigo_fornecedor)                                  AS fornecedores_distintos,
    SUM(CASE WHEN f.vencimento_data IS NULL THEN 1 ELSE 0 END)           AS lotes_sem_vencimento,
    SUM(CASE WHEN f.vencimento_data <  h.d THEN 1 ELSE 0 END)            AS lotes_vencidos,
    SUM(CASE WHEN f.vencimento_data <  h.d THEN CAST(f.estoque AS decimal(18,3)) ELSE 0 END) AS estoque_vencido,
    SUM(CASE WHEN f.vencimento_data >= h.d AND f.vencimento_data < DATEADD(day,30,h.d) THEN 1 ELSE 0 END) AS lotes_vencem_30d,
    SUM(CASE WHEN f.vencimento_data >= h.d AND f.vencimento_data < DATEADD(day,60,h.d) THEN 1 ELSE 0 END) AS lotes_vencem_60d,
    SUM(CASE WHEN f.vencimento_data >= h.d AND f.vencimento_data < DATEADD(day,90,h.d) THEN 1 ELSE 0 END) AS lotes_vencem_90d,
    SUM(CASE WHEN f.vencimento_data >= h.d AND f.vencimento_data < DATEADD(day,30,h.d) THEN CAST(f.estoque AS decimal(18,3)) ELSE 0 END) AS estoque_vence_30d,
    SUM(CASE WHEN f.vencimento_data >= h.d AND f.vencimento_data < DATEADD(day,60,h.d) THEN CAST(f.estoque AS decimal(18,3)) ELSE 0 END) AS estoque_vence_60d,
    SUM(CASE WHEN f.vencimento_data >= h.d AND f.vencimento_data < DATEADD(day,90,h.d) THEN CAST(f.estoque AS decimal(18,3)) ELSE 0 END) AS estoque_vence_90d,
    SUM(CASE WHEN f.nome_produto IS NULL THEN 1 ELSE 0 END)              AS lotes_sem_cadastro_produto,
    SUM(CASE WHEN f.ufo IS NULL AND f.dde IS NULL AND f.pf IS NULL AND f.tipo IS NULL THEN 1 ELSE 0 END) AS lotes_sem_planilha
FROM filtrado f
CROSS JOIN hoje h
GROUP BY f.uf, f.empresa
ORDER BY f.uf, f.empresa;
`;
}

const sqlCache = new Map();
function cached(kind, builder) {
  const { AL, SE } = getDatabases();
  const key = `${kind}:${AL}:${SE}`;
  if (!sqlCache.has(key)) sqlCache.set(key, builder(AL, SE));
  return sqlCache.get(key);
}

/**
 * filtros: objeto já validado por middleware (readLimits.validateFiltros).
 * Campos ausentes viram NULL no SQL (filtro desligado).
 */
function bindFiltros(request, filtros) {
  request.input('uf', sql.NVarChar(20), filtros.uf ?? null);
  request.input('empresa', sql.VarChar(30), filtros.empresa ?? null);
  request.input('produto', sql.VarChar(30), filtros.produto ?? null);
  request.input('ean', sql.VarChar(30), filtros.ean ?? null);
  request.input('lote', sql.NVarChar(60), filtros.lote ?? null);
  request.input('fornecedor', sql.VarChar(30), filtros.fornecedor ?? null);
  request.input('vencimentoDe', sql.Date, filtros.vencimentoDe ?? null);
  request.input('vencimentoAte', sql.Date, filtros.vencimentoAte ?? null);
  request.input('somenteComEstoque', sql.Bit, filtros.somenteComEstoque ? 1 : 0);
}

async function buscarLotes(filtros, paginacao) {
  const pool = await getPool();
  const request = pool.request();
  bindFiltros(request, filtros);
  request.input('offset', sql.Int, (paginacao.page - 1) * paginacao.pageSize);
  request.input('pageSize', sql.Int, paginacao.pageSize);
  const start = Date.now();
  const result = await request.query(cached('lotes', buildLotesQuery));
  const rows = result.recordset;
  const total = rows.length ? Number(rows[0].total_registros) : 0;
  for (const row of rows) delete row.total_registros;
  logger.debug('Consulta de lotes', { filtros, ...paginacao, linhas: rows.length, total, durationMs: Date.now() - start });
  return { rows, total };
}

async function resumirLotes(filtros) {
  const pool = await getPool();
  const request = pool.request();
  bindFiltros(request, filtros);
  const start = Date.now();
  const result = await request.query(cached('resumo', buildResumoQuery));
  logger.debug('Resumo de lotes', { filtros, grupos: result.recordset.length, durationMs: Date.now() - start });
  return result.recordset;
}

module.exports = { buildLotesQuery, buildResumoQuery, buscarLotes, resumirLotes, UFS_ESTOQUE };
