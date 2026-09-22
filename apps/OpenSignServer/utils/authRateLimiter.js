import rateLimit, { ipKeyGenerator, MemoryStore } from 'express-rate-limit';

const AUTH_RATE_LIMITED_PATH_SUFFIXES = [
  '/login',
  '/requestPasswordReset',
  '/functions/loginuser',
  '/functions/AuthLoginAsMail',
  '/functions/SendOTPMailV1',
  '/functions/addadmin',
  '/functions/usersignup',
  '/functions/getUserDetails',
  '/functions/declinedoc',
];

export function isAuthRateLimitedPath(requestPath) {
  return AUTH_RATE_LIMITED_PATH_SUFFIXES.some(suffix => requestPath.endsWith(suffix));
}

const authRateLimiterStore = new MemoryStore();

export function buildAuthRateLimiterMiddleware() {
  const windowMs = Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS) || 5 * 60 * 1000;
  const max = Number(process.env.AUTH_RATE_LIMIT_MAX) || 20;

  const limiter = rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    store: authRateLimiterStore,
    keyGenerator: request => `${ipKeyGenerator(request.ip)}:${request.path}`,
  });

  return function authRateLimiterMiddleware(request, response, next) {
    if (isAuthRateLimitedPath(request.path)) {
      return limiter(request, response, next);
    }
    return next();
  };
}

export async function resetAuthRateLimiterStoreForTesting() {
  await authRateLimiterStore.resetAll();
}
