let hasWarnedMissingAllowedOrigins = false;

export function resolveCorsAllowedOrigins() {
  const rawAllowedOrigins = process.env.CORS_ALLOWED_ORIGINS;
  const allowedOrigins = rawAllowedOrigins
    ? rawAllowedOrigins
        .split(',')
        .map(origin => origin.trim())
        .filter(Boolean)
    : [];

  if (allowedOrigins.length === 0 && !hasWarnedMissingAllowedOrigins) {
    hasWarnedMissingAllowedOrigins = true;
    console.warn(
      'CORS_ALLOWED_ORIGINS not set — cross-origin requests will be rejected. Set it to your frontend URL(s) in production.'
    );
  }

  return allowedOrigins;
}

export function buildCorsOptions() {
  const allowedOrigins = resolveCorsAllowedOrigins();

  return {
    origin: function (requestOrigin, callback) {
      if (!requestOrigin) {
        return callback(null, true);
      }
      if (allowedOrigins.includes(requestOrigin)) {
        return callback(null, true);
      }
      return callback(null, false);
    },
  };
}
