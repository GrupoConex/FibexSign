import {
  CommsLane,
  resetCommsMailBreaker,
  sendCommsMail,
} from '../../../cloud/parsefunction/shared/commsMailClient.js';

const ENV = { COMMS_BASE_URL: 'https://comms.test', COMMS_API_KEY: 'test-key' };
const MINUTE_MS = 60 * 1000;
const IP_LOCK_MS = 15 * MINUTE_MS;
const CRITICAL_BACKOFF_MS = 5000;
const SYSTEM_BACKOFF_MS = 5000;
const message = { to: 'a@x.com', subject: 'Hi', text: 'body' };

const jsonResponse = status => ({ status, json: async () => ({}) });

const buildFetch = (responses = [jsonResponse(201)]) => {
  const queue = [...responses];
  return jasmine
    .createSpy('fetch')
    .and.callFake(async () => (queue.length > 1 ? queue.shift() : queue[0]));
};

const buildClock = start => {
  let current = start;
  return {
    now: () => current,
    advance: ms => {
      current += ms;
    },
  };
};

const capture = async promise => {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  return undefined;
};

const send = (lane, fetchImpl, clock, env = ENV, msg = message) =>
  sendCommsMail(msg, { env, fetchImpl, now: clock.now, ...(lane ? { lane } : {}) });

const sendRepeatedly = async (times, lane, fetchImpl, clock, env) => {
  for (let index = 0; index < times; index += 1) {
    await capture(send(lane, fetchImpl, clock, env));
  }
};

describe('commsMailClient lanes', () => {
  beforeEach(() => {
    resetCommsMailBreaker();
  });

  afterAll(() => {
    resetCommsMailBreaker();
  });

  it('exposes the bulk, system and critical lanes', () => {
    expect(CommsLane).toEqual({ BULK: 'bulk', SYSTEM: 'system', CRITICAL: 'critical' });
  });

  describe('429 isolation', () => {
    it('blocks the bulk lane but keeps the critical lane sending', async () => {
      const clock = buildClock(1000);
      await capture(send(CommsLane.BULK, buildFetch([jsonResponse(429)]), clock));
      const healthy = buildFetch();

      const bulk = await capture(send(CommsLane.BULK, healthy, clock));
      const critical = await send(CommsLane.CRITICAL, healthy, clock);

      expect(bulk.reason).toBe('circuit_open');
      expect(critical.length).toBe(1);
      expect(healthy).toHaveBeenCalledTimes(1);
    });

    it('defaults to the bulk lane', async () => {
      const clock = buildClock(1000);
      await capture(send(undefined, buildFetch([jsonResponse(429)]), clock));

      const bulk = await capture(send(CommsLane.BULK, buildFetch(), clock));

      expect(bulk.reason).toBe('circuit_open');
    });

    it('opens only the critical lane for a short backoff and probes afterwards', async () => {
      const clock = buildClock(1000);
      const critical = await capture(
        send(CommsLane.CRITICAL, buildFetch([jsonResponse(429)]), clock)
      );
      const healthy = buildFetch();

      const blocked = await capture(send(CommsLane.CRITICAL, healthy, clock));
      const bulk = await send(CommsLane.BULK, healthy, clock);
      const system = await send(CommsLane.SYSTEM, healthy, clock);
      clock.advance(CRITICAL_BACKOFF_MS - 1);
      const stillBlocked = await capture(send(CommsLane.CRITICAL, healthy, clock));
      clock.advance(1);
      const probe = await send(CommsLane.CRITICAL, healthy, clock);

      expect(critical.reason).toBe('rate_limited');
      expect(blocked.reason).toBe('circuit_open');
      expect(stillBlocked.reason).toBe('circuit_open');
      expect(bulk.length).toBe(1);
      expect(system.length).toBe(1);
      expect(probe.length).toBe(1);
    });

    it('opens only the system lane for a short backoff', async () => {
      const clock = buildClock(1000);
      await capture(send(CommsLane.SYSTEM, buildFetch([jsonResponse(429)]), clock));
      const healthy = buildFetch();

      const blocked = await capture(send(CommsLane.SYSTEM, healthy, clock));
      const bulk = await send(CommsLane.BULK, healthy, clock);
      const critical = await send(CommsLane.CRITICAL, healthy, clock);
      clock.advance(SYSTEM_BACKOFF_MS);
      const recovered = await send(CommsLane.SYSTEM, healthy, clock);

      expect(blocked.reason).toBe('circuit_open');
      expect(bulk.length).toBe(1);
      expect(critical.length).toBe(1);
      expect(recovered.length).toBe(1);
    });

    it('does not open the system lane when the bulk lane receives 429', async () => {
      const clock = buildClock(1000);
      await capture(send(CommsLane.BULK, buildFetch([jsonResponse(429)]), clock));

      const system = await send(CommsLane.SYSTEM, buildFetch(), clock);

      expect(system.length).toBe(1);
    });
  });

  [
    [401, MINUTE_MS],
    [403, MINUTE_MS],
    [423, IP_LOCK_MS],
  ].forEach(([status, cooldown]) => {
    [CommsLane.BULK, CommsLane.SYSTEM, CommsLane.CRITICAL].forEach(trippingLane => {
      it(`${status} from the ${trippingLane} lane blocks both lanes for ${cooldown}ms`, async () => {
        const clock = buildClock(1000);
        await capture(send(trippingLane, buildFetch([jsonResponse(status)]), clock));
        const healthy = buildFetch();

        clock.advance(cooldown - 1);
        const bulk = await capture(send(CommsLane.BULK, healthy, clock));
        const system = await capture(send(CommsLane.SYSTEM, healthy, clock));
        const critical = await capture(send(CommsLane.CRITICAL, healthy, clock));

        expect(bulk.reason).toBe('circuit_open');
        expect(system.reason).toBe('circuit_open');
        expect(critical.reason).toBe('circuit_open');
        expect(healthy).not.toHaveBeenCalled();
      });
    });
  });

  describe('half-open probe', () => {
    const openBulk = async clock => {
      await capture(send(CommsLane.BULK, buildFetch([jsonResponse(429)]), clock));
      clock.advance(MINUTE_MS);
    };

    it('lets one probe through and closes the lane on success', async () => {
      const clock = buildClock(1000);
      await openBulk(clock);
      const healthy = buildFetch();

      await send(CommsLane.BULK, healthy, clock);
      await send(CommsLane.BULK, healthy, clock);

      expect(healthy).toHaveBeenCalledTimes(2);
    });

    it('re-opens the lane when the probe is answered with a breaker status', async () => {
      const clock = buildClock(1000);
      await openBulk(clock);
      const probe = await capture(send(CommsLane.BULK, buildFetch([jsonResponse(429)]), clock));
      const healthy = buildFetch();

      const blocked = await capture(send(CommsLane.BULK, healthy, clock));
      clock.advance(MINUTE_MS);
      const recovered = await send(CommsLane.BULK, healthy, clock);

      expect(probe.reason).toBe('rate_limited');
      expect(blocked.reason).toBe('circuit_open');
      expect(recovered.length).toBe(1);
    });

    it('rejects concurrent requests while the probe is in flight', async () => {
      const clock = buildClock(1000);
      await openBulk(clock);
      let releaseProbe;
      const slow = jasmine.createSpy('slow').and.callFake(
        () =>
          new Promise(resolve => {
            releaseProbe = () => resolve(jsonResponse(201));
          })
      );
      const probe = send(CommsLane.BULK, slow, clock);
      await Promise.resolve();
      const other = buildFetch();

      const concurrent = await capture(send(CommsLane.BULK, other, clock));
      releaseProbe();
      await probe;

      expect(concurrent.reason).toBe('circuit_open');
      expect(other).not.toHaveBeenCalled();
    });

    it('allows another probe when the probe fails without a breaker status', async () => {
      const clock = buildClock(1000);
      await openBulk(clock);
      await capture(send(CommsLane.BULK, buildFetch([jsonResponse(502)]), clock));
      const healthy = buildFetch();

      const results = await send(CommsLane.BULK, healthy, clock);

      expect(results.length).toBe(1);
    });
  });

  describe('bulk token bucket', () => {
    const env = { ...ENV, COMMS_BULK_PER_MINUTE: '3', COMMS_MAX_RECIPIENTS: '3' };

    it('fails fast with local_rate_limited once the budget is exhausted', async () => {
      const clock = buildClock(1000);
      const fetchImpl = buildFetch();
      await sendRepeatedly(3, CommsLane.BULK, fetchImpl, clock, env);

      const thrown = await capture(send(CommsLane.BULK, fetchImpl, clock, env));

      expect(thrown.reason).toBe('local_rate_limited');
      expect(thrown.message).toBe('Comms mail failed: local_rate_limited');
      expect(fetchImpl).toHaveBeenCalledTimes(3);
    });

    it('does not open the breaker when the local budget is exhausted', async () => {
      const clock = buildClock(1000);
      const fetchImpl = buildFetch();
      await sendRepeatedly(4, CommsLane.BULK, fetchImpl, clock, env);

      clock.advance(MINUTE_MS / 3);
      const results = await send(CommsLane.BULK, fetchImpl, clock, env);

      expect(results.length).toBe(1);
    });

    it('refills proportionally with time', async () => {
      const clock = buildClock(1000);
      const fetchImpl = buildFetch();
      await sendRepeatedly(3, CommsLane.BULK, fetchImpl, clock, env);

      clock.advance(MINUTE_MS / 3 - 1);
      const early = await capture(send(CommsLane.BULK, fetchImpl, clock, env));
      clock.advance(1);
      const refilled = await send(CommsLane.BULK, fetchImpl, clock, env);

      expect(early.reason).toBe('local_rate_limited');
      expect(refilled.length).toBe(1);
    });

    it('never refills above capacity', async () => {
      const clock = buildClock(1000);
      const fetchImpl = buildFetch();
      await send(CommsLane.BULK, fetchImpl, clock, env);
      clock.advance(10 * MINUTE_MS);
      await sendRepeatedly(3, CommsLane.BULK, fetchImpl, clock, env);

      const thrown = await capture(send(CommsLane.BULK, fetchImpl, clock, env));

      expect(thrown.reason).toBe('local_rate_limited');
    });

    it('consumes one token per recipient and rejects the whole send when short', async () => {
      const clock = buildClock(1000);
      const fetchImpl = buildFetch();
      const pair = { ...message, to: 'a@x.com,b@x.com' };
      const triple = { ...message, to: 'a@x.com,b@x.com,c@x.com' };

      const first = await send(CommsLane.BULK, fetchImpl, clock, env, pair);
      const thrown = await capture(send(CommsLane.BULK, fetchImpl, clock, env, triple));
      const last = await send(CommsLane.BULK, fetchImpl, clock, env);

      expect(first.length).toBe(2);
      expect(thrown.reason).toBe('local_rate_limited');
      expect(last.length).toBe(1);
    });

    it('defaults to 40 per minute', async () => {
      const clock = buildClock(1000);
      const fetchImpl = buildFetch();
      await sendRepeatedly(40, CommsLane.BULK, fetchImpl, clock, ENV);

      const thrown = await capture(send(CommsLane.BULK, fetchImpl, clock));

      expect(thrown.reason).toBe('local_rate_limited');
    });

    ['0', '-1', 'abc', '1.5', ''].forEach(invalid => {
      it(`falls back to 40 when COMMS_BULK_PER_MINUTE is "${invalid}"`, async () => {
        const clock = buildClock(1000);
        const fetchImpl = buildFetch();
        const invalidEnv = { ...ENV, COMMS_BULK_PER_MINUTE: invalid };
        await sendRepeatedly(40, CommsLane.BULK, fetchImpl, clock, invalidEnv);

        const thrown = await capture(send(CommsLane.BULK, fetchImpl, clock, invalidEnv));

        expect(thrown.reason).toBe('local_rate_limited');
      });
    });

    it('never limits the critical lane locally and does not drain the bulk budget', async () => {
      const clock = buildClock(1000);
      const fetchImpl = buildFetch();
      await sendRepeatedly(10, CommsLane.CRITICAL, fetchImpl, clock, env);

      const results = await send(CommsLane.BULK, fetchImpl, clock, env);

      expect(results.length).toBe(1);
      expect(fetchImpl).toHaveBeenCalledTimes(11);
    });

    it('never limits the system lane locally and does not drain the bulk budget', async () => {
      const clock = buildClock(1000);
      const fetchImpl = buildFetch();
      await sendRepeatedly(10, CommsLane.SYSTEM, fetchImpl, clock, env);

      const results = await send(CommsLane.BULK, fetchImpl, clock, env);

      expect(results.length).toBe(1);
      expect(fetchImpl).toHaveBeenCalledTimes(11);
    });

    it('keeps the system lane sending after the bulk budget is exhausted', async () => {
      const clock = buildClock(1000);
      const fetchImpl = buildFetch();
      await sendRepeatedly(4, CommsLane.BULK, fetchImpl, clock, env);

      const results = await send(CommsLane.SYSTEM, fetchImpl, clock, env);

      expect(results.length).toBe(1);
      expect(fetchImpl).toHaveBeenCalledTimes(4);
    });

    it('grants a max sized send by using COMMS_MAX_RECIPIENTS as minimum capacity', async () => {
      const clock = buildClock(1000);
      const fetchImpl = buildFetch();
      const wideEnv = { ...env, COMMS_MAX_RECIPIENTS: '5' };
      const five = { ...message, to: 'a@x.com,b@x.com,c@x.com,d@x.com,e@x.com' };

      const results = await send(CommsLane.BULK, fetchImpl, clock, wideEnv, five);

      expect(results.length).toBe(5);
    });

    it('uses the default recipient cap as minimum capacity when the budget is smaller', async () => {
      const clock = buildClock(1000);
      const fetchImpl = buildFetch();
      const tinyEnv = { ...ENV, COMMS_BULK_PER_MINUTE: '2' };
      const twenty = { ...message, to: Array.from({ length: 20 }, (_, i) => `u${i}@x.com`) };

      const results = await send(CommsLane.BULK, fetchImpl, clock, tinyEnv, twenty);

      expect(results.length).toBe(20);
    });

    it('does not refill or drain when the clock goes backwards', async () => {
      const clock = buildClock(100000);
      const fetchImpl = buildFetch();
      await sendRepeatedly(3, CommsLane.BULK, fetchImpl, clock, env);

      clock.advance(-90000);
      const stuck = await capture(send(CommsLane.BULK, fetchImpl, clock, env));
      clock.advance(MINUTE_MS / 3);
      const refilled = await send(CommsLane.BULK, fetchImpl, clock, env);

      expect(stuck.reason).toBe('local_rate_limited');
      expect(refilled.length).toBe(1);
    });
  });
});
