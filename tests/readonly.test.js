const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const bcrypt=require('bcryptjs');
Object.assign(process.env,{
  NODE_ENV:'test',LOG_LEVEL:'error',SQLSERVER_HOST:'127.0.0.1',SQLSERVER_USER:'teste_simulado',SQLSERVER_PASSWORD:'sem_banco_real',
  SQLSERVER_AL_DATABASE:'MIX-AL',SQLSERVER_SE_DATABASE:'MIX-SE',
  SERVICE_CLIENT_ID:'cliente-teste',SERVICE_CLIENT_SECRET:bcrypt.hashSync('senha-somente-teste',4),JWT_SECRET:'segredo-apenas-teste-local-1234567890',
  API_DEFAULT_PAGE_SIZE:'2',API_MAX_PAGE_SIZE:'10',API_MAX_CONCURRENT_READS:'2',RATE_LIMIT_MAX:'1000',LOGIN_RATE_LIMIT_MAX:'100',TRUST_PROXY_HOPS:'0',
});
const lotes=[
  {empresa:1,uf:'AL',codigo:100,ean:'7890000000011',lote:'L1',vencimento:'2026-10-01',data_entrada:'2026-01-10',dias_para_vencer:8,estoque:50,nome_produto:'PRODUTO A',codigo_fornecedor:7,fornecedor:'FORN A',ufo:'X',dde:1,tabela_imp:'T',substancia:'S',media:1.5,pf:10.5,pc_custo:8.25,pct_custo_icm:18,tipo:'GEN',total_registros:3},
  {empresa:1,uf:'AL',codigo:101,ean:'7890000000028',lote:'L2',vencimento:'2026-08-01',data_entrada:'2026-01-10',dias_para_vencer:-53,estoque:0,nome_produto:null,codigo_fornecedor:null,fornecedor:null,ufo:null,dde:null,tabela_imp:null,substancia:null,media:null,pf:null,pc_custo:null,pct_custo_icm:null,tipo:null,total_registros:3},
  {empresa:2,uf:'SE',codigo:200,ean:'7890000000035',lote:'L3',vencimento:null,data_entrada:null,dias_para_vencer:null,estoque:12.5,nome_produto:'PRODUTO C',codigo_fornecedor:9,fornecedor:'FORN C',ufo:'Y',dde:2,tabela_imp:'T',substancia:'S2',media:2,pf:20,pc_custo:15,pct_custo_icm:12,tipo:'ETI',total_registros:3},
];
const grupos=[
  {uf:'AL',empresa:1,total_lotes:2,estoque_total:'50.000',produtos_distintos:2,fornecedores_distintos:1,lotes_sem_vencimento:0,lotes_vencidos:1,estoque_vencido:'0.000',lotes_vencem_30d:1,lotes_vencem_60d:1,lotes_vencem_90d:1,estoque_vence_30d:'50.000',estoque_vence_60d:'50.000',estoque_vence_90d:'50.000',lotes_sem_cadastro_produto:1,lotes_sem_planilha:1},
  {uf:'SE',empresa:2,total_lotes:1,estoque_total:'12.500',produtos_distintos:1,fornecedores_distintos:1,lotes_sem_vencimento:1,lotes_vencidos:0,estoque_vencido:'0.000',lotes_vencem_30d:0,lotes_vencem_60d:0,lotes_vencem_90d:0,estoque_vence_30d:'0.000',estoque_vence_60d:'0.000',estoque_vence_90d:'0.000',lotes_sem_cadastro_produto:0,lotes_sem_planilha:0},
];
const queries=[];
let gate=null;
// Mock na fronteira do banco: nenhum driver conecta e nenhuma consulta chega a um SQL Server.
const fakePool={request(){const params={};return {
  input(name,type,value){params[name]=value;return this;},
  async query(text){
    queries.push({text,params});if(gate) await gate;
    if(text.includes('GROUP BY f.uf')) return {recordset:grupos.map(g=>({...g}))};
    const filtrados=lotes.filter(l=>(params.uf==null||l.uf===params.uf)&&(params.somenteComEstoque!==1||l.estoque>0));
    const page=filtrados.slice(params.offset,params.offset+params.pageSize).map(l=>({...l,total_registros:filtrados.length}));
    return {recordset:page};
  },
};}};
require.cache[require.resolve('../src/config/sqlServer')]={id:require.resolve('../src/config/sqlServer'),filename:require.resolve('../src/config/sqlServer'),loaded:true,exports:{getPool:async()=>fakePool,closeAllPools:async()=>{},sql:{Date:'date',Int:'int',Bit:'bit',VarChar:()=>'varchar',NVarChar:()=>'nvarchar'}}};
const settings=require('../src/config/settings');
const {buildLotesQuery,buildResumoQuery}=require('../src/services/lotesQuery');
const {createApp}=require('../src/app');

const WRITE_RE=/\b(DROP|TRUNCATE|INSERT|UPDATE|DELETE|MERGE|ALTER|CREATE|GRANT|REVOKE|EXEC|EXECUTE|INTO|BACKUP|RESTORE|DBCC)\b/i;
// Todos os subtestes abaixo são sequenciais para proteger o estado dos mocks.
test('API de estoque por lote somente leitura — testes isolados',async t=>{
  await t.test('configuração de teste completa válida',()=>assert.doesNotThrow(()=>settings.validateStartup()));
  await t.test('nomes de bancos rejeitam interpolação arbitrária',()=>{
    assert.throws(()=>buildLotesQuery('MIX-AL]; DELETE FROM x;--','MIX-SE'));
    assert.throws(()=>buildLotesQuery('MIX-AL',"MIX-SE';DELETE"));
    assert.doesNotThrow(()=>buildLotesQuery('MIX-AL','MIX-SE'));
  });
  await t.test('consultas são de leitura, preservam a lógica recebida e usam parâmetros',()=>{
    for(const sql of [buildLotesQuery('MIX-AL','MIX-SE'),buildResumoQuery('MIX-AL','MIX-SE')]){
      assert.match(sql,/FROM \[MIX-AL\]\.dbo\.NextLotes nl/);
      assert.match(sql,/\[MIX-SE\]\.dbo\.PlanilhaDadosPro01_SE pdps/);
      assert.match(sql,/AND nl\.UF = 'AL-FILIAL'/);
      assert.match(sql,/COALESCE\(pdpma\.\[% Custo ICM\], pdpfa\.\[% Custo ICM\], pdpmp\.\[% Custo ICM\], pdps\.\[% Custo ICM\]\)/);
      for(const p of ['@uf','@empresa','@produto','@ean','@lote','@fornecedor','@vencimentoDe','@vencimentoAte','@somenteComEstoque']) assert.match(sql,new RegExp(p+'\\b'));
      assert.doesNotMatch(sql,WRITE_RE);
    }
    assert.match(buildLotesQuery('MIX-AL','MIX-SE'),/OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY/);
    assert.match(buildResumoQuery('MIX-AL','MIX-SE'),/GROUP BY f\.uf, f\.empresa/);
  });
  await t.test('bloco PostgreSQL/ETL e scripts de escrita não são distribuídos',()=>{
    for(const file of ['src/config/postgres.js','src/services/etlService.js','src/jobs','src/routes/etl.js','src/routes/vendas.js','src/services/vendasQuery.js','sql']) assert.equal(fs.existsSync(path.join(__dirname,'..',file)),false,file);
    const pkg=require('../package.json');
    for(const name of ['pg','node-cron','p-retry','p-limit']) assert.equal(pkg.dependencies[name],undefined);
  });
  const server=await new Promise(resolve=>{const s=createApp().listen(0,'127.0.0.1',()=>resolve(s));});
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  let token;
  const request=(url,options={})=>fetch(base+url,{signal:AbortSignal.timeout(5000),...options});
  const options=()=>({headers:{Authorization:`Bearer ${token}`}});
  await t.test('health não consulta banco',async()=>{
    const before=queries.length;const res=await request('/health');assert.equal(res.status,200);assert.equal((await res.json()).status,'ok');assert.equal(queries.length,before);
  });
  await t.test('estoque sem autenticação não consulta banco',async()=>{
    const before=queries.length;const res=await request('/estoque/lotes');assert.equal(res.status,401);await res.json();assert.equal(queries.length,before);
  });
  await t.test('login bcrypt emite token de leitura com escopo estoque',async()=>{
    const res=await request('/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_id:'cliente-teste',client_secret:'senha-somente-teste'})});
    assert.equal(res.status,200);token=(await res.json()).access_token;assert.ok(token);
    const payload=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString());assert.equal(payload.scope,'estoque:read');
  });
  await t.test('token de outra API (escopo vendas) é recusado',async()=>{
    const jwt=require('jsonwebtoken');const outro=jwt.sign({sub:'cliente-teste',scope:'vendas:read'},process.env.JWT_SECRET,{algorithm:'HS256',expiresIn:'1h'});
    const before=queries.length;const res=await request('/estoque/lotes',{headers:{Authorization:`Bearer ${outro}`}});assert.equal(res.status,403);await res.json();assert.equal(queries.length,before);
  });
  await t.test('consulta sem filtro pagina, informa total e remove coluna técnica',async()=>{
    const res=await request('/estoque/lotes',options());assert.equal(res.status,200);const body=await res.json();
    assert.equal(body.total,3);assert.equal(body.page,1);assert.equal(body.pageSize,2);assert.equal(body.totalPaginas,2);assert.equal(body.data.length,2);
    assert.equal(body.data[0].codigo,100);assert.equal(body.data[0].vencimento,'2026-10-01');assert.equal(body.data[0].pct_custo_icm,18);
    assert.equal('total_registros' in body.data[0],false);
    const p=queries.at(-1).params;assert.equal(p.uf,null);assert.equal(p.somenteComEstoque,0);assert.equal(p.offset,0);assert.equal(p.pageSize,2);
    const res2=await request('/estoque/lotes?page=2',options());const body2=await res2.json();assert.equal(body2.data.length,1);assert.equal(body2.data[0].uf,'SE');
  });
  await t.test('filtros chegam como parâmetros, nunca no texto SQL',async()=>{
    const res=await request('/estoque/lotes?uf=se&empresa=2&produto=200&ean=7890000000035&lote=L3&fornecedor=9&vencimentoDe=2026-01-01&vencimentoAte=2027-12-31&somenteComEstoque=true&pageSize=10',options());
    assert.equal(res.status,200);const body=await res.json();assert.equal(body.total,1);assert.equal(body.filtros.uf,'SE');assert.equal(body.filtros.somenteComEstoque,true);
    const q=queries.at(-1);assert.equal(q.params.uf,'SE');assert.equal(q.params.empresa,'2');assert.equal(q.params.lote,'L3');assert.equal(q.params.vencimentoDe,'2026-01-01');assert.equal(q.params.somenteComEstoque,1);
    assert.doesNotMatch(q.text,/7890000000035|L3/);
  });
  await t.test('resumo agrega grupos do SQL em geral, por UF e por empresa',async()=>{
    const res=await request('/estoque/lotes/resumo?somenteComEstoque=false',options());assert.equal(res.status,200);const body=await res.json();
    assert.equal(body.geral.total_lotes,3);assert.equal(body.geral.estoque_total,62.5);assert.equal(body.geral.lotes_vencidos,1);assert.equal(body.geral.lotes_sem_vencimento,1);
    assert.equal(body.porUf.length,2);assert.equal(body.porUf[0].uf,'AL');assert.equal(body.porUf[0].estoque_vence_30d,50);
    assert.equal(body.porEmpresa[1].produtos_distintos,1);assert.equal('produtos_distintos' in body.geral,false);
    assert.match(queries.at(-1).text,/GROUP BY f\.uf, f\.empresa/);
  });
  await t.test('filtros e paginação inválidos são rejeitados sem consultar banco',async()=>{
    const before=queries.length;
    for(const query of ['?uf=XX','?empresa=1%27%3BDELETE','?produto=abc%20def','?ean[]=1','?vencimentoDe=2026-02-30','?vencimentoDe=2026-09-05&vencimentoAte=2026-09-04','?somenteComEstoque=sim','?page=0','?pageSize=11','?pageSize=abc','?lote=%27OR%271%27%3D%271']){
      const res=await request('/estoque/lotes'+query,options());assert.equal(res.status,400,query);await res.json();
    }
    assert.equal(queries.length,before);
  });
  await t.test('rotas de vendas e ETL não existem',async()=>{
    for(const url of ['/vendas?dataInicio=2026-09-04&dataFim=2026-09-04','/etl/trigger/incremental']){const res=await request(url,options());assert.equal(res.status,404);await res.json();}
  });
  await t.test('limita consultas em voo e devolve slot após conclusão',async()=>{
    let release;gate=new Promise(resolve=>{release=resolve;});const before=queries.length;
    const a=request('/estoque/lotes',options()), b=request('/estoque/lotes',options());
    try{
      for(let i=0;i<100 && queries.length<before+2;i++) await new Promise(r=>setTimeout(r,5));
      assert.equal(queries.length,before+2);
      const res=await request('/estoque/lotes',options());assert.equal(res.status,503);assert.equal(res.headers.get('retry-after'),'5');await res.json();
    } finally {gate=null;release();await Promise.all([a,b]).then(rs=>Promise.all(rs.map(r=>r.json())));}
    const res=await request('/estoque/lotes',options());assert.equal(res.status,200);await res.json();
  });
  await t.test('pool recupera após primeira tentativa de conexão falhar',async()=>{
    let attempts=0;
    class Pool {constructor(){this.connected=false;}on(){}async connect(){if(++attempts===1)throw Error('falha simulada');this.connected=true;}async close(){this.connected=false;}}
    const file=path.join(__dirname,'../src/config/sqlServer.js');const module={exports:{}};
    vm.runInNewContext(fs.readFileSync(file,'utf8'),{module,process,require(name){if(name==='mssql')return {ConnectionPool:Pool};if(name==='./logger')return {error(){},warn(){},info(){}};if(name==='./settings')return settings;throw Error(name);}});
    await assert.rejects(module.exports.getPool(),/falha simulada/);const pool=await module.exports.getPool();assert.equal(pool.connected,true);assert.equal(attempts,2);await module.exports.closeAllPools();
  });
});
