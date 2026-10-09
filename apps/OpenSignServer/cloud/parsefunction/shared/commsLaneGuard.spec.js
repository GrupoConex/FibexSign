import {
  Admission,
  CommsLane,
  admitRequest,
  closeLane,
  normalizeLane,
  recordFailureStatus,
  reserveBulkTokens,
  resetCommsLaneGuard,
  settleProbe,
} from './commsLaneGuard.js';

const MINUTE_MS = 60 * 1000;

describe('commsLaneGuard', () => {
  const now = () => 5000;

  beforeEach(() => {
    resetCommsLaneGuard();
  });

  afterAll(() => {
    resetCommsLaneGuard();
  });

  it('normalizes unknown lanes to bulk', () => {
    expect(normalizeLane('critical')).toBe(CommsLane.CRITICAL);
    expect(normalizeLane('system')).toBe(CommsLane.SYSTEM);
    expect(normalizeLane('anything')).toBe(CommsLane.BULK);
    expect(normalizeLane(undefined)).toBe(CommsLane.BULK);
  });

  it('admits requests while the lane is closed', () => {
    expect(admitRequest(CommsLane.BULK, now)).toBe(Admission.CLOSED);
  });

  it('keeps the longest cooldown when a shorter trip arrives later', () => {
    recordFailureStatus(CommsLane.BULK, 423, now);
    recordFailureStatus(CommsLane.BULK, 429, now);

    expect(admitRequest(CommsLane.BULK, () => 5000 + MINUTE_MS)).toBe(Admission.BLOCKED);
  });

  it('hands out a single probe after the cooldown and closes on request', () => {
    recordFailureStatus(CommsLane.BULK, 429, now);
    const later = () => 5000 + MINUTE_MS;

    expect(admitRequest(CommsLane.BULK, later)).toBe(Admission.PROBE);
    expect(admitRequest(CommsLane.BULK, later)).toBe(Admission.BLOCKED);
    settleProbe(CommsLane.BULK);
    expect(admitRequest(CommsLane.BULK, later)).toBe(Admission.PROBE);
    closeLane(CommsLane.BULK);
    settleProbe(CommsLane.BULK);
    expect(admitRequest(CommsLane.BULK, later)).toBe(Admission.CLOSED);
  });

  it('backs off the system and critical lanes for five seconds on 429', () => {
    recordFailureStatus(CommsLane.SYSTEM, 429, now);
    recordFailureStatus(CommsLane.CRITICAL, 429, now);

    expect(admitRequest(CommsLane.SYSTEM, () => 5000 + 4999)).toBe(Admission.BLOCKED);
    expect(admitRequest(CommsLane.CRITICAL, () => 5000 + 5000)).toBe(Admission.PROBE);
    expect(admitRequest(CommsLane.BULK, now)).toBe(Admission.CLOSED);
  });

  it('ignores statuses that are not breaker statuses', () => {
    recordFailureStatus(CommsLane.BULK, 502, now);

    expect(admitRequest(CommsLane.BULK, now)).toBe(Admission.CLOSED);
  });

  it('reserves tokens from a full bucket and refuses when short', () => {
    const env = { COMMS_BULK_PER_MINUTE: '2', COMMS_MAX_RECIPIENTS: '2' };

    expect(reserveBulkTokens(2, env, now)).toBe(true);
    expect(reserveBulkTokens(1, env, now)).toBe(false);
  });

  it('uses the larger of the budget and the recipient cap as capacity', () => {
    const env = { COMMS_BULK_PER_MINUTE: '2', COMMS_MAX_RECIPIENTS: '6' };

    expect(reserveBulkTokens(6, env, now)).toBe(true);
    expect(reserveBulkTokens(1, env, now)).toBe(false);
  });
});
