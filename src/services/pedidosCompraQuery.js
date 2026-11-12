const { getPool, sql } = require('../config/sqlServer');
const logger = require('../config/logger');
const { databaseName, getDatabases } = require('../config/settings');

/**
 * Pedidos de compra: CabPedidoCompras + PedidoCompras (itens) + Produtos + Fornecedor,
 * de MIX-AL e MIX-SE (UNION ALL). Granularidade: UMA LINHA POR ITEM; o cabeçalho se repete.
 * Coluna `base` indica o banco de origem (AL | SE). Chave única da linha: (base, id_item).
 * Filtros e paginação sempre como parâmetros SQL; nada da requisição é interpolado.
 *
 * Mapa de colunas (consulta recebida -> API):
 *   Empresa -> empresa | [ID PEDIDO] (Id_CabPedC) -> id_pedido | [ID PEDIDO] (id_pk) -> id_item
 *   [CÓD. FORNECEDOR] -> codigo_fornecedor | FORNECEDOR -> fornecedor
 *   [DATA DO PEDIDO] -> data_pedido | [PRAZO n] -> prazo_n
 *   [STATUS PEDIDO] -> status_pedido (+ status_codigo, valor bruto) | [DATA ENTREGA] -> data_entrega
 *   USUÁRIO -> usuario | OBSERVAÇÕES -> observacoes | [CÓD. PRODUTO] -> codigo_produto
 *   [NOME PRODUTO] -> nome_produto | EAN -> ean | QUANTIDADE -> quantidade | DESCONTO -> desconto
 */
const BASES_PEDIDOS_COMPRA = ['AL', 'SE'];
const N_PRAZOS = Array.from({ length: 10 }, (_, i) => i + 1);
const PRAZOS_ORIGEM = N_PRAZOS.map(n => `cpc.Prazo${n}_CabPedC AS prazo_${n}`).join(', ');
const PRAZOS_SAIDA = N_PRAZOS.map(n => `prazo_${n}`).join(', ');

// `db` e `base` vêm de configuração validada / constante do código, nunca da requisição.
function ramo(db, base) {
  return `
    SELECT
        '${base}'                                       AS base,
        cpc.Empresa_CabPedc                             AS empresa,
        cpc.Id_CabPedC                                  AS id_pedido,
        pc.id_pk                                        AS id_item,
        cpc.Fornecedor_CabPedC                          AS codigo_fornecedor,
        f.Abrev_for COLLATE DATABASE_DEFAULT            AS fornecedor,
        cpc.Data_CabPedC                                AS data_dt,
        ${PRAZOS_ORIGEM},
        cpc.Status_CabPedc                              AS status_codigo,
        CASE cpc.Status_CabPedc
            WHEN 1 THEN N'Pendente'
            WHEN 4 THEN N'Trânsito'
            WHEN 2 THEN N'Em Receb. Logistica'
            ELSE CAST(cpc.Status_CabPedc AS varchar(20))
        END                                             AS status_pedido,
        cpc.DataEntrega_CabPedc                         AS entrega_dt,
        cpc.Usuario_CabPedC                             AS usuario,
        cpc.obsPedidoCompra COLLATE DATABASE_DEFAULT    AS observacoes,
        pc.Produto_IPedC                                AS codigo_produto,
        p.descricao_pro COLLATE DATABASE_DEFAULT        AS nome_produto,
        p.codbarra_pro                                  AS ean,
        pc.Quantidade_IPedC                             AS quantidade,
        pc.Desconto_IPedC                               AS desconto
    FROM ${db}.CabPedidoCompras cpc
    INNER JOIN ${db}.PedidoCompras pc
        ON pc.Id_IpedC = cpc.Id_CabPedC
        AND pc.Empresa_IPedc = cpc.Empresa_CabPedc
    LEFT JOIN ${db}.Produtos p
        ON p.Id_Pro = pc.Produto_IPedC
        AND p.Empresa_Pro = pc.Empresa_IPedc
    LEFT JOIN ${db}.Fornecedor f
        ON f.ID_for = p.fornec_pro
    WHERE (@base IS NULL OR @base = '${base}')
      AND (@empresa IS NULL OR CAST(cpc.Empresa_CabPedc AS varchar(30)) = @empresa)
      AND (@pedido IS NULL OR cpc.Id_CabPedC = @pedido)
      AND (@fornecedor IS NULL OR CAST(cpc.Fornecedor_CabPedC AS varchar(30)) = @fornecedor)
      AND (@produto IS NULL OR CAST(pc.Produto_IPedC AS varchar(30)) = @produto)
      AND (@status IS NULL OR cpc.Status_CabPedc = @status)
      AND (@dataDe  IS NULL OR cpc.Data_CabPedC >= CONVERT(date, @dataDe, 23))
      AND (@dataAte IS NULL OR cpc.Data_CabPedC <  DATEADD(day, 1, CONVERT(date, @dataAte, 23)))`;
}

function buildPedidosCompraQuery(dbAl, dbSe) {
  databaseName(dbAl); databaseName(dbSe);
  return `
WITH pedidos AS (${ramo(`[${dbAl}].dbo`, 'AL')}
    UNION ALL${ramo(`[${dbSe}].dbo`, 'SE')}
)
SELECT
    base, empresa, id_pedido, id_item, codigo_fornecedor, fornecedor,
    CONVERT(varchar(10), TRY_CONVERT(date, data_dt), 23)     AS data_pedido,
    ${PRAZOS_SAIDA},
    status_codigo, status_pedido,
    CONVERT(varchar(10), TRY_CONVERT(date, entrega_dt), 23)  AS data_entrega,
    usuario, observacoes, codigo_produto, nome_produto, ean, quantidade, desconto,
    COUNT(*) OVER()                                          AS total_registros
FROM pedidos
ORDER BY base, empresa, id_pedido, id_item
OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY
OPTION (RECOMPILE);
`;
}

let sqlCache = null;
function cachedQuery() {
  const { AL, SE } = getDatabases();
  const key = `${AL}:${SE}`;
  if (!sqlCache || sqlCache.key !== key) sqlCache = { key, sql: buildPedidosCompraQuery(AL, SE) };
  return sqlCache.sql;
}

async function buscarPedidosCompra(filtros, paginacao) {
  const pool = await getPool();
  const request = pool.request();
  request.input('base', sql.VarChar(2), filtros.base ?? null);
  request.input('empresa', sql.VarChar(30), filtros.empresa ?? null);
  request.input('pedido', sql.Int, filtros.pedido ?? null);
  request.input('fornecedor', sql.VarChar(30), filtros.fornecedor ?? null);
  request.input('produto', sql.VarChar(30), filtros.produto ?? null);
  request.input('status', sql.Int, filtros.status ?? null);
  request.input('dataDe', sql.VarChar(10), filtros.dataDe ?? null);
  request.input('dataAte', sql.VarChar(10), filtros.dataAte ?? null);
  request.input('offset', sql.Int, (paginacao.page - 1) * paginacao.pageSize);
  request.input('pageSize', sql.Int, paginacao.pageSize);
  const start = Date.now();
  const result = await request.query(cachedQuery());
  const rows = result.recordset;
  const total = rows.length ? Number(rows[0].total_registros) : 0;
  for (const row of rows) delete row.total_registros;
  logger.debug('Consulta pedidos de compra', { filtros, ...paginacao, linhas: rows.length, total, durationMs: Date.now() - start });
  return { rows, total };
}

module.exports = { buildPedidosCompraQuery, buscarPedidosCompra, BASES_PEDIDOS_COMPRA };
