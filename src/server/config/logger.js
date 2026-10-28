const pino = require('pino');
const path = require('path');
const fs = require('fs');

const logsDir = path.join(__dirname, '../../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const level = process.env.LOG_LEVEL || 'info';
const isProd = process.env.NODE_ENV === 'production';

const targets = [
  {
    target: 'pino/file',
    level,
    options: {
      destination: path.join(logsDir, 'combined.log'),
      mkdir: true
    }
  },
  {
    target: 'pino/file',
    level: 'error',
    options: {
      destination: path.join(logsDir, 'error.log'),
      mkdir: true
    }
  }
];

if (!isProd) {
  targets.unshift({
    target: 'pino-pretty',
    level,
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname'
    }
  });
}

const logger = pino(
  {
    level,
    base: { service: 'rwahub-backend' }
  },
  pino.transport({ targets })
);

const accessLogger = pino(
  { level: 'info', base: { service: 'rwahub-backend', logType: 'access' } },
  pino.destination({ dest: path.join(logsDir, 'access.log'), sync: false })
);

logger.http = (message, meta = {}) => {
  accessLogger.info(meta, message);
  logger.info({ ...meta, logType: 'http' }, message);
};

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaughtException');
});

process.on('unhandledRejection', (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  logger.error({ err }, 'unhandledRejection');
});

const requestLogger = (req, res, next) => {
  const start = Date.now();

  res.on('finish', () => {
    logger.http('HTTP Request', {
      method: req.method,
      url: req.url,
      status: res.statusCode,
      durationMs: Date.now() - start,
      ip: req.ip || req.connection.remoteAddress,
      userAgent: req.get('User-Agent'),
      userId: req.user?.userId || 'anonymous',
      requestId: req.id
    });
  });

  next();
};

const errorLogger = (err, req, res, next) => {
  logger.error(
    {
      err,
      url: req.url,
      method: req.method,
      ip: req.ip,
      userId: req.user?.userId || 'anonymous',
      requestId: req.id,
      userAgent: req.get('User-Agent')
    },
    'Request Error'
  );
  next(err);
};

const loggers = {
  api: (message, meta = {}) => logger.info({ ...meta, domain: 'api' }, message),
  database: (message, meta = {}) => logger.info({ ...meta, domain: 'database' }, message),
  auth: (message, meta = {}) => logger.info({ ...meta, domain: 'auth' }, message),
  transaction: (message, meta = {}) => logger.info({ ...meta, domain: 'transaction' }, message),
  upload: (message, meta = {}) => logger.info({ ...meta, domain: 'upload' }, message),
  security: (message, meta = {}) => logger.warn({ ...meta, domain: 'security' }, message),
  performance: (message, meta = {}) => logger.info({ ...meta, domain: 'performance' }, message),
  business: (message, meta = {}) => logger.info({ ...meta, domain: 'business' }, message)
};

const rotateLogs = () => {
  const logFiles = ['error.log', 'combined.log', 'access.log'];

  logFiles.forEach((filename) => {
    const filePath = path.join(logsDir, filename);
    if (!fs.existsSync(filePath)) {
      return;
    }

    const fileSizeInMB = fs.statSync(filePath).size / (1024 * 1024);
    if (fileSizeInMB > 5) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const rotatedFilename = `${filename}.${timestamp}`;
      fs.renameSync(filePath, path.join(logsDir, rotatedFilename));
      logger.info({ from: filename, to: rotatedFilename }, 'Log file rotated');
    }
  });
};

const rotationTimer = setInterval(rotateLogs, 24 * 60 * 60 * 1000);
rotationTimer.unref();

module.exports = {
  logger,
  requestLogger,
  errorLogger,
  loggers,
  rotateLogs
};
