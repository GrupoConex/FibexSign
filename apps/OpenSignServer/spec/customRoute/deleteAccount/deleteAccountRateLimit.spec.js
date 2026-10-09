import { isStrictAuthPath } from '../../../utils/authRateLimiter.js';
import {
  openDeletePage,
  requestDeleteOtp,
  submitDeletion,
} from '../../utils/delete-account-fixtures.js';
import { resetAuthState, silenceConsole } from '../../utils/auth-fixtures.js';

const TOO_MANY_REQUESTS = 429;
const BEYOND_LIMIT = Number(process.env.AUTH_RATE_LIMIT_MAX) + 2;

const statusesOf = async request => {
  const statuses = [];
  for (let attempt = 0; attempt < BEYOND_LIMIT; attempt += 1) {
    statuses.push((await request(`ghostUser${attempt.toString().padStart(2, '0')}`)).status);
  }
  return statuses;
};

describe('delete account rate limiting', () => {
  beforeEach(async () => {
    silenceConsole();
    await resetAuthState();
  });

  afterEach(resetAuthState);

  [
    ['/delete-account/abcDEF1234', true],
    ['/delete-account/abcDEF1234/otp', true],
    ['/api/delete-account/abcDEF1234/', true],
    ['/Delete-Account/abcDEF1234', true],
    ['/delete-accounts/abcDEF1234', false],
    ['/files/delete-account', false],
  ].forEach(([path, expected]) => {
    it(`classifies ${path} as ${expected ? 'strict' : 'not strict'}`, () => {
      expect(isStrictAuthPath(path)).toBe(expected);
    });
  });

  [
    ['the page', openDeletePage],
    ['the code request', requestDeleteOtp],
    ['the deletion', userId => submitDeletion(userId, '123456')],
  ].forEach(([name, request]) => {
    it(`limits ${name} per client across different accounts`, async () => {
      const statuses = await statusesOf(request);

      expect(statuses.at(-1)).toBe(TOO_MANY_REQUESTS);
      expect(statuses.filter(status => status === TOO_MANY_REQUESTS).length).toBe(2);
    });
  });
});
