import {
  createCaller,
  createPlainUser,
  pointer,
  purgeCreatedAccounts,
} from '../../../spec/utils/auth-fixtures.js';
import { seedContact, seedDocument } from '../../../spec/utils/document-fixtures.js';
import {
  dispatchBatchSigningMails,
  resolveInvitationBaseUrl,
  sendBatchSigningMails,
  sendMail,
  settleBatchMailDispatches,
} from './batchSigningMail.js';
import { CommsLane } from './commsMailClient.js';

const ENV_KEYS = ['CORS_ALLOWED_ORIGINS', 'PUBLIC_URL', 'NODE_ENV'];
const PUBLIC_URL = 'https://app.test';

const buildDocument = (fields = {}) => ({
  objectId: 'doc1',
  Name: 'Contract',
  createdAt: '2026-01-01T00:00:00.000Z',
  Placeholders: [{ email: 'signer@x.com', Role: 'signer' }],
  Signers: [],
  ExtUserPtr: { objectId: 'ext1', Name: 'Owner', Email: 'owner@x.com' },
  ...fields,
});

describe('batchSigningMail', () => {
  let deliver;

  beforeEach(() => {
    spyOn(console, 'log');
    deliver = jasmine.createSpy('deliver').and.resolveTo({ status: 'success' });
  });

  describe('sendMail', () => {
    it('delivers through the bulk lane on behalf of the document profile', async () => {
      await sendMail(buildDocument(), PUBLIC_URL, { deliver });

      const [request, options] = deliver.calls.mostRecent().args;
      expect(options).toEqual({ lane: CommsLane.BULK });
      expect(request.params.extUserId).toBe('ext1');
      expect(request.params.recipient).toBe('signer@x.com');
    });

    it('sanitizes the sender display name', async () => {
      const document = buildDocument({
        ExtUserPtr: {
          objectId: 'ext1',
          Name: 'Evil "Name" <spoof@x.com>',
          Email: 'owner@x.com',
          UseNameAsSender: true,
        },
      });

      await sendMail(document, PUBLIC_URL, { deliver });

      expect(deliver.calls.mostRecent().args[0].params.from).toBe('Evil Name spoofx.com');
    });

    it('keeps going when one delivery throws', async () => {
      deliver.and.returnValues(Promise.reject(new Error('down')), Promise.resolve({}));
      const document = buildDocument({
        Placeholders: [
          { email: 'first@x.com', Role: 'signer' },
          { email: 'second@x.com', Role: 'signer' },
        ],
      });

      await expectAsync(sendMail(document, PUBLIC_URL, { deliver })).toBeResolved();

      expect(deliver).toHaveBeenCalledTimes(2);
    });
  });

  describe('resolveInvitationBaseUrl', () => {
    let savedEnv;

    beforeEach(() => {
      savedEnv = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]));
      process.env.CORS_ALLOWED_ORIGINS = 'https://allowed.test';
      process.env.PUBLIC_URL = 'https://base.test/';
      delete process.env.NODE_ENV;
    });

    afterEach(() => {
      ENV_KEYS.forEach(key => {
        if (savedEnv[key] === undefined) delete process.env[key];
        else process.env[key] = savedEnv[key];
      });
    });

    it('keeps an allowed origin and falls back to the signing base url otherwise', () => {
      expect(resolveInvitationBaseUrl({ origin: 'https://allowed.test' })).toBe(
        'https://allowed.test'
      );
      expect(resolveInvitationBaseUrl({ origin: 'https://evil.test' })).toBe('https://base.test');
      expect(resolveInvitationBaseUrl({})).toBe('https://base.test');
      expect(resolveInvitationBaseUrl(undefined)).toBe('https://base.test');
    });
  });

  describe('sendBatchSigningMails', () => {
    afterEach(async () => {
      await purgeCreatedAccounts();
    });

    it('builds the mail from the stored document and its contacts', async () => {
      const owner = await createCaller('contracts_Admin');
      const signer = await createPlainUser();
      const contact = await seedContact(owner, signer);
      const document = await seedDocument(owner, {
        Signers: [pointer('contracts_Contactbook', contact.id)],
        Placeholders: [
          {
            Role: 'Signer 1',
            signerObjId: contact.id,
            signerPtr: pointer('contracts_Contactbook', contact.id),
          },
        ],
      });

      await sendBatchSigningMails({ documentIds: [document.id], publicUrl: PUBLIC_URL, deliver });

      const { params } = deliver.calls.mostRecent().args[0];
      expect(params.recipient).toBe(signer.email);
      expect(params.extUserId).toBe(owner.extUser.id);
      expect(params.html).toContain(`${PUBLIC_URL}/login/`);
    });

    it('sends nothing without a signing base url', async () => {
      await sendBatchSigningMails({ documentIds: ['doc1'], publicUrl: '', deliver });

      expect(deliver).not.toHaveBeenCalled();
    });
  });

  describe('dispatchBatchSigningMails', () => {
    it('runs detached and can be awaited through the settle hook', async () => {
      dispatchBatchSigningMails({ documentIds: [], publicUrl: PUBLIC_URL, deliver });

      await expectAsync(settleBatchMailDispatches()).toBeResolved();
    });

    it('logs a failed dispatch instead of rejecting', async () => {
      const failingQuery = spyOn(Parse.Query.prototype, 'find').and.rejectWith(
        new Error('db down')
      );

      dispatchBatchSigningMails({ documentIds: ['doc1'], publicUrl: PUBLIC_URL, deliver });
      await settleBatchMailDispatches();

      expect(failingQuery).toHaveBeenCalled();
      expect(console.log).toHaveBeenCalledWith(
        'batchdoc signing mail dispatch error: ',
        jasmine.any(Error)
      );
      expect(deliver).not.toHaveBeenCalled();
    });
  });
});
