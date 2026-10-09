const SWEEP_THRESHOLD = 1000;

const recentCalls = (timestamps, now, windowMs) =>
  timestamps
    .map(timestamp => Math.min(timestamp, now))
    .filter(timestamp => timestamp > now - windowMs);

export const createUserCallLimiter = () => {
  const calls = new Map();

  const sweepExpired = (now, windowMs) => {
    for (const [key, timestamps] of calls) {
      if (recentCalls(timestamps, now, windowMs).length === 0) calls.delete(key);
    }
  };

  const tryConsume = (key, { limit, windowMs, now = Date.now }) => {
    const current = now();
    if (calls.size > SWEEP_THRESHOLD) sweepExpired(current, windowMs);
    const recent = recentCalls(calls.get(key) ?? [], current, windowMs);
    if (recent.length >= limit) {
      calls.set(key, recent);
      return false;
    }
    calls.set(key, [...recent, current]);
    return true;
  };

  const reset = () => calls.clear();

  const size = () => calls.size;

  return { tryConsume, reset, size };
};
