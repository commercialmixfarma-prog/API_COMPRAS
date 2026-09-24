const rateLimit=require('express-rate-limit');
const {intEnv}=require('../config/settings');
function handler(req,res){res.status(429).json({erro:'Muitas requisições. Tente novamente em instantes.'});}
const base={windowMs:intEnv('RATE_LIMIT_WINDOW_MS',60000,1000,3600000),standardHeaders:true,legacyHeaders:false,handler};
const generalLimiter=rateLimit({...base,max:intEnv('RATE_LIMIT_MAX',100,1,100000)});
const loginLimiter=rateLimit({...base,max:intEnv('LOGIN_RATE_LIMIT_MAX',5,1,1000)});
module.exports={generalLimiter,loginLimiter};
