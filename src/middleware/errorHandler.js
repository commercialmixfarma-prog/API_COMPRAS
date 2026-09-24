const logger = require('../config/logger');

/* eslint-disable no-unused-vars */
function errorHandler(err, req, res, next) {
  logger.error('Erro não tratado na requisição', {
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    ip: req.ip,
  });

  const status = err.status || 500;
  const mensagem = status === 500 ? 'Erro interno do servidor.' : err.message;

  res.status(status).json({ erro: mensagem });
}

function notFoundHandler(req, res) {
  res.status(404).json({ erro: 'Rota não encontrada.' });
}

module.exports = { errorHandler, notFoundHandler };
