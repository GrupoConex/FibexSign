import axios from 'axios';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, trustProxyHops } from '../index.js';
import {
  isAuthRateLimitedPath,
  isStrictAuthPath,
  normalizeRequestPath,
  reportMissingTrustProxy,
  resetAuthRateLimiterStoreForTesting,
} from '../utils/authRateLimiter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TEST_SERVER_ROOT = 'http://localhost:30001';
const AUTH_RATE_LIMITED_PATH = `${TEST_SERVER_ROOT}/test/functions/loginuser`;

async function postLoginUser(url = AUTH_RATE_LIMITED_PATH) {
  try {
    return await axios.post(
      url,
      { email: 'nobody@example.com', password: 'wrong-password' },
      { validateStatus: () => true }
    );
  } catch (err) {
    return err.response;
  }
}

describe('server hardening: rate limiting', () => {
  it('returns 429 once the auth rate limit is exceeded on a sensitive endpoint', async () => {
    const configuredMax = Number(process.env.AUTH_RATE_LIMIT_MAX) || 20;
    const totalRequests = configuredMax + 2;
    const responses = [];

    for (let i = 0; i < totalRequests; i++) {
      responses.push(await postLoginUser());
    }

    const withinLimit = responses.slice(0, configuredMax);
    const overLimit = responses.slice(configuredMax);

    withinLimit.forEach(response => {
      expect(response.status).not.toBe(429);
    });

    overLimit.forEach(response => {
      expect(response.status).toBe(429);
    });

    await resetAuthRateLimiterStoreForTesting();
  });

  it('returns 429 once the auth rate limit is exceeded on the verifyemail endpoint', async () => {
    const configuredMax = Number(process.env.AUTH_RATE_LIMIT_MAX) || 20;
    const verifyEmailUrl = `${TEST_SERVER_ROOT}/test/functions/verifyemail`;
    const responses = [];

    for (let i = 0; i < configuredMax + 1; i++) {
      responses.push(await postLoginUser(verifyEmailUrl));
    }

    expect(responses.slice(0, configuredMax).every(response => response.status !== 429)).toBe(true);
    expect(responses[configuredMax].status).toBe(429);

    await resetAuthRateLimiterStoreForTesting();
  });

  it('does not leave the loginuser bucket poisoned for later specs', async () => {
    const response = await postLoginUser();

    expect(response.status).not.toBe(429);
  });
});

describe('server hardening: rate-limited path coverage', () => {
  it('rate-limits the getUserDetails cloud function suffix', () => {
    expect(isAuthRateLimitedPath('/parse/functions/getUserDetails')).toBe(true);
  });

  it('rate-limits the declinedoc cloud function suffix', () => {
    expect(isAuthRateLimitedPath('/parse/functions/declinedoc')).toBe(true);
  });

  it('rate-limits the verifyemail cloud function with the strict auth limiter', () => {
    expect(isAuthRateLimitedPath('/parse/functions/verifyemail')).toBe(true);
    expect(isStrictAuthPath('/parse/functions/verifyemail')).toBe(true);
  });

  [
    '/parse/functions/AuthLoginAsMail/',
    '/parse/functions/authloginasmail',
    '/parse/functions/AUTHLOGINASMAIL',
    '/PARSE/FUNCTIONS/VERIFYEMAIL/',
    '/parse/Login/',
    '/parse/functions/sendotpmailv1//',
    '/parse/functions/LoginUser',
  ].forEach(requestPath => {
    it(`treats ${requestPath} as a strict auth path`, () => {
      expect(isStrictAuthPath(requestPath)).toBe(true);
      expect(isAuthRateLimitedPath(requestPath)).toBe(true);
    });
  });

  it('keeps operational paths operational regardless of casing and trailing slash', () => {
    expect(isAuthRateLimitedPath('/parse/functions/GETUSERDETAILS/')).toBe(true);
    expect(isStrictAuthPath('/parse/functions/GETUSERDETAILS/')).toBe(false);
  });

  it('does not treat a longer path that merely contains a strict suffix as strict', () => {
    expect(isStrictAuthPath('/parse/functions/loginuserextra')).toBe(false);
    expect(isStrictAuthPath('/parse/loginAs')).toBe(false);
  });

  it('shares one budget between path variants of the same strict endpoint', async () => {
    const configuredMax = Number(process.env.AUTH_RATE_LIMIT_MAX) || 20;
    const variants = ['loginuser', 'loginuser/', 'LOGINUSER', 'LoginUser/'];
    const statuses = [];
    await resetAuthRateLimiterStoreForTesting();

    for (let i = 0; i < configuredMax + 2; i++) {
      const variant = variants[i % variants.length];
      const response = await postLoginUser(`${TEST_SERVER_ROOT}/test/functions/${variant}`);
      statuses.push(response.status);
    }

    expect(statuses.slice(0, configuredMax).every(status => status !== 429)).toBe(true);
    expect(statuses.slice(configuredMax)).toEqual([429, 429]);
    await resetAuthRateLimiterStoreForTesting();
  });

  [
    '/app/functions/AuthLoginAsMail/.',
    '/app/functions/x/../AuthLoginAsMail',
    '/app/functions/AuthLoginAs%4Dail',
    '/app/functions/AuthLoginAs%4dail/',
    '/app/functions/AuthLoginAsMail?x=1',
    '/app//functions//AuthLoginAsMail',
    '/app/functions/AuthLoginAs%E0%A4%A',
    '/app/functions/%2e%2e/functions/verifyemail',
  ].forEach(requestPath => {
    it(`treats the disguised path ${requestPath} as a strict auth path`, () => {
      expect(isStrictAuthPath(requestPath)).toBe(true);
      expect(isAuthRateLimitedPath(requestPath)).toBe(true);
    });
  });

  it('normalizes request paths to a canonical lowercase form', () => {
    expect(normalizeRequestPath('/App/Functions/X/../AuthLoginAsMail/.?a=1')).toBe(
      '/app/functions/authloginasmail'
    );
    expect(normalizeRequestPath(undefined)).toBe('');
  });

  it('does not treat a harmless encoded path as strict', () => {
    expect(isStrictAuthPath('/app/classes/Some%20Class')).toBe(false);
  });

  it('distinguishes strict auth paths from operational paths', () => {
    expect(isStrictAuthPath('/parse/functions/loginuser')).toBe(true);
    expect(isStrictAuthPath('/parse/functions/SendOTPMailV1')).toBe(true);
    expect(isStrictAuthPath('/parse/login')).toBe(true);
    expect(isStrictAuthPath('/parse/functions/getUserDetails')).toBe(false);
    expect(isStrictAuthPath('/parse/functions/declinedoc')).toBe(false);
  });
});

describe('server hardening: trust proxy configuration', () => {
  it('defaults TRUST_PROXY_HOPS to 0 (trust proxy disabled) when unset', () => {
    expect(process.env.TRUST_PROXY_HOPS).toBeUndefined();
    expect(trustProxyHops).toBe(0);
  });
});

describe('server hardening: OTP logging', () => {
  it('does not log the raw OTP code value', () => {
    const absolutePath = path.join(__dirname, '../cloud/parsefunction/SendMailOTPv1.js');
    const content = fs.readFileSync(absolutePath, 'utf8');

    expect(content).not.toContain("console.log('OTP sent', code)");
    expect(content).not.toMatch(/console\.log\([^)]*,\s*code\)/);
  });
});

describe('server hardening: CORS', () => {
  it('does not reflect an unlisted Origin header when CORS_ALLOWED_ORIGINS is unset', async () => {
    const response = await axios.get(`${TEST_SERVER_ROOT}/`, {
      headers: { Origin: 'http://untrusted-origin.example.com' },
      validateStatus: () => true,
    });

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('allows requests carrying no Origin header at all', async () => {
    const response = await axios.get(`${TEST_SERVER_ROOT}/`, { validateStatus: () => true });

    expect(response.status).toBe(200);
  });
});

describe('server hardening: Parse Server config', () => {
  it('restricts masterKeyIps to a safe default when MASTER_KEY_IPS is unset', () => {
    expect(Array.isArray(config.masterKeyIps)).toBe(true);
    expect(config.masterKeyIps).not.toContain('0.0.0.0/0');
    expect(config.masterKeyIps).not.toContain('::/0');
  });

  it('configures a bounded accountLockout policy', () => {
    expect(config.accountLockout).toBeDefined();
    expect(config.accountLockout.duration).toBeGreaterThan(0);
    expect(config.accountLockout.threshold).toBeGreaterThan(0);
  });

  it('configures a bounded sessionLength', () => {
    expect(typeof config.sessionLength).toBe('number');
    expect(config.sessionLength).toBeGreaterThan(0);
  });
});

describe('server hardening: production proxy warning', () => {
  it('logs a clear error in production when TRUST_PROXY_HOPS is not configured', () => {
    const logError = jasmine.createSpy('logError');

    const reported = reportMissingTrustProxy({ env: { NODE_ENV: 'production' }, logError });

    expect(reported).toBe(true);
    expect(logError).toHaveBeenCalledTimes(1);
    expect(logError.calls.mostRecent().args[0]).toContain('TRUST_PROXY_HOPS');
  });

  it('logs the error when TRUST_PROXY_HOPS is zero in production', () => {
    const logError = jasmine.createSpy('logError');

    const reported = reportMissingTrustProxy({
      env: { NODE_ENV: 'production', TRUST_PROXY_HOPS: '0' },
      logError,
    });

    expect(reported).toBe(true);
  });

  it('stays silent in production when the proxy hop count is configured', () => {
    const logError = jasmine.createSpy('logError');

    const reported = reportMissingTrustProxy({
      env: { NODE_ENV: 'production', TRUST_PROXY_HOPS: '1' },
      logError,
    });

    expect(reported).toBe(false);
    expect(logError).not.toHaveBeenCalled();
  });

  ['development', 'test', undefined].forEach(nodeEnv => {
    it(`stays silent when NODE_ENV is ${nodeEnv}`, () => {
      const logError = jasmine.createSpy('logError');

      const reported = reportMissingTrustProxy({ env: { NODE_ENV: nodeEnv }, logError });

      expect(reported).toBe(false);
      expect(logError).not.toHaveBeenCalled();
    });
  });

  it('writes to console.error by default without blocking', () => {
    const consoleError = spyOn(console, 'error');

    const reported = reportMissingTrustProxy({ env: { NODE_ENV: 'production' } });

    expect(reported).toBe(true);
    expect(consoleError).toHaveBeenCalledTimes(1);
  });
});

describe('server hardening: startup order', () => {
  const indexSource = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8');

  it('awaits the database migrations before the http server starts listening', () => {
    const migrationsAt = indexSource.indexOf('await runDbMigrations()');
    const listenAt = indexSource.indexOf('httpServer.listen(');

    expect(migrationsAt).toBeGreaterThan(-1);
    expect(listenAt).toBeGreaterThan(migrationsAt);
  });

  it('reports a missing proxy configuration at startup', () => {
    expect(indexSource).toContain('reportMissingTrustProxy()');
  });
});
