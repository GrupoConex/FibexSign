import { buildSignerInvitationMail, getPlaceholderRole } from './signerInvitationMail.js';

const decodeLink = html => {
  const link = html.match(/https:\/\/app\.test\/login\/[A-Za-z0-9+/=]+/)[0];
  return Buffer.from(link.split('/login/')[1], 'base64').toString('utf8');
};

const buildDocument = (overrides = {}) => ({
  objectId: 'doc1',
  Name: 'Contract',
  Note: 'note',
  createdAt: '2026-01-01T00:00:00.000Z',
  Signers: [{ objectId: 'c1', Email: 'signer@x.com', Name: 'Signer', Phone: '555' }],
  ExtUserPtr: { objectId: 'ext1', Name: 'Owner', Email: 'owner@x.com', Company: 'Acme' },
  ...overrides,
});

const contactPlaceholder = { signerObjId: 'c1', email: 'stale@x.com' };

describe('signerInvitationMail', () => {
  describe('getPlaceholderRole', () => {
    it('defaults to signer and honours explicit roles', () => {
      expect(getPlaceholderRole({})).toBe('signer');
      expect(getPlaceholderRole({ SignerRole: 'viewer' })).toBe('viewer');
      expect(getPlaceholderRole({ signer_role: 'viewer' })).toBe('viewer');
      expect(getPlaceholderRole({ role: 'viewer' })).toBe('viewer');
    });
  });

  describe('buildSignerInvitationMail', () => {
    it('addresses the contact and links with doc id, contact email and contact id', () => {
      const mail = buildSignerInvitationMail({
        document: buildDocument(),
        placeholder: contactPlaceholder,
        publicUrl: 'https://app.test/some/path',
      });

      expect(mail.recipient).toBe('signer@x.com');
      expect(mail.extUserId).toBe('ext1');
      expect(mail.replyto).toBe('owner@x.com');
      expect(mail.from).toBe('owner@x.com');
      expect(decodeLink(mail.html)).toBe('doc1/signer@x.com/c1');
    });

    it('links with doc id and email only for placeholders without a contact', () => {
      const mail = buildSignerInvitationMail({
        document: buildDocument(),
        placeholder: { email: 'guest@x.com' },
        publicUrl: 'https://app.test',
      });

      expect(mail.recipient).toBe('guest@x.com');
      expect(decodeLink(mail.html)).toBe('doc1/guest@x.com');
    });

    it('uses the owner name as sender when requested', () => {
      const document = buildDocument();
      document.ExtUserPtr.UseNameAsSender = true;

      const mail = buildSignerInvitationMail({
        document,
        placeholder: contactPlaceholder,
        publicUrl: 'https://app.test',
      });

      expect(mail.from).toBe('Owner');
    });

    it('replaces variables in the tenant template', () => {
      const document = buildDocument();
      document.ExtUserPtr.TenantId = {
        RequestSubject: '{{document_title}} for {{receiver_name}} from {{sender_name}}',
        RequestBody: '<p class="x">{{receiver_phone}} {{company_name}}</p>',
      };

      const mail = buildSignerInvitationMail({
        document,
        placeholder: contactPlaceholder,
        publicUrl: 'https://app.test',
      });

      expect(mail.subject).toBe('Contract for Signer from Owner');
      expect(mail.html).toContain("<p class='x'>555 Acme</p>");
    });

    it('falls back to the default template when only one of subject or body exists', () => {
      const document = buildDocument({ RequestSubject: 'only subject' });

      const mail = buildSignerInvitationMail({
        document,
        placeholder: contactPlaceholder,
        publicUrl: 'https://app.test',
      });

      expect(mail.subject).toBe('Owner has requested you to sign "Contract"');
    });
  });
});
