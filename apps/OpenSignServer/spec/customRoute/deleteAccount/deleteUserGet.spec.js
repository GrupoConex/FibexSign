import {
  OTP_EXPIRES_MIN,
  deleteOtpKey,
  isMailDelivered,
  msUntil,
} from '../../../cloud/customRoute/deleteAccount/deleteUtils.js';
import { createCaller, resetAuthState, silenceConsole } from '../../utils/auth-fixtures.js';
import { openDeletePage } from '../../utils/delete-account-fixtures.js';

describe('delete account page', () => {
  let savedServerUrl;

  beforeEach(async () => {
    silenceConsole();
    savedServerUrl = process.env.SERVER_URL;
    await resetAuthState();
  });

  afterEach(() => {
    process.env.SERVER_URL = savedServerUrl;
  });

  it('answers 404 for an account that does not exist', async () => {
    const response = await openDeletePage('missingUser1');

    expect(response.status).toBe(404);
    expect(response.data).toBe('User not found.');
  });

  it('answers 404 for a well formed id that belongs to nobody', async () => {
    const response = await openDeletePage('aB3dE6gH9j');

    expect(response.status).toBe(404);
  });

  it('serves the OTP form wired to the account endpoints', async () => {
    const admin = await createCaller('contracts_Admin');

    const response = await openDeletePage(admin.account.id);

    expect(response.status).toBe(200);
    expect(response.data).toContain(`action="/delete-account/${admin.account.id}"`);
    expect(response.data).toContain(`"/delete-account/${admin.account.id}/otp"`);
    expect(response.data).toContain('maxlength="6"');
    expect(response.data).toContain('const RESEND_WAIT = 30;');
  });

  it('contains no developer comments in the served page', async () => {
    const admin = await createCaller('contracts_Admin');

    const response = await openDeletePage(admin.account.id);

    expect(response.data).not.toContain('<!--');
    expect(response.data).not.toMatch(/^\s*\/\/ /m);
  });

  it('forbids framing and restricts scripts to the page nonce', async () => {
    const admin = await createCaller('contracts_Admin');

    const response = await openDeletePage(admin.account.id);

    const policy = response.headers['content-security-policy'];
    const nonce = policy.match(/script-src 'nonce-([^']+)'/)[1];
    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("default-src 'none'");
    expect(response.data).toContain(`<script nonce="${nonce}">`);
  });

  it('uses a fresh nonce for every page view', async () => {
    const admin = await createCaller('contracts_Admin');

    const first = await openDeletePage(admin.account.id);
    const second = await openDeletePage(admin.account.id);

    expect(first.headers['content-security-policy']).not.toBe(
      second.headers['content-security-policy']
    );
  });

  ['abc', 'abcdefghi!', 'abcdefghijk', '%22%3E%3Cscript%3E1', 'abc%20defghi'].forEach(userId => {
    it(`answers 404 without querying for the malformed id "${userId}"`, async () => {
      const lookup = spyOn(Parse.Query.prototype, 'first').and.callThrough();

      const response = await openDeletePage(userId);

      expect(response.status).toBe(404);
      expect(lookup).not.toHaveBeenCalled();
    });
  });

  it('prefixes the endpoints when the server is mounted under an api path', async () => {
    const admin = await createCaller('contracts_Admin');
    process.env.SERVER_URL = 'https://firma.example.com/api/app';

    const response = await openDeletePage(admin.account.id);

    expect(response.data).toContain(`action="/api/delete-account/${admin.account.id}"`);
  });
});

describe('delete account helpers', () => {
  it('derives a purpose scoped key that is not a valid email address', () => {
    expect(deleteOtpKey('  User@Example.COM ')).toBe('delete-account:user@example.com');
  });

  it('reports the remaining wait and never a negative one', () => {
    expect(msUntil(1000, 4000)).toBe(3000);
    expect(msUntil(4000, 1000)).toBe(0);
  });

  it('recognizes only a successful delivery', () => {
    expect(isMailDelivered({ status: 'success' })).toBeTrue();
    expect(isMailDelivered({ status: 'error' })).toBeFalse();
    expect(isMailDelivered(undefined)).toBeFalse();
  });

  it('expires codes after the policy lifetime in minutes', () => {
    expect(OTP_EXPIRES_MIN).toBe(10);
  });
});
