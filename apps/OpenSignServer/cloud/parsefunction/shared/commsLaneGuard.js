export const CommsLane = Object.freeze({ BULK: 'bulk', SYSTEM: 'system', CRITICAL: 'critical' });

export const Admission = Object.freeze({ CLOSED: 'closed', PROBE: 'probe', BLOCKED: 'blocked' });

const MINUTE_MS = 60 * 1000;
const IP_LOCK_COOLDOWN_MS = 15 * MINUTE_MS;
const SHORT_BACKOFF_MS = 5000;
const DEFAULT_BULK_PER_MINUTE = 40;
const DEFAULT_MAX_RECIPIENTS = 20;
const ALL_LANES = Object.freeze([CommsLane.BULK, CommsLane.SYSTEM, CommsLane.CRITICAL]);
const GLOBAL_TRIP_STATUSES = Object.freeze([401, 403, 423]);
const RATE_LIMIT_STATUS = 429;

const BREAKER_COOLDOWNS_MS = Object.freeze({
  401: MINUTE_MS,
  403: MINUTE_MS,
  429: MINUTE_MS,
  423: IP_LOCK_COOLDOWN_MS,
});

const RATE_LIMIT_COOLDOWNS_MS = Object.freeze({
  [CommsLane.BULK]: MINUTE_MS,
  [CommsLane.SYSTEM]: SHORT_BACKOFF_MS,
  [CommsLane.CRITICAL]: SHORT_BACKOFF_MS,
});

const idleLane = () => ({ openUntil: 0, probing: false });

const initialState = () => ({
  lanes: Object.fromEntries(ALL_LANES.map(lane => [lane, idleLane()])),
  bucket: null,
});

let state = initialState();

const patchLane = (lane, patch) => {
  state = {
    ...state,
    lanes: { ...state.lanes, [lane]: { ...state.lanes[lane], ...patch } },
  };
};

export const resetCommsLaneGuard = () => {
  state = initialState();
};

export const normalizeLane = lane => (ALL_LANES.includes(lane) ? lane : CommsLane.BULK);

export const admitRequest = (lane, now) => {
  const { openUntil, probing } = state.lanes[lane];
  if (openUntil === 0) return Admission.CLOSED;
  if (probing || now() < openUntil) return Admission.BLOCKED;
  patchLane(lane, { probing: true });
  return Admission.PROBE;
};

export const settleProbe = lane => patchLane(lane, { probing: false });

export const closeLane = lane => patchLane(lane, { openUntil: 0 });

const trippedLanes = (status, lane) => {
  if (GLOBAL_TRIP_STATUSES.includes(status)) return ALL_LANES;
  return status === RATE_LIMIT_STATUS ? [lane] : [];
};

const cooldownFor = (status, lane) =>
  status === RATE_LIMIT_STATUS ? RATE_LIMIT_COOLDOWNS_MS[lane] : BREAKER_COOLDOWNS_MS[status];

export const recordFailureStatus = (lane, status, now) => {
  const cooldown = cooldownFor(status, lane);
  if (!cooldown) return;
  trippedLanes(status, lane).forEach(tripped =>
    patchLane(tripped, { openUntil: Math.max(state.lanes[tripped].openUntil, now() + cooldown) })
  );
};

const positiveIntegerOr = (value, fallback) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

export const resolveMaxRecipients = env =>
  positiveIntegerOr(env.COMMS_MAX_RECIPIENTS, DEFAULT_MAX_RECIPIENTS);

const resolveBulkCapacity = env =>
  Math.max(
    positiveIntegerOr(env.COMMS_BULK_PER_MINUTE, DEFAULT_BULK_PER_MINUTE),
    resolveMaxRecipients(env)
  );

const refillBucket = (bucket, capacity, nowMs) => {
  if (!bucket) return { tokens: capacity, updatedAt: nowMs };
  const elapsed = Math.max(0, nowMs - bucket.updatedAt);
  const tokens = Math.min(capacity, bucket.tokens + (elapsed * capacity) / MINUTE_MS);
  return { tokens, updatedAt: nowMs };
};

export const reserveBulkTokens = (count, env, now) => {
  const refilled = refillBucket(state.bucket, resolveBulkCapacity(env), now());
  const granted = refilled.tokens >= count;
  const tokens = granted ? refilled.tokens - count : refilled.tokens;
  state = { ...state, bucket: { ...refilled, tokens } };
  return granted;
};
