import {
  CommsMailError,
  collectRecipients,
  isCommsMailEnabled,
  resetCommsMailBreaker,
  sendCommsMail,
} from '../../../cloud/parsefunction/shared/commsMailClient.js';

const ENV = { COMMS_BASE_URL: 'https://comms.test', COMMS_API_KEY: 'test-key' };
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SECRET_HTML = '<p>secret-otp-123456</p>';
const SECRET_TEXT = 'secret-otp-123456';
const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const IP_LOCK_MS = 15 * MINUTE_MS;

const jsonResponse = (status, body = {}) => ({ status, json: async () => body });

const buildFetch = (responses = [jsonResponse(201, { status: 'SENT' })]) => {
  const queue = [...responses];
  return jasmine
    .createSpy('fetch')
    .and.callFake(async () => (queue.length > 1 ? queue.shift() : queue[0]));
};

const baseMessage = { to: 'a@x.com', subject: 'Hi', text: SECRET_TEXT, html: SECRET_HTML };

const captureRejection = async promise => {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  return undefined;
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

describe('commsMailClient', () => {
  beforeEach(() => {
    resetCommsMailBreaker();
  });

  afterAll(() => {
    resetCommsMailBreaker();
  });

  describe('isCommsMailEnabled', () => {
    it('returns true when base url and api key are present', () => {
      expect(isCommsMailEnabled(ENV)).toBe(true);
    });

    it('returns false when api key is missing', () => {
      expect(isCommsMailEnabled({ COMMS_BASE_URL: 'https://x' })).toBe(false);
    });

    it('returns false when base url is blank', () => {
      expect(isCommsMailEnabled({ COMMS_BASE_URL: '  ', COMMS_API_KEY: 'k' })).toBe(false);
    });

    it('returns false for empty environment', () => {
      expect(isCommsMailEnabled({})).toBe(false);
    });
  });

  describe('collectRecipients', () => {
    it('returns empty list when nothing is provided', () => {
      expect(collectRecipients()).toEqual([]);
      expect(collectRecipients({})).toEqual([]);
    });

    it('splits, trims, lowercases and dedupes across to, cc and bcc', () => {
      const result = collectRecipients({
        to: 'A@x.com, b@x.com',
        cc: ['B@x.com ', 'c@x.com'],
        bcc: 'd@x.com,,',
      });

      expect(result).toEqual(['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com']);
    });
  });

  describe('sendCommsMail delivery', () => {
    it('resolves with one result on 201', async () => {
      const fetchImpl = buildFetch([jsonResponse(201, { status: 'SENT' })]);

      const results = await sendCommsMail(baseMessage, { env: ENV, fetchImpl });

      expect(results).toEqual([{ recipient: 'a@x.com', httpStatus: 201 }]);
    });

    it('treats 200 duplicate as success', async () => {
      const fetchImpl = buildFetch([jsonResponse(200, { status: 'DUPLICATE' })]);

      const results = await sendCommsMail(baseMessage, { env: ENV, fetchImpl });

      expect(results[0].httpStatus).toBe(200);
    });

    it('posts with bearer, json and idempotency headers and refuses redirects', async () => {
      const fetchImpl = buildFetch();

      await sendCommsMail(baseMessage, { env: ENV, fetchImpl });

      const [url, init] = fetchImpl.calls.mostRecent().args;
      expect(url).toBe('https://comms.test/api/v1/emails/send');
      expect(init.method).toBe('POST');
      expect(init.redirect).toBe('error');
      expect(init.headers.Authorization).toBe('Bearer test-key');
      expect(init.headers['Content-Type']).toBe('application/json');
      expect(init.headers['Idempotency-Key']).toMatch(UUID_PATTERN);
      expect(init.signal).toBeDefined();
    });

    it('sends only supported body fields', async () => {
      const fetchImpl = buildFetch();

      await sendCommsMail(
        { ...baseMessage, cc: 'c@x.com', bcc: 'd@x.com', metadata: { k: 'v' }, attachments: [1] },
        { env: ENV, fetchImpl }
      );

      const body = JSON.parse(fetchImpl.calls.first().args[1].body);
      expect(body).toEqual({
        to: 'a@x.com',
        subject: 'Hi',
        text: SECRET_TEXT,
        html: SECRET_HTML,
        metadata: { k: 'v' },
      });
    });

    it('omits text, html and metadata when absent', async () => {
      const fetchImpl = buildFetch();

      await sendCommsMail({ to: 'a@x.com', subject: 'S' }, { env: ENV, fetchImpl });

      expect(JSON.parse(fetchImpl.calls.first().args[1].body)).toEqual({
        to: 'a@x.com',
        subject: 'S',
      });
    });

    it('sends one request per unique recipient with unique idempotency keys', async () => {
      const fetchImpl = buildFetch();

      const results = await sendCommsMail(
        { ...baseMessage, to: 'a@x.com, B@x.com', cc: ['b@x.com'], bcc: 'c@x.com' },
        { env: ENV, fetchImpl }
      );

      const keys = fetchImpl.calls.allArgs().map(args => args[1].headers['Idempotency-Key']);
      const recipients = fetchImpl.calls.allArgs().map(args => JSON.parse(args[1].body).to);
      expect(results.length).toBe(3);
      expect(recipients).toEqual(['a@x.com', 'b@x.com', 'c@x.com']);
      expect(new Set(keys).size).toBe(3);
    });

    it('stops at the first failing recipient', async () => {
      const fetchImpl = buildFetch([jsonResponse(201), jsonResponse(502, { error: 'x' })]);

      await expectAsync(
        sendCommsMail({ ...baseMessage, to: 'a@x.com,b@x.com,c@x.com' }, { env: ENV, fetchImpl })
      ).toBeRejected();

      expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it('uses global fetch and process.env by default', async () => {
      const previous = { base: process.env.COMMS_BASE_URL, key: process.env.COMMS_API_KEY };
      Object.assign(process.env, ENV);
      const fetchSpy = spyOn(globalThis, 'fetch').and.resolveTo(jsonResponse(201));

      try {
        await sendCommsMail(baseMessage);
      } finally {
        [
          ['COMMS_BASE_URL', previous.base],
          ['COMMS_API_KEY', previous.key],
        ].forEach(([key, value]) => {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        });
      }

      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('uses an 8 second timeout by default', async () => {
      const timeoutSpy = spyOn(AbortSignal, 'timeout').and.callThrough();

      await sendCommsMail(baseMessage, { env: ENV, fetchImpl: buildFetch() });

      expect(timeoutSpy).toHaveBeenCalledWith(8000);
    });
  });

  describe('sendCommsMail recipients', () => {
    it('throws when there are no recipients and makes no request', async () => {
      const fetchImpl = buildFetch();

      const thrown = await captureRejection(
        sendCommsMail({ to: ' , ', cc: [], subject: 'S' }, { env: ENV, fetchImpl })
      );

      expect(thrown).toEqual(jasmine.any(CommsMailError));
      expect(thrown.reason).toBe('no_recipients');
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('rejects above the default cap of 20 recipients before any request', async () => {
      const fetchImpl = buildFetch();
      const to = Array.from({ length: 21 }, (_, index) => `u${index}@x.com`);

      const thrown = await captureRejection(
        sendCommsMail({ ...baseMessage, to }, { env: ENV, fetchImpl })
      );

      expect(thrown.reason).toBe('too_many_recipients');
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('allows exactly the default cap', async () => {
      const fetchImpl = buildFetch();
      const to = Array.from({ length: 20 }, (_, index) => `u${index}@x.com`);

      const results = await sendCommsMail({ ...baseMessage, to }, { env: ENV, fetchImpl });

      expect(results.length).toBe(20);
    });

    it('honours COMMS_MAX_RECIPIENTS override', async () => {
      const fetchImpl = buildFetch();
      const env = { ...ENV, COMMS_MAX_RECIPIENTS: '2' };

      const thrown = await captureRejection(
        sendCommsMail({ ...baseMessage, to: 'a@x.com,b@x.com,c@x.com' }, { env, fetchImpl })
      );

      expect(thrown.reason).toBe('too_many_recipients');
    });

    ['0', '-3', 'abc', '2.5', ''].forEach(invalid => {
      it(`falls back to the default cap when COMMS_MAX_RECIPIENTS is "${invalid}"`, async () => {
        const fetchImpl = buildFetch();
        const to = Array.from({ length: 5 }, (_, index) => `u${index}@x.com`);

        const results = await sendCommsMail(
          { ...baseMessage, to },
          { env: { ...ENV, COMMS_MAX_RECIPIENTS: invalid }, fetchImpl }
        );

        expect(results.length).toBe(5);
      });
    });
  });

  describe('sendCommsMail base url validation', () => {
    const rejectsWith = async (env, reason) => {
      const fetchImpl = buildFetch();
      const thrown = await captureRejection(sendCommsMail(baseMessage, { env, fetchImpl }));
      expect(thrown).toEqual(jasmine.any(CommsMailError));
      expect(thrown.reason).toBe(reason);
      expect(fetchImpl).not.toHaveBeenCalled();
    };

    it('rejects an unparsable base url', async () => {
      await rejectsWith({ ...ENV, COMMS_BASE_URL: 'not a url' }, 'invalid_base_url');
    });

    it('rejects credentials embedded in the base url', async () => {
      await rejectsWith(
        { ...ENV, COMMS_BASE_URL: 'https://user:pw@comms.test' },
        'invalid_base_url'
      );
    });

    it('rejects username only in the base url', async () => {
      await rejectsWith({ ...ENV, COMMS_BASE_URL: 'https://user@comms.test' }, 'invalid_base_url');
    });

    it('rejects non http protocols', async () => {
      await rejectsWith({ ...ENV, COMMS_BASE_URL: 'ftp://comms.test' }, 'invalid_base_url');
    });

    it('rejects http in production', async () => {
      await rejectsWith(
        { ...ENV, COMMS_BASE_URL: 'http://comms.test', NODE_ENV: 'production' },
        'invalid_base_url'
      );
    });

    it('allows http outside production', async () => {
      const fetchImpl = buildFetch();

      await sendCommsMail(baseMessage, {
        env: { ...ENV, COMMS_BASE_URL: 'http://localhost:4000', NODE_ENV: 'development' },
        fetchImpl,
      });

      expect(fetchImpl.calls.mostRecent().args[0]).toBe('http://localhost:4000/api/v1/emails/send');
    });

    it('allows https in production', async () => {
      const fetchImpl = buildFetch();

      await sendCommsMail(baseMessage, { env: { ...ENV, NODE_ENV: 'production' }, fetchImpl });

      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('strips trailing slashes and keeps a path prefix', async () => {
      const fetchImpl = buildFetch();

      await sendCommsMail(baseMessage, {
        env: { ...ENV, COMMS_BASE_URL: 'https://comms.test/gateway//' },
        fetchImpl,
      });

      expect(fetchImpl.calls.mostRecent().args[0]).toBe(
        'https://comms.test/gateway/api/v1/emails/send'
      );
    });

    it('strips a lone trailing slash', async () => {
      const fetchImpl = buildFetch();

      await sendCommsMail(baseMessage, {
        env: { ...ENV, COMMS_BASE_URL: 'https://comms.test/' },
        fetchImpl,
      });

      expect(fetchImpl.calls.mostRecent().args[0]).toBe('https://comms.test/api/v1/emails/send');
    });
  });

  describe('sendCommsMail failures', () => {
    [
      [400, 'invalid_request'],
      [401, 'unauthorized'],
      [403, 'forbidden'],
      [409, 'idempotency_conflict'],
      [422, 'invalid_request'],
      [423, 'ip_locked'],
      [429, 'rate_limited'],
      [500, 'provider_error'],
      [502, 'provider_error'],
    ].forEach(([status, reason]) => {
      it(`maps ${status} to ${reason} without leaking response or payload`, async () => {
        const leaky = jsonResponse(status, { error: `leak ${SECRET_TEXT} a@x.com` });

        const thrown = await captureRejection(
          sendCommsMail(baseMessage, { env: ENV, fetchImpl: buildFetch([leaky]) })
        );

        expect(thrown).toEqual(jasmine.any(CommsMailError));
        expect(thrown.reason).toBe(reason);
        expect(thrown.status).toBe(status);
        expect(thrown.message).toBe(`Comms mail failed: ${reason} (status ${status})`);
        expect(thrown.message).not.toContain(SECRET_TEXT);
        expect(thrown.message).not.toContain('a@x.com');
        expect(thrown.message).not.toContain('test-key');
      });
    });

    it('maps an unexpected status to unexpected_response', async () => {
      const thrown = await captureRejection(
        sendCommsMail(baseMessage, { env: ENV, fetchImpl: buildFetch([jsonResponse(302)]) })
      );

      expect(thrown.reason).toBe('unexpected_response');
      expect(thrown.status).toBe(302);
    });

    it('maps network failures to network_error without the original message', async () => {
      const fetchImpl = jasmine
        .createSpy('fetch')
        .and.rejectWith(new TypeError('connect ECONNREFUSED 10.0.0.1'));

      const thrown = await captureRejection(sendCommsMail(baseMessage, { env: ENV, fetchImpl }));

      expect(thrown.reason).toBe('network_error');
      expect(thrown.status).toBeUndefined();
      expect(thrown.message).toBe('Comms mail failed: network_error');
    });

    it('maps timeouts to network_error', async () => {
      const fetchImpl = (url, { signal }) =>
        new Promise((resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason));
        });

      const thrown = await captureRejection(
        sendCommsMail(baseMessage, { env: ENV, fetchImpl, timeoutMs: 20 })
      );

      expect(thrown.reason).toBe('network_error');
    });
  });

  describe('sendCommsMail circuit breaker', () => {
    [
      [401, MINUTE_MS],
      [403, MINUTE_MS],
      [429, MINUTE_MS],
      [423, IP_LOCK_MS],
    ].forEach(([status, cooldown]) => {
      it(`opens for ${cooldown}ms after ${status} and fails fast without fetch`, async () => {
        const clock = buildClock(1000);
        const failing = buildFetch([jsonResponse(status)]);
        await captureRejection(
          sendCommsMail(baseMessage, { env: ENV, fetchImpl: failing, now: clock.now })
        );
        const healthy = buildFetch();

        clock.advance(cooldown - 1);
        const blocked = await captureRejection(
          sendCommsMail(baseMessage, { env: ENV, fetchImpl: healthy, now: clock.now })
        );
        clock.advance(1);
        const recovered = await sendCommsMail(baseMessage, {
          env: ENV,
          fetchImpl: healthy,
          now: clock.now,
        });

        expect(blocked.reason).toBe('circuit_open');
        expect(healthy).toHaveBeenCalledTimes(1);
        expect(recovered.length).toBe(1);
      });
    });

    it('does not open for other failures', async () => {
      const failing = buildFetch([jsonResponse(502)]);
      await captureRejection(sendCommsMail(baseMessage, { env: ENV, fetchImpl: failing }));
      const healthy = buildFetch();

      const results = await sendCommsMail(baseMessage, { env: ENV, fetchImpl: healthy });

      expect(results.length).toBe(1);
    });

    it('does not retry automatically on a tripping status', async () => {
      const failing = buildFetch([jsonResponse(429)]);

      await captureRejection(sendCommsMail(baseMessage, { env: ENV, fetchImpl: failing }));

      expect(failing).toHaveBeenCalledTimes(1);
    });

    it('uses Date.now when no clock is injected', async () => {
      await captureRejection(
        sendCommsMail(baseMessage, { env: ENV, fetchImpl: buildFetch([jsonResponse(401)]) })
      );
      const healthy = buildFetch();

      const blocked = await captureRejection(
        sendCommsMail(baseMessage, { env: ENV, fetchImpl: healthy })
      );

      expect(blocked.reason).toBe('circuit_open');
      expect(healthy).not.toHaveBeenCalled();
    });

    it('can be reset', async () => {
      await captureRejection(
        sendCommsMail(baseMessage, { env: ENV, fetchImpl: buildFetch([jsonResponse(401)]) })
      );

      resetCommsMailBreaker();

      const results = await sendCommsMail(baseMessage, { env: ENV, fetchImpl: buildFetch() });
      expect(results.length).toBe(1);
    });
  });
});
