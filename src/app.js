require('dotenv').config();
const express=require('express');
const helmet=require('helmet');
const cors=require('cors');
const compression=require('compression');
const logger=require('./config/logger');
const {intEnv,validateStartup}=require('./config/settings');
const {generalLimiter}=require('./middleware/rateLimiter');
const {errorHandler,notFoundHandler}=require('./middleware/errorHandler');
const {closeAllPools}=require('./config/sqlServer');


function createApp() {
  const app=express();
  app.disable('x-powered-by');
  const hops=intEnv('TRUST_PROXY_HOPS',0,0,10);
  app.set('trust proxy',hops === 0 ? false : hops);
  app.use(helmet());
  app.use(cors({origin:(process.env.CORS_ALLOWED_ORIGINS||'').split(',').map(s=>s.trim()).filter(Boolean),methods:['GET','POST']}));
  app.use(compression());
  // Liveness apenas. Não dispara consulta nem comprova acesso ao SQL Server.
  app.get('/health',(req,res)=>res.json({status:'ok',timestamp:new Date().toISOString()}));
  app.use(express.json({limit:'1mb'}));
  app.use(generalLimiter);
  app.use((req,res,next)=>{
    const inicio=Date.now();
    res.on('finish',()=>logger.info(`${req.method} ${req.path}`,{status:res.statusCode,durationMs:Date.now()-inicio,ip:req.ip}));
    next();
  });
  app.use('/auth',require('./routes/auth'));
  app.use('/estoque',require('./routes/estoque'));
  app.use('/simulador', require('./routes/simulador'));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
async function start() {
  validateStartup();
  const app=createApp();
  const server=await new Promise((resolve,reject)=>{
    const s=app.listen(intEnv('PORT',3001,1,65535),'0.0.0.0',()=>resolve(s));
    s.once('error',reject);
  });
  logger.info('API de estoque por lote (SQL Server somente leitura) iniciada; sem cron e sem banco intermediário.');
  let closing=false;
  async function shutdown(signal) {
    if(closing) return;
    closing=true;
    logger.info(`Recebido ${signal}; aguardando requisições em curso.`);
    const deadline=setTimeout(()=>{logger.error('Prazo de encerramento excedido.');process.exit(1);},130000);
    deadline.unref();
    try {
      await new Promise((resolve,reject)=>server.close(err=>err?reject(err):resolve()));
      await closeAllPools();
      clearTimeout(deadline);
      process.exitCode=0;
    } catch(err) {
      logger.error('Falha no encerramento',{error:err.message});
      process.exitCode=1;
    }
  }
  process.once('SIGTERM',()=>shutdown('SIGTERM'));
  process.once('SIGINT',()=>shutdown('SIGINT'));
  return server;
}
if(require.main===module) start().catch(err=>{
  logger.error('Falha ao iniciar aplicação',{error:err.message});
  process.exitCode=1;
});
module.exports={createApp,start};
