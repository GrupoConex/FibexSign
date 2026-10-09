import { randomUUID } from 'node:crypto';
import {
  Admission,
  CommsLane,
  admitRequest,
  closeLane,
  normalizeLane,
  recordFailureStatus,
  reserveBulkTokens,
  resolveMaxRecipients,
  resetCommsLaneGuard,
  settleProbe,
} from './commsLaneGuard.js';

export { CommsLane };

const SEND_PATH = '/api/v1/emails/send';
const DEFAULT_TIMEOUT_MS = 8000;
const SUCCESS_STATUSES = [200, 201];

const STATUS_REASONS = Object.freeze({
  400: 'invalid_request',
  401: 'unauthorized',
  403: 'forbidden',
  409: 'idempotency_conflict',
  422: 'invalid_request',
  423: 'ip_locked',
  429: 'rate_limited',
});

export class CommsMailError extends Error {
  constructor(reason, status) {
    super(`Comms mail failed: ${reason}${status ? ` (status ${status})` : ''}`);
    this.name = 'CommsMailError';
    this.reason = reason;
    this.status = status;
  }
}

export const resetCommsMailBreaker = resetCommsLaneGuard;

const toAddressList = value => {
  if (!value) return [];
  const items = Array.isArray(value) ? value : String(value).split(',');
  return items.map(item => String(item).trim().toLowerCase()).filter(Boolean);
};

export const collectRecipients = ({ to, cc, bcc } = {}) => [
  ...new Set([...toAddressList(to), ...toAddressList(cc), ...toAddressList(bcc)]),
];

export const isCommsMailEnabled = (env = process.env) =>
  Boolean(env.COMMS_BASE_URL?.trim() && env.COMMS_API_KEY?.trim());

const parseBaseUrl = env => {
  try {
    return new URL(env.COMMS_BASE_URL.trim());
  } catch {
    throw new CommsMailError('invalid_base_url');
  }
};

const isAllowedProtocol = (protocol, env) =>
  protocol === 'https:' || (protocol === 'http:' && env.NODE_ENV !== 'production');

const resolveSendUrl = env => {
  const base = parseBaseUrl(env);
  if (base.username || base.password || !isAllowedProtocol(base.protocol, env)) {
    throw new CommsMailError('invalid_base_url');
  }
  return `${base.origin}${base.pathname.replace(/\/+$/, '')}${SEND_PATH}`;
};

const resolveRecipients = (message, env) => {
  const recipients = collectRecipients(message);
  if (recipients.length === 0) throw new CommsMailError('no_recipients');
  if (recipients.length > resolveMaxRecipients(env)) {
    throw new CommsMailError('too_many_recipients');
  }
  return recipients;
};

const admitOrThrow = (lane, now) => {
  const admission = admitRequest(lane, now);
  if (admission === Admission.BLOCKED) throw new CommsMailError('circuit_open');
  return admission;
};

const reserveBudgetOrThrow = (lane, count, env, now) => {
  if (lane === CommsLane.BULK && !reserveBulkTokens(count, env, now)) {
    throw new CommsMailError('local_rate_limited');
  }
};

const buildBody = (recipient, { subject, text, html, metadata }) => ({
  to: recipient,
  subject,
  ...(text ? { text } : {}),
  ...(html ? { html } : {}),
  ...(metadata ? { metadata } : {}),
});

const reasonForStatus = status =>
  STATUS_REASONS[status] ?? (status >= 500 ? 'provider_error' : 'unexpected_response');

const postToComms = async (url, recipient, message, { env, fetchImpl, timeoutMs }) => {
  try {
    return await fetchImpl(url, {
      method: 'POST',
      redirect: 'error',
      headers: {
        Authorization: `Bearer ${env.COMMS_API_KEY.trim()}`,
        'Idempotency-Key': randomUUID(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildBody(recipient, message)),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new CommsMailError('network_error');
  }
};

const sendToRecipient = async (url, recipient, message, options) => {
  const response = await postToComms(url, recipient, message, options);
  if (!SUCCESS_STATUSES.includes(response.status)) {
    recordFailureStatus(options.lane, response.status, options.now);
    throw new CommsMailError(reasonForStatus(response.status), response.status);
  }
  return { recipient, httpStatus: response.status };
};

const sendAll = async (recipients, url, message, options) => {
  const results = [];
  for (const recipient of recipients) {
    const result = await sendToRecipient(url, recipient, message, options);
    if (results.length === 0 && options.isProbe) closeLane(options.lane);
    results.push(result);
  }
  return results;
};

export const sendCommsMail = async (
  message,
  {
    env = process.env,
    fetchImpl = fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    now = Date.now,
    lane: requestedLane = CommsLane.BULK,
  } = {}
) => {
  const lane = normalizeLane(requestedLane);
  const recipients = resolveRecipients(message, env);
  const url = resolveSendUrl(env);
  const isProbe = admitOrThrow(lane, now) === Admission.PROBE;
  try {
    reserveBudgetOrThrow(lane, recipients.length, env, now);
    const options = { env, fetchImpl, timeoutMs, now, lane, isProbe };
    return await sendAll(recipients, url, message, options);
  } finally {
    if (isProbe) settleProbe(lane);
  }
};
