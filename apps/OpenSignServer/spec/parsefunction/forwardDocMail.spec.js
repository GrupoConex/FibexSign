import { resolveSender } from '../../cloud/parsefunction/shared/forwardDocMail.js';

const APP_NAME = 'Fibex Sign';
const loginUser = fields => ({ get: key => fields[key] });
const USER = loginUser({ name: 'Login Name', email: 'login@example.com' });

describe('resolveSender', () => {
  it('uses the sender name and mail stored on the document', () => {
    const sender = resolveSender(
      { SenderName: 'Custom Sender', SenderMail: 'sender@example.com' },
      USER,
      APP_NAME
    );

    expect(sender).toEqual({
      senderName: 'Custom Sender',
      replyTo: 'sender@example.com',
      from: 'Custom Sender',
      tenantAppName: APP_NAME,
    });
  });

  it('strips angle brackets and quotes from the display name', () => {
    const { from } = resolveSender({ SenderName: 'Evil" <x@evil.com>' }, USER, APP_NAME);

    expect(from).not.toMatch(/[<>"]/);
    expect(from).toContain('Evil');
  });

  it('keeps line breaks out of the display name', () => {
    const { from } = resolveSender(
      { SenderName: 'Boss\r\nBcc: victim@example.com' },
      USER,
      APP_NAME
    );

    expect(from).not.toMatch(/[\r\n]/);
  });

  it('strips angle brackets and quotes from a login email used as display value', () => {
    const user = loginUser({ email: 'A"B<c>@example.com' });

    const { from } = resolveSender({}, user, APP_NAME);

    expect(from).not.toMatch(/[<>"]/);
  });

  const invalidReplyAddresses = {
    'a line break': 'sender@example.com\r\nBcc: victim@example.com',
    'a malformed value': 'not-an-address',
    'a display name wrapper': 'Boss <boss@example.com>',
    'several addresses': 'a@example.com,b@example.com',
  };
  Object.entries(invalidReplyAddresses).forEach(([label, senderMail]) => {
    it(`omits the reply address when the stored sender mail has ${label}`, () => {
      const { replyTo } = resolveSender({ SenderMail: senderMail }, USER, APP_NAME);

      expect(replyTo).toBe('');
    });
  });

  it('falls back to the login email when the profile has no valid address', () => {
    const { replyTo } = resolveSender({ ExtUserPtr: { Email: 'broken' } }, USER, APP_NAME);

    expect(replyTo).toBe('');
  });

  it('uses a valid profile email as reply address', () => {
    const { replyTo } = resolveSender(
      { ExtUserPtr: { Email: 'profile@example.com' } },
      USER,
      APP_NAME
    );

    expect(replyTo).toBe('profile@example.com');
  });
});
