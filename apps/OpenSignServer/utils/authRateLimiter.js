import rateLimit, { ipKeyGenerator, MemoryStore } from 'express-rate-limit';

export const STRICT_AUTH_PATH_SUFFIXES = [
  '/login',
  '/requestPasswordReset',
  '/functions/loginuser',
  '/functions/AuthLoginAsMail',
  '/functions/SendOTPMailV1',
  '/functions/addadmin',
  '/functions/usersignup',
];

export const OPERATIONAL_PATH_SUFFIXES = ['/functions/getUserDetails', '/functions/declinedoc'];

const AUTH_RATE_LIMITED_PATH_SUFFIXES = [
  ...STRICT_AUTH_PATH_SUFFIXES,
  ...OPERATIONAL_PATH_SUFFIXES,
];

export function isAuthRateLimitedPath(requestPath) {
  return AUTH_RATE_LIMITED_PATH_SUFFIXES.some(suffix => requestPath.endsWith(suffix));
}

export function isStrictAuthPath(requestPath) {
  return STRICT_AUTH_PATH_SUFFIXES.some(suffix => requestPath.endsWith(suffix));
}

const authRateLimiterStore = new MemoryStore();
const operationalRateLimiterStore = new MemoryStore();

export function buildAuthRateLimiterMiddleware() {
  const windowMs = Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS) || 5 * 60 * 1000;
  const authMax = Number(process.env.AUTH_RATE_LIMIT_MAX) || 30;
  const operationalMax =
    Number(process.env.OPERATIONAL_RATE_LIMIT_MAX) ||
    (process.env.AUTH_RATE_LIMIT_MAX ? Number(process.env.AUTH_RATE_LIMIT_MAX) * 10 : 300);

  const authLimiter = rateLimit({
    windowMs,
    max: authMax,
    standardHeaders: true,
    legacyHeaders: false,
    store: authRateLimiterStore,
    keyGenerator: request => `${ipKeyGenerator(request.ip)}:${request.path}`,
    message: { error: 'Too many requests, please try again later.' },
  });

  const operationalLimiter = rateLimit({
    windowMs,
    max: operationalMax,
    standardHeaders: true,
    legacyHeaders: false,
    store: operationalRateLimiterStore,
    keyGenerator: request => `${ipKeyGenerator(request.ip)}:${request.path}`,
    message: { error: 'Too many requests, please try again later.' },
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

export async function resetAuthRateLimiterStoreForTesting() {
  await authRateLimiterStore.resetAll();
  await operationalRateLimiterStore.resetAll();
}
