const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');

const logger = require('../config/logger');
const { loginLimiter } = require('../middleware/rateLimiter');
const { AUTH_SCOPE } = require('../config/settings');

const router = express.Router();

/**
 * POST /auth/login
 * Autentica o cliente de serviço (client_id + client_secret) e emite um JWT.
 * Este não é login de usuário humano — é a credencial de máquina usada
 * pelos scripts/rotinas da própria infraestrutura para acessar a API.
 */
router.post(
  '/login',
  loginLimiter,
  [
    body('client_id').isString().trim().notEmpty(),
    body('client_secret').isString().notEmpty(),
  ],
  async (req, res, next) => {
    try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ erro: 'Dados inválidos.', detalhes: errors.array().map(e => ({campo:e.path, mensagem:e.msg})) });
    }

    const { client_id: clientId, client_secret: clientSecret } = req.body;

    const expectedClientId = process.env.SERVICE_CLIENT_ID;
    const expectedSecretHash = process.env.SERVICE_CLIENT_SECRET;

    if (!expectedClientId || !expectedSecretHash) {
      logger.error('SERVICE_CLIENT_ID/SERVICE_CLIENT_SECRET não configurados no .env');
      return res.status(500).json({ erro: 'Autenticação não configurada no servidor.' });
    }

    if (clientId !== expectedClientId) {
      logger.warn('Tentativa de login com client_id inválido', { ip: req.ip, clientId });
      return res.status(401).json({ erro: 'Credenciais inválidas.' });
    }

    const senhaValida = await bcrypt.compare(clientSecret, expectedSecretHash);
    if (!senhaValida) {
      logger.warn('Tentativa de login com client_secret inválido', { ip: req.ip, clientId });
      return res.status(401).json({ erro: 'Credenciais inválidas.' });
    }

    const token = jwt.sign(
      { sub: clientId, scope: AUTH_SCOPE },
      process.env.JWT_SECRET,
      { algorithm: 'HS256', expiresIn: process.env.JWT_EXPIRES_IN || '1h' }
    );

    logger.info('Login de serviço bem-sucedido', { clientId, ip: req.ip });

    res.json({
      access_token: token,
      token_type: 'Bearer',
      expires_in: process.env.JWT_EXPIRES_IN || '1h',
    });
    } catch (err) { next(err); }
  }
);

module.exports = router;
