const jwt = require('jsonwebtoken');
const logger = require('../config/logger');
const { AUTH_SCOPE } = require('../config/settings');

/**
 * Middleware que exige um Bearer token JWT válido com escopo de leitura de estoque.
 * Espera header: Authorization: Bearer <token>
 */
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const [scheme, token] = authHeader.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ erro: 'Token de autenticação ausente ou mal formatado.' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET, {algorithms:['HS256']});
    if (payload.sub !== process.env.SERVICE_CLIENT_ID || payload.scope !== AUTH_SCOPE) {
      return res.status(403).json({erro:'Token sem permissão de leitura.'});
    }
    req.auth = payload;
    return next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ erro: 'Token expirado.' });
    }
    logger.warn('Falha na verificação do JWT', { error: err.message, ip: req.ip });
    return res.status(401).json({ erro: 'Token inválido.' });
  }
}

module.exports = { requireAuth };
