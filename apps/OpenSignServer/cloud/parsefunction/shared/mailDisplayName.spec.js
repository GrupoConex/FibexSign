import { sanitizeDisplayName } from './mailDisplayName.js';

describe('sanitizeDisplayName', () => {
  it('keeps a plain name', () => {
    expect(sanitizeDisplayName('Ana Pérez')).toBe('Ana Pérez');
  });

  it('strips CR and LF so headers cannot be injected', () => {
    expect(sanitizeDisplayName('Ana\r\nBcc: evil@y.com')).toBe('AnaBcc: evily.com');
  });

  it('strips angle brackets and double quotes', () => {
    expect(sanitizeDisplayName('"Ana" <evil@y.com>')).toBe('Ana evily.com');
  });

  it('strips commas, semicolons and at signs so no extra mailbox can be parsed', () => {
    expect(sanitizeDisplayName('a@evil.com, b')).toBe('aevil.com b');
    expect(sanitizeDisplayName('x;y,z@w')).toBe('xyzw');
  });

  it('leaves nothing that nodemailer could split into several mailboxes', () => {
    expect(sanitizeDisplayName('a@evil.com, b@evil.com; c')).not.toMatch(/[,;@]/);
  });

  it('strips control characters', () => {
    expect(sanitizeDisplayName('A\u0000n\u001fa\u007f')).toBe('Ana');
  });

  it('trims surrounding whitespace', () => {
    expect(sanitizeDisplayName('   Ana   ')).toBe('Ana');
  });

  it('caps the length at 100 characters', () => {
    expect(sanitizeDisplayName('a'.repeat(250))).toBe('a'.repeat(100));
  });

  it('trims again after capping', () => {
    expect(sanitizeDisplayName(`${'a'.repeat(99)}  b`)).toBe('a'.repeat(99));
  });

  [undefined, null, 42, {}, []].forEach(value => {
    it(`returns an empty string for ${JSON.stringify(value)}`, () => {
      expect(sanitizeDisplayName(value)).toBe('');
    });
  });
});
