# API_ESTOQUE_LOTES 1.0.0 — Docker e Portainer

API de leitura de **estoque por lote** (tabela `NextLotes`, cruzada com Produtos, Fornecedor e as planilhas de dados por UF). Construída sobre o mesmo esqueleto da API_GERAL 1.1.1 (vendas): Node 24, Express, mssql, JWT de serviço, rate limit, limites de leitura, logs rotativos, container não-root. Sem PostgreSQL, sem cron, sem escrita no SQL Server.

É pacote de código-fonte, não imagem pronta. Sem .env real, credenciais ou node_modules. Destinado a **Docker Standalone** gerenciado pelo Portainer.

## 1. O que muda em relação à API de vendas

| Item | API_GERAL (vendas) | API_ESTOQUE_LOTES |
|---|---|---|
| Rota principal | `GET /vendas?dataInicio&dataFim` | `GET /estoque/lotes` (filtros opcionais, paginado) |
| Resumo | `GET /vendas/resumo` (no Node) | `GET /estoque/lotes/resumo` (agregado no SQL Server) |
| Escopo do JWT | `vendas:read` | `estoque:read` (token de uma API não serve na outra) |
| Execução SQL | uma UF por vez | uma execução cobre AL, AL-FILIAL, PE e SE (a consulta cruza MIX-AL e MIX-SE) |
| Recorte | obrigatório por data (máx. 7 dias) | sem data; proteção por paginação e filtros |
| Porta padrão | 3000 | 3001 (convivem na mesma VPS) |
| Timeout SQL padrão | 60 s | 120 s |
| Imagem / volume | mix-corporativo-api / api-logs | mix-corporativo-estoque-lotes-api / estoque-api-logs |

## 2. Contrato da API

`POST /auth/login` — igual à API de vendas: `{client_id, client_secret}` → `{access_token, token_type, expires_in}`.

`GET /estoque/lotes` (Bearer) — parâmetros, todos opcionais:

| Parâmetro | Valores | Efeito |
|---|---|---|
| `uf` | AL, AL-FILIAL, PE, SE | filtra `NextLotes.UF` |
| `empresa`, `produto`, `ean`, `fornecedor` | até 30 caracteres alfanuméricos | igualdade exata (empresa e produto casam com Empresa/Produto de NextLotes; fornecedor com `codigo_fornecedor`) |
| `lote` | até 60 caracteres | igualdade exata |
| `vencimentoDe`, `vencimentoAte` | YYYY-MM-DD | intervalo inclusivo sobre o vencimento convertido para date |
| `somenteComEstoque` | true/false (padrão false) | `Estoque > 0` |
| `page` | ≥ 1 (padrão 1) | página |
| `pageSize` | 1..API_MAX_PAGE_SIZE (padrão API_DEFAULT_PAGE_SIZE) | tamanho da página |

Resposta: `{success, total, page, pageSize, totalPaginas, filtros, data[]}`. `total` é o total filtrado (não da página). Colunas de `data`, na ordem da consulta recebida, renomeadas para snake_case sem espaço/acento:

`empresa, uf, codigo, ean, lote, vencimento, data_entrada, dias_para_vencer, estoque, nome_produto, codigo_fornecedor, fornecedor, ufo, dde, tabela_imp, substancia, media, pf, pc_custo, pct_custo_icm, tipo`

- `vencimento` e `data_entrada` saem como texto `YYYY-MM-DD` (ou null se a origem não converter para date).
- `dias_para_vencer` é derivado: negativo = vencido; null = sem vencimento.
- Mapa completo original → API está comentado em `src/services/lotesQuery.js`.

`GET /estoque/lotes/resumo` (Bearer) — mesmos filtros, sem paginação. Agrega no SQL Server por (uf, empresa): `total_lotes, estoque_total, produtos_distintos, fornecedores_distintos, lotes_sem_vencimento, lotes_vencidos, estoque_vencido, lotes_vencem_30d/60d/90d, estoque_vence_30d/60d/90d, lotes_sem_cadastro_produto, lotes_sem_planilha`. Envelope: `{success, filtros, referencia, geral, porUf[], porEmpresa[]}`. Janelas 30/60/90 são cumulativas a partir de hoje (data do SQL Server). `produtos_distintos`/`fornecedores_distintos` só aparecem em `porEmpresa` (somar distintos entre grupos seria incorreto).

A tabela é viva: entre duas páginas o estoque pode mudar. Para foto consistente, use `pageSize` grande e consuma rápido.

## 3. Validar no SQL antes de homologar

Rodar `validacao/checagens-duplicidade.sql` no SSMS. A consulta faz LEFT JOIN por EAN (Produtos) e por (EAN, Código) (planilhas): se essas chaves não forem únicas nas tabelas de apoio, cada lote se repete e o `estoque_total` do resumo dobra. Todas as checagens devem retornar 0 linhas. Também confirme os tipos reais de `Vencimento` e `[Data Entrada]` (o `npm run test:connection` imprime as colunas de NextLotes).

## 4. Construir a imagem pela interface do Portainer

Endpoint Standalone da VPS. **Images > Build a new image**:

- Nome: `mix-corporativo-estoque-lotes-api:1.0.0`
- Método **Upload**: enviar `api-estoque-lotes-build-context.tar.gz` (entregue junto; contém Dockerfile, package.json, package-lock.json e `src/`).
- Alternativa **Web editor**: só serve se o código já estiver no daemon; use Upload.

Aguardar o log de build terminar sem erro e conferir a imagem em Images. Construir onde o Portainer gerencia; não é necessário Node/npm no host. Se o endpoint for Swarm, não implantar este YAML sem adaptação.

## 5. Criar a stack

**Stacks > Add stack**, nome sugerido `mix-corporativo-estoque-lotes-api`, Web editor: colar `portainer.stack.yml`.

Em **Environment variables**, cadastrar sem aspas delimitadoras (mesmo nos hashes com `$`). Nunca colar segredos no YAML.

| Variável obrigatória | Preenchimento |
|---|---|
| SERVICE_CLIENT_ID | Identificador de cliente (pode repetir o da API de vendas) |
| SERVICE_CLIENT_SECRET | Hash bcrypt (`npm run auth:hash "senha"` ou gerar no Console do container: `node src/scripts/gerarHashSenha.js "senha"`) |
| JWT_SECRET | ≥ 32 caracteres aleatórios, **diferente** do JWT_SECRET da API de vendas |
| SQLSERVER_HOST | Mesmo destino já validado pela API de vendas na VPS |
| SQLSERVER_PORT | Mesma porta já validada |
| SQLSERVER_USER / SQLSERVER_PASSWORD | Mesmo usuário de leitura |

Defaults no YAML: `API_IMAGE=mix-corporativo-estoque-lotes-api:1.0.0`, bancos MIX-AL/MIX-SE, timeout SQL 120 s, página padrão 5000 e máxima 20000, pool 2, 2 consultas simultâneas, 100 req/min. Se usar imagem construída localmente, não habilitar re-pull de registry. Não criar segunda stack com o mesmo serviço e porta 3001.

## 6. Testar de dentro do container (Console do Portainer)

**Containers > api (estoque) > Console** (`/bin/sh`, usuário node):

```sh
node src/scripts/testConnection.js
```

Esperado: conexão OK; leitura OK de NextLotes, Produtos, Fornecedor e das 4 planilhas (3 em MIX-AL, 1 em MIX-SE); lista de colunas de NextLotes; distribuição de UF. O script lê o ambiente do container (variáveis da stack), não precisa de .env. Se alguma planilha falhar, o nome/permissão do objeto está errado: corrigir antes de consumir.

Depois, ainda no Console, um ciclo HTTP local:

```sh
wget -qO- http://127.0.0.1:3001/health
wget -qO- --header='Content-Type: application/json' --post-data='{"client_id":"SEU_ID","client_secret":"SENHA_ORIGINAL"}' http://127.0.0.1:3001/auth/login
wget -qO- --header='Authorization: Bearer TOKEN' 'http://127.0.0.1:3001/estoque/lotes/resumo'
wget -qO- --header='Authorization: Bearer TOKEN' 'http://127.0.0.1:3001/estoque/lotes?uf=SE&somenteComEstoque=true&pageSize=5'
```

O healthcheck é liveness: HTTP saudável não comprova SQL disponível. Anote duração e `total` da primeira chamada completa: é o dado que define se 120 s e 5000 linhas/página são adequados. Não compartilhar token ou respostas com dados de custo.

## 7. Acesso do Base44 e HTTPS

Bind 127.0.0.1:3001 é intencional. Para consumo externo, publicar pelo Nginx Proxy Manager já instalado na VPS (porta 81) num host/caminho próprio, apontando para o container desta API, com HTTPS, e então configurar URL/secrets no backend consumidor. Nunca enviar credenciais da API ao navegador. Ajustar TRUST_PROXY_HOPS conforme a quantidade real de proxies. Mesmo procedimento pendente para a API de vendas.

## 8. Escopo das validações desta entrega

`validacao/verificacoes.txt` registra o que foi executado no ambiente de preparação: 17 testes automatizados com banco simulado (Node 20; alvo é Node 24), parse T-SQL das duas consultas geradas, lock de dependências regenerado. **Não** executados aqui: build Docker, deploy no Portainer, consulta ao SQL Server real, medição de volume/duração de NextLotes.
