import axios from 'axios';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, trustProxyHops } from '../index.js';
import {
  isAuthRateLimitedPath,
  resetAuthRateLimiterStoreForTesting,
} from '../utils/authRateLimiter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TEST_SERVER_ROOT = 'http://localhost:30001';
const AUTH_RATE_LIMITED_PATH = `${TEST_SERVER_ROOT}/test/functions/loginuser`;

async function postLoginUser() {
  try {
    return await axios.post(
      AUTH_RATE_LIMITED_PATH,
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
