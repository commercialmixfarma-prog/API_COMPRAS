const winston = require('winston');
require('winston-daily-rotate-file');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', '..', 'logs');

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length ? JSON.stringify(meta) : '';
    return `${timestamp} [${level}] ${message} ${metaStr}`;
  })
);

const fileRotateTransport = new winston.transports.DailyRotateFile({
  dirname: LOG_DIR,
  filename: 'mix-estoque-lotes-api-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  zippedArchive: true,
  maxSize: '20m',
  maxFiles: '30d',
  format: logFormat,
});

const errorFileRotateTransport = new winston.transports.DailyRotateFile({
  dirname: LOG_DIR,
  filename: 'mix-estoque-lotes-api-error-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  zippedArchive: true,
  maxSize: '20m',
  maxFiles: '90d',
  level: 'error',
  format: logFormat,
});

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  transports: [fileRotateTransport, errorFileRotateTransport],
  exceptionHandlers: [fileRotateTransport],
  rejectionHandlers: [fileRotateTransport],
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({ format: consoleFormat }));
} else {
  // Em produção mantemos um console básico também (útil para journalctl/pm2 logs)
  logger.add(new winston.transports.Console({ format: consoleFormat, level: 'info' }));
}

module.exports = logger;
