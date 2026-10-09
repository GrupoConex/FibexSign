import path from 'node:path';
import express from 'express';
import rateLimit, { ipKeyGenerator, MemoryStore } from 'express-rate-limit';

export const STRICT_AUTH_PATH_SUFFIXES = [
  '/login',
  '/verifyPassword',
  '/requestPasswordReset',
  '/functions/loginuser',
  '/functions/AuthLoginAsMail',
  '/functions/SendOTPMailV1',
  '/functions/addadmin',
  '/functions/usersignup',
  '/functions/verifyemail',
  '/functions/verifyloginotp',
];

export const OPERATIONAL_PATH_SUFFIXES = [
  '/functions/getUserDetails',
  '/functions/declinedoc',
  '/functions/sendmailv3',
];

const RATE_LIMIT_MESSAGE = 'Too many requests, please try again later.';
const DEFAULT_WINDOW_MS = 5 * 60 * 1000;
const DEFAULT_AUTH_MAX = 30;
const DEFAULT_OPERATIONAL_MAX = 300;
const OPERATIONAL_MAX_MULTIPLIER = 10;
const BATCH_PATH_SUFFIX = '/batch';
const TOO_MANY_REQUESTS_STATUS = 429;
const BAD_REQUEST_STATUS = 400;
const PAYLOAD_TOO_LARGE_STATUS = 413;
const BATCH_BODY_LIMIT = '10mb';
const MAX_BATCH_SUB_REQUESTS = 50;
const DEFAULT_BATCH_MAX = 60;
const OVERSIZED_BATCH_BODY_MESSAGE = 'Batch request body is too large.';
const TOO_MANY_SUB_REQUESTS_MESSAGE = 'Batch request has too many sub-requests.';
const INVALID_BATCH_BODY_MESSAGE = 'Invalid batch request body.';
const PRODUCTION_PROXY_WARNING =
  'TRUST_PROXY_HOPS is not set in production: the auth rate limiter sees the proxy address for every client. Set TRUST_PROXY_HOPS to the number of proxies in front of this server.';

const MALFORMED_PATH = '\u0000malformed-request-path';

const decodePathname = pathname => {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return null;
  }
};

export const normalizeRequestPath = requestPath => {
  const decoded = decodePathname(String(requestPath ?? '').split('?')[0]);
  if (decoded === null) {
    return MALFORMED_PATH;
  }
  const canonical = decoded ? path.posix.normalize(decoded.toLowerCase()) : '';
  return canonical.replace(/\/+$/, '');
};

const matchesAnySuffix = (requestPath, suffixes) => {
  const normalizedPath = normalizeRequestPath(requestPath);
  return (
    normalizedPath === MALFORMED_PATH ||
    suffixes.some(suffix => normalizedPath.endsWith(suffix.toLowerCase()))
  );
};

export const isStrictAuthPath = requestPath =>
  matchesAnySuffix(requestPath, STRICT_AUTH_PATH_SUFFIXES);

export const isAuthRateLimitedPath = requestPath =>
  isStrictAuthPath(requestPath) || matchesAnySuffix(requestPath, OPERATIONAL_PATH_SUFFIXES);

function readRateLimitSettings() {
  const windowMs = Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS) || DEFAULT_WINDOW_MS;
  const authMax = Number(process.env.AUTH_RATE_LIMIT_MAX) || DEFAULT_AUTH_MAX;
  const operationalMax =
    Number(process.env.OPERATIONAL_RATE_LIMIT_MAX) ||
    (process.env.AUTH_RATE_LIMIT_MAX
      ? Number(process.env.AUTH_RATE_LIMIT_MAX) * OPERATIONAL_MAX_MULTIPLIER
      : DEFAULT_OPERATIONAL_MAX);
  const batchMax = Number(process.env.BATCH_RATE_LIMIT_MAX) || DEFAULT_BATCH_MAX;
  return { windowMs, authMax, operationalMax, batchMax };
}

export function buildParseServerRateLimits() {
  const { windowMs, authMax } = readRateLimitSettings();
  return STRICT_AUTH_PATH_SUFFIXES.map(requestPath => ({
    requestPath,
    requestTimeWindow: windowMs,
    requestCount: authMax,
    errorResponseMessage: RATE_LIMIT_MESSAGE,
  }));
}

const authRateLimiterStore = new MemoryStore();
const operationalRateLimiterStore = new MemoryStore();
const batchRateLimiterStore = new MemoryStore();

const buildBatchRateLimitKey = (request, subRequest) =>
  `${ipKeyGenerator(request.ip)}:${normalizeRequestPath(subRequest.path)}`;

const isBatchRequest = request =>
  request.method === 'POST' && normalizeRequestPath(request.path).endsWith(BATCH_PATH_SUFFIX);

const batchBodyParser = express.json({ type: () => true, limit: BATCH_BODY_LIMIT });

const parseBatchBody = (request, response) =>
  new Promise((resolve, reject) => {
    batchBodyParser(request, response, error => (error ? reject(error) : resolve()));
  });

async function inspectBatch(request, response, authMax) {
  try {
    await parseBatchBody(request, response);
  } catch (error) {
    return error?.status === PAYLOAD_TOO_LARGE_STATUS
      ? { status: PAYLOAD_TOO_LARGE_STATUS, message: OVERSIZED_BATCH_BODY_MESSAGE }
      : { status: BAD_REQUEST_STATUS, message: INVALID_BATCH_BODY_MESSAGE };
  }
  const subRequests = request.body?.requests;
  if (!Array.isArray(subRequests)) {
    return null;
  }
  if (subRequests.length > MAX_BATCH_SUB_REQUESTS) {
    return { status: PAYLOAD_TOO_LARGE_STATUS, message: TOO_MANY_SUB_REQUESTS_MESSAGE };
  }
  return (await exceedsBatchBudget(request, authMax))
    ? { status: TOO_MANY_REQUESTS_STATUS, message: RATE_LIMIT_MESSAGE }
    : null;
}

async function exceedsBatchBudget(request, authMax) {
  const strictSubRequests = request.body.requests.filter(subRequest =>
    isStrictAuthPath(subRequest?.path)
  );
  for (const subRequest of strictSubRequests) {
    const { totalHits } = await authRateLimiterStore.increment(
      buildBatchRateLimitKey(request, subRequest)
    );
    if (totalHits > authMax) {
      return true;
    }
  }
  return false;
}

function buildLimiter({ windowMs, max, store }) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    store,
    keyGenerator: request => `${ipKeyGenerator(request.ip)}:${normalizeRequestPath(request.path)}`,
    message: { error: RATE_LIMIT_MESSAGE },
  });
}

export function buildBatchGuardMiddleware() {
  const { windowMs, authMax, batchMax } = readRateLimitSettings();
  const batchLimiter = buildLimiter({ windowMs, max: batchMax, store: batchRateLimiterStore });

  return function batchGuardMiddleware(request, response, next) {
    if (!isBatchRequest(request)) {
      return next();
    }
    return batchLimiter(request, response, async () => {
      const rejection = await inspectBatch(request, response, authMax);
      if (rejection) {
        return response.status(rejection.status).json({ error: rejection.message });
      }
      return next();
    });
  };
}

export function buildAuthRateLimiterMiddleware() {
  const { windowMs, authMax, operationalMax } = readRateLimitSettings();
  const authLimiter = buildLimiter({ windowMs, max: authMax, store: authRateLimiterStore });
  const operationalLimiter = buildLimiter({
    windowMs,
    max: operationalMax,
    store: operationalRateLimiterStore,
  });

  return function authRateLimiterMiddleware(request, response, next) {
    if (isStrictAuthPath(request.path)) {
      return authLimiter(request, response, next);
    }
    if (isAuthRateLimitedPath(request.path)) {
      return operationalLimiter(request, response, next);
    }
    return next();
  };
}

const LOCAL_CLIENT_ADDRESSES = ['::1', '127.0.0.1', '::ffff:127.0.0.1'];

const resetParseServerRateLimiters = () =>
  Promise.all(
    (globalThis.Parse?.Server?.rateLimits ?? []).flatMap(limit =>
      LOCAL_CLIENT_ADDRESSES.map(address => limit.handler.resetKey(address))
    )
  );

export async function resetAuthRateLimiterStoreForTesting() {
  await authRateLimiterStore.resetAll();
  await operationalRateLimiterStore.resetAll();
  await batchRateLimiterStore.resetAll();
  await resetParseServerRateLimiters();
}

export function reportMissingTrustProxy({ env = process.env, logError = console.error } = {}) {
  const isMissing = env.NODE_ENV === 'production' && !Number(env.TRUST_PROXY_HOPS);
  if (isMissing) {
    logError(PRODUCTION_PROXY_WARNING);
  }
  return isMissing;
}
