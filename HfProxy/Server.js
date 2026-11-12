import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from 'redis';
import { RedisStore } from 'rate-limit-redis';
import { normalizeUpstream } from './Upstream.js';
import { createHealthHandler } from './HealthHandler.js';
import { createChatHandler } from './ChatHandler.js';
export { normalizeUpstream } from './Upstream.js';

export const createProxyApp = ({
  targetUrl = process.env.HF_TARGET_URL || '',
  space = process.env.HF_SPACE || '',
  allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  bodyLimitMb = Number(process.env.BODY_LIMIT_MB) || 2,
  fetchImpl = fetch,
  chatTimeoutMs = 60000,
  healthTimeoutMs = 10000,
  wakeTimeoutMs = 25000,
  rateLimitStoreFactory,
} = {}) => {
  const app = express();
  const upstream = normalizeUpstream(targetUrl, space);
  const upstreamHealth = upstream ? upstream.replace(/\/chat\/?$/, '/health') : '';
  app.disable('x-powered-by');
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
          return callback(null, true);
        }
        const error = new Error('Origin is not allowed');
        error.status = 403;
        callback(error);
      },
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'X-Session-Id', 'Authorization'],
      credentials: false,
    })
  );
  app.use(express.json({ limit: `${Math.min(16, Math.max(1, bodyLimitMb))}mb` }));
  
  const limiter = (prefix) =>
  rateLimit({
    windowMs: 60_000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    passOnStoreError: false,
    ...(rateLimitStoreFactory
      ? { store: rateLimitStoreFactory(prefix) }
      : {}),
  });

  app.use('/api/chat', limiter('chat'));
  app.use('/health', limiter('health'));
  app.options('/api/chat', (_request, response) => response.sendStatus(204));

  app.get('/health', createHealthHandler({ upstream, upstreamHealth, fetchImpl, wakeTimeoutMs, healthTimeoutMs }));

  app.post('/api/chat', createChatHandler({ upstream, fetchImpl, chatTimeoutMs }));

  app.use((error, _request, response, _next) => {
  console.error('HfProxy error:', error);

  const status =
    error.code === 'RATE_LIMIT_STORE_UNAVAILABLE' ? 503 :
    error.status === 403 ? 403 :
    error.type === 'entity.too.large' ? 413 :
    400;

  const errorCode =
    status === 503 ? 'RATE_LIMIT_STORE_UNAVAILABLE' :
    status === 403 ? 'ORIGIN_NOT_ALLOWED' :
    status === 413 ? 'PAYLOAD_TOO_LARGE' :
    'INVALID_REQUEST';

  response.status(status).json({ error: errorCode });
});
  
  return app;
};

const start = async () => {
  const redisUrl = process.env.REDIS_URL;

  if (!redisUrl) {
    throw new Error('REDIS_URL must be configured.');
  }

  const redisClient = createClient({ 
	  url: redisUrl,
	  disableOfflineQueue: true,
  });

  redisClient.on('error', (error) => {
    console.error('Redis error:', error.message);
  });

  await redisClient.connect();

  const sendRedisCommand = async (...args) => {
  if (!redisClient.isReady) {
    const error = new Error('Redis rate-limit store unavailable');
    error.code = 'RATE_LIMIT_STORE_UNAVAILABLE';
    throw error;
  }

  try {
    return await redisClient.sendCommand(args);
  } catch (cause) {
    const error = new Error('Redis rate-limit store unavailable', { cause });
    error.code = 'RATE_LIMIT_STORE_UNAVAILABLE';
    throw error;
  }
};

  const app = createProxyApp({
    rateLimitStoreFactory: (prefix) =>
      new RedisStore({
	      sendCommand: sendRedisCommand,
        prefix: 'maszyna-w:' + prefix + ':',
      }),
  });

  const port = Number(process.env.PORT) || 8787;

  app.listen(port, () => {
    console.log(`HF proxy listening on :${port}`);
  });
};

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  start().catch((error) => {
    console.error('Failed to start HF proxy:', error);
    process.exitCode = 1;
  });
}
