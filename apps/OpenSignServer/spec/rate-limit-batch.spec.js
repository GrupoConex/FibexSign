import axios from 'axios';
import { config } from '../index.js';
import { STRICT_AUTH_PATH_SUFFIXES } from '../utils/authRateLimiter.js';
import { resetRateLimits } from './utils/auth-fixtures.js';

const MASTER = { useMasterKey: true };
const SERVER_ROOT = 'http://localhost:30001/test';
const PARSE_KEYS = { 'X-Parse-Application-Id': 'test', 'X-Parse-Javascript-Key': 'test' };
const BATCH_HEADERS = { ...PARSE_KEYS, 'Content-Type': 'application/json' };
const configuredMax = () => Number(process.env.AUTH_RATE_LIMIT_MAX);
const halfOfBudget = () => Math.ceil(configuredMax() / 2);

const authLoginSubRequest = index => ({
  method: 'POST',
  path: '/test/functions/AuthLoginAsMail',
  body: { email: `batch-${index}@example.com`, otp: '123456' },
});

const postBatch = requests =>
  axios.post(
    `${SERVER_ROOT}/batch`,
    { requests },
    { headers: BATCH_HEADERS, validateStatus: () => true }
  );

const buildBatch = size => Array.from({ length: size }, (_, index) => authLoginSubRequest(index));

const disguisedBatch = (path, size) =>
  buildBatch(size).map(subRequest => ({ ...subRequest, path }));

const postRaw = (body, contentType) =>
  axios.post(`${SERVER_ROOT}/batch`, body, {
    headers: { ...PARSE_KEYS, ...(contentType ? { 'Content-Type': contentType } : {}) },
    transformRequest: [data => data],
    validateStatus: () => true,
  });

const postText = (requests, contentType = 'text/plain') =>
  postRaw(JSON.stringify({ requests }), contentType);

describe('Parse Server rate limit configuration', () => {
  it('declares a parse rate limit for every strict auth path', () => {
    const declaredPaths = config.rateLimit.map(limit => limit.requestPath);

    expect(declaredPaths.sort()).toEqual([...STRICT_AUTH_PATH_SUFFIXES].sort());
  });

  it('applies the configured count and window to every entry', () => {
    config.rateLimit.forEach(limit => {
      expect(limit.requestCount).toBe(configuredMax());
      expect(limit.requestTimeWindow).toBeGreaterThan(0);
      expect(limit.errorResponseMessage).toBe('Too many requests, please try again later.');
    });
  });
});

describe('rate limiting of /batch sub-requests', () => {
  beforeEach(async () => {
    await resetRateLimits();
  });

  afterEach(async () => {
    await resetRateLimits();
  });

  it('answers a batch within the limit with one result per sub-request', async () => {
    const response = await postBatch(buildBatch(configuredMax()));

    expect(response.status).toBe(200);
    expect(response.data.length).toBe(configuredMax());
  });

  it('rejects a batch with more AuthLoginAsMail calls than the limit allows', async () => {
    const response = await postBatch(buildBatch(configuredMax() + 1));

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(Array.isArray(response.data)).toBeFalse();
  });

  it('rejects a large batch of AuthLoginAsMail calls', async () => {
    const response = await postBatch(buildBatch(200));

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(Array.isArray(response.data)).toBeFalse();
  });

  it('counts batch sub-requests together with direct requests in the same window', async () => {
    const first = await postBatch(buildBatch(configuredMax() - 1));
    const second = await postBatch(buildBatch(2));

    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
  });

  it('counts several small batches against one shared budget', async () => {
    const responses = [];
    for (let batch = 0; batch < 4; batch += 1) {
      responses.push(await postBatch(buildBatch(halfOfBudget())));
    }

    expect(responses.map(response => response.status)).toEqual([200, 200, 429, 429]);
  });

  it('does not limit batches of other endpoints', async () => {
    const requests = Array.from({ length: configuredMax() * 3 }, () => ({
      method: 'GET',
      path: '/test/classes/defaultdata_Otp',
    }));

    const response = await postBatch(requests);

    expect(response.status).not.toBe(429);
  });

  describe('content types other than application/json', () => {
    ['text/plain', 'text/plain;charset=UTF-8', 'application/octet-stream'].forEach(contentType => {
      it(`counts text bodies sent as ${contentType} against the shared budget`, async () => {
        const first = await postText(buildBatch(halfOfBudget()), contentType);
        const second = await postText(buildBatch(halfOfBudget()), contentType);
        const third = await postText(buildBatch(2), contentType);

        expect(first.status).toBe(200);
        expect(second.status).toBe(200);
        expect(third.status).toBe(429);
      });
    });

    it('limits one large text batch of AuthLoginAsMail calls', async () => {
      const response = await postText(buildBatch(200));

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(Array.isArray(response.data)).toBeFalse();
    });

    it('rejects a batch body that cannot be parsed', async () => {
      const response = await postRaw('{"requests": [', 'text/plain');

      expect(response.status).toBe(400);
      expect(response.data.error).toBe('Invalid batch request body.');
    });

    it('lets Parse answer a parsed body that has no requests array', async () => {
      const response = await postText(undefined);

      expect(response.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe('sub-request path disguises', () => {
    [
      '/test/functions/AuthLoginAsMail/.',
      '/test/functions/x/../AuthLoginAsMail',
      '/test/functions/AuthLoginAs%4Dail',
      '/test/functions/authloginasmail/',
      '/test/functions/AuthLoginAsMail?x=1',
      '/test/functions//AuthLoginAsMail',
    ].forEach(path => {
      it(`counts ${path} against the budget of the endpoint`, async () => {
        const first = await postBatch(disguisedBatch(path, halfOfBudget()));
        const second = await postBatch(buildBatch(halfOfBudget()));
        const third = await postBatch(disguisedBatch(path, 2));

        expect(first.status).toBe(200);
        expect(second.status).toBe(200);
        expect(third.status).toBe(429);
      });
    });

    it('treats a malformed percent encoding as a strict endpoint call', async () => {
      const response = await postBatch(
        disguisedBatch('/test/functions/AuthLoginAs%E0%A4%A', configuredMax() + 1)
      );

      expect(response.status).toBe(429);
    });

    it('counts a direct request with an encoded function name like the plain one', async () => {
      const statuses = [];
      for (let attempt = 0; attempt < configuredMax() + 1; attempt += 1) {
        const target = attempt % 2 === 0 ? 'AuthLoginAsMail' : 'AuthLoginAs%4Dail';
        const response = await axios.post(
          `${SERVER_ROOT}/functions/${target}`,
          { email: 'x@example.com', otp: '123456' },
          { headers: PARSE_KEYS, validateStatus: () => true }
        );
        statuses.push(response.status);
      }

      expect(statuses.at(-1)).toBe(429);
      expect(statuses.slice(0, configuredMax()).every(status => status !== 429)).toBeTrue();
    });
  });

  describe('batch size, body size and request rate', () => {
    const MAX_SUB_REQUESTS = 50;
    const harmlessBatch = size =>
      Array.from({ length: size }, () => ({
        method: 'GET',
        path: '/test/classes/defaultdata_Otp',
      }));
    const batchRateMax = () => Number(process.env.BATCH_RATE_LIMIT_MAX) || 60;
    const megabytes = count => 'x'.repeat(count * 1024 * 1024);

    it('accepts a batch with exactly the maximum number of sub-requests', async () => {
      const response = await postBatch(harmlessBatch(MAX_SUB_REQUESTS));

      expect(response.status).toBe(200);
      expect(response.data.length).toBe(MAX_SUB_REQUESTS);
    });

    it('rejects a batch above the maximum with 413 before processing it', async () => {
      const response = await postBatch(harmlessBatch(MAX_SUB_REQUESTS + 1));

      expect(response.status).toBe(413);
      expect(response.data.error).toBe('Batch request has too many sub-requests.');
    });

    it('rejects the oversized batch for text bodies too', async () => {
      const response = await postText(harmlessBatch(MAX_SUB_REQUESTS + 1));

      expect(response.status).toBe(413);
    });

    it('does not spend the strict budget of a batch that is too large', async () => {
      await postBatch(buildBatch(MAX_SUB_REQUESTS + 1));

      const response = await postBatch(buildBatch(configuredMax()));

      expect(response.status).toBe(200);
    });

    it('rejects a json batch body above ten megabytes with 413', async () => {
      const response = await postBatch([
        { method: 'POST', path: '/test/classes/defaultdata_Otp', body: { blob: megabytes(11) } },
      ]);

      expect(response.status).toBe(413);
      expect(response.data.error).toBe('Batch request body is too large.');
    });

    it('rejects a text batch body above ten megabytes with 413', async () => {
      const response = await postText([
        { method: 'POST', path: '/test/classes/defaultdata_Otp', body: { blob: megabytes(11) } },
      ]);

      expect(response.status).toBe(413);
    });

    it('still accepts a normal saveAll of twenty objects from the Parse SDK', async () => {
      const objects = Array.from({ length: 20 }, (_, index) => {
        const object = new Parse.Object('tmp_batch_probe');
        object.set('index', index);
        return object;
      });

      const saved = await Parse.Object.saveAll(objects, MASTER);

      expect(saved.length).toBe(20);
      expect(saved.every(object => object.id)).toBeTrue();
      await Parse.Object.destroyAll(saved, MASTER);
    });

    it('limits how many batch requests one client may send per window', async () => {
      const statuses = [];
      for (let attempt = 0; attempt <= batchRateMax(); attempt += 1) {
        statuses.push((await postBatch(harmlessBatch(1))).status);
      }

      expect(statuses.slice(0, batchRateMax()).every(status => status === 200)).toBeTrue();
      expect(statuses.at(-1)).toBe(429);
    });

    it('applies the request limit before the body is parsed', async () => {
      for (let attempt = 0; attempt < batchRateMax(); attempt += 1) {
        await postRaw('{"requests": [', 'text/plain');
      }

      const response = await postRaw('{"requests": [', 'text/plain');

      expect(response.status).toBe(429);
    });
  });
});
