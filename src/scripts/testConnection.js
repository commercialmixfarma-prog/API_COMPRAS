// Verificações de LEITURA. Não cria objetos nem modifica registros.
require('dotenv').config();
const {getPool,closeAllPools}=require('../config/sqlServer');
const {getDatabases}=require('../config/settings');

// Objetos referenciados pela consulta de lotes, por banco.
const OBJETOS={
  AL:['NextLotes','Produtos','Fornecedor','PlanilhaDadosPro01_MTZ_AL','PlanilhaDadosPro01_FIL_AL','PlanilhaDadosPro01_MTZ_PE'],
  SE:['Produtos','Fornecedor','PlanilhaDadosPro01_SE'],
};
async function main(){
  const dbs=getDatabases();
  const pool=await getPool();
  await pool.request().query('SELECT 1 AS conexao_ok');
  console.log('Conexão SQL Server: OK');
  let failed=false;
  for(const [uf,database] of Object.entries(dbs)){
    for(const objeto of OBJETOS[uf]){
      try {
        // Nomes aceitos só após validação em settings; não interpolar input HTTP.
        await pool.request().query(`SELECT TOP (1) 1 AS acesso_ok FROM [${database}].dbo.[${objeto}]`);
        console.log(`Leitura de [${database}].dbo.${objeto}: OK`);
      } catch(err){
        failed=true;
        console.error(`Leitura de [${database}].dbo.${objeto}: falhou (${err.code || 'SQL_ERROR'}). ${err.message}`);
      }
    }
  }
  // Tipos reais das colunas usadas em filtro/conversão: confirmar antes de homologar vencimento/data_entrada.
  try {
    const r=await pool.request().query(
      `SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH FROM [${dbs.AL}].INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME='NextLotes' ORDER BY ORDINAL_POSITION`);
    console.log('Colunas de NextLotes:');
    for(const c of r.recordset) console.log(`  ${c.COLUMN_NAME}: ${c.DATA_TYPE}${c.CHARACTER_MAXIMUM_LENGTH?`(${c.CHARACTER_MAXIMUM_LENGTH})`:''}`);
    const ufs=await pool.request().query(`SELECT UF, COUNT(*) AS linhas FROM [${dbs.AL}].dbo.NextLotes GROUP BY UF ORDER BY UF`);
    console.log('Distribuição de NextLotes.UF (valores fora de AL, AL-FILIAL, PE, SE ficam sem planilha):');
    for(const u of ufs.recordset) console.log(`  ${u.UF ?? 'NULL'}: ${u.linhas}`);
  } catch(err){
    failed=true;
    console.error(`Inspeção de NextLotes falhou (${err.code || 'SQL_ERROR'}). ${err.message}`);
  }
  if(failed) process.exitCode=1;
  console.log('Este teste não executa a consulta completa de lotes nem comprova os privilégios efetivos somente leitura.');
}
if(require.main===module) main().catch(err=>{
  console.error('Codigo:', err.code || err.name);
  console.error('Detalhe:', err.message);
  if (err.originalError) console.error('Causa:', err.originalError.message);
  process.exitCode=1;
}).finally(closeAllPools);
module.exports={main};
