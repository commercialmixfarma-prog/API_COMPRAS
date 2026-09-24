-- Rodar no SSMS (somente leitura) ANTES de homologar a API.
-- A consulta de lotes usa LEFT JOIN por EAN (Produtos) e por (EAN, Código) (Planilhas).
-- Se essas chaves não forem únicas nas tabelas de apoio, cada lote aparece repetido
-- e o estoque é somado em duplicidade no /resumo. Todas as consultas abaixo devem retornar 0 linhas.

-- 1. EAN duplicado em Produtos (MIX-AL / MIX-SE)
SELECT codbarra_pro, COUNT(*) AS n FROM [MIX-AL].dbo.Produtos WHERE codbarra_pro IS NOT NULL GROUP BY codbarra_pro HAVING COUNT(*) > 1;
SELECT codbarra_pro, COUNT(*) AS n FROM [MIX-SE].dbo.Produtos WHERE codbarra_pro IS NOT NULL GROUP BY codbarra_pro HAVING COUNT(*) > 1;

-- 2. (EAN, Código) duplicado nas planilhas
SELECT EAN, Código, COUNT(*) AS n FROM [MIX-AL].dbo.PlanilhaDadosPro01_MTZ_AL GROUP BY EAN, Código HAVING COUNT(*) > 1;
SELECT EAN, Código, COUNT(*) AS n FROM [MIX-AL].dbo.PlanilhaDadosPro01_FIL_AL GROUP BY EAN, Código HAVING COUNT(*) > 1;
SELECT EAN, Código, COUNT(*) AS n FROM [MIX-AL].dbo.PlanilhaDadosPro01_MTZ_PE GROUP BY EAN, Código HAVING COUNT(*) > 1;
SELECT EAN, Código, COUNT(*) AS n FROM [MIX-SE].dbo.PlanilhaDadosPro01_SE GROUP BY EAN, Código HAVING COUNT(*) > 1;

-- 3. Comparação direta: linhas em NextLotes x linhas devolvidas pela consulta completa.
--    Se a segunda contagem for maior, há multiplicação por JOIN.
SELECT COUNT(*) AS linhas_nextlotes FROM [MIX-AL].dbo.NextLotes;
-- (executar a consulta de validacao/consulta-lotes.sql envolvida em SELECT COUNT(*) ... ou observar `total` no /estoque/lotes)

-- 4. Valores de UF fora do tratado pela consulta (não terão planilha nem, se 'SE' grafado diferente, produto)
SELECT UF, COUNT(*) AS n FROM [MIX-AL].dbo.NextLotes GROUP BY UF ORDER BY UF;

-- 5. Vencimentos que não convertem para date (aparecerão como vencimento NULL na API)
SELECT TOP (50) Vencimento FROM [MIX-AL].dbo.NextLotes WHERE Vencimento IS NOT NULL AND TRY_CONVERT(date, Vencimento) IS NULL;
