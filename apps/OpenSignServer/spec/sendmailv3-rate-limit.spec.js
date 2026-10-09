import { isAuthRateLimitedPath, isStrictAuthPath } from '../utils/authRateLimiter.js';

describe('sendmailv3 rate limiting', () => {
  it('is rate limited under the operational tier', () => {
    expect(isAuthRateLimitedPath('/app/functions/sendmailv3')).toBe(true);
    expect(isAuthRateLimitedPath('/app/functions/SendMailV3/')).toBe(true);
  });

  it('is not in the strict tier because the client sends one call per signer', () => {
    expect(isStrictAuthPath('/app/functions/sendmailv3')).toBe(false);
  });
});
