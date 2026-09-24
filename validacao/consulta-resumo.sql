
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
    FROM [MIX-AL].dbo.NextLotes nl

    -- Produtos: MIX-AL para AL / AL-FILIAL / PE, MIX-SE apenas para SE
    LEFT JOIN [MIX-AL].dbo.Produtos p_al
        ON p_al.codbarra_pro = nl.EAN
        AND nl.UF <> 'SE'
    LEFT JOIN [MIX-SE].dbo.Produtos p_se
        ON p_se.codbarra_pro = nl.EAN
        AND nl.UF = 'SE'

    -- Fornecedor: mesma lógica, ligado ao Produtos correspondente
    LEFT JOIN [MIX-AL].dbo.Fornecedor f_al
        ON f_al.ID_for = p_al.fornec_pro
        AND nl.UF <> 'SE'
    LEFT JOIN [MIX-SE].dbo.Fornecedor f_se
        ON f_se.ID_for = p_se.fornec_pro
        AND nl.UF = 'SE'

    -- Planilhas: uma por UF
    LEFT JOIN [MIX-AL].dbo.PlanilhaDadosPro01_MTZ_AL pdpma
        ON pdpma.EAN = nl.EAN
        AND pdpma.Código = nl.Produto
        AND nl.UF = 'AL'
    LEFT JOIN [MIX-AL].dbo.PlanilhaDadosPro01_FIL_AL pdpfa
        ON pdpfa.EAN = nl.EAN
        AND pdpfa.Código = nl.Produto
        AND nl.UF = 'AL-FILIAL'
    LEFT JOIN [MIX-AL].dbo.PlanilhaDadosPro01_MTZ_PE pdpmp
        ON pdpmp.EAN = nl.EAN
        AND pdpmp.Código = nl.Produto
        AND nl.UF = 'PE'
    LEFT JOIN [MIX-SE].dbo.PlanilhaDadosPro01_SE pdps
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
),
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
