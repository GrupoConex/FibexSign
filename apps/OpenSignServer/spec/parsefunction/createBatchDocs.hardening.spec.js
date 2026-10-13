import { resetBatchDocumentsUserLimits } from '../../cloud/parsefunction/createBatchDocs.js';
import { settleBatchMailDispatches } from '../../cloud/parsefunction/shared/batchSigningMail.js';
import {
  createCaller,
  createPlainUser,
  purgeCreatedAccounts,
  silenceConsole,
} from '../utils/auth-fixtures.js';
import {
  contactPlaceholder,
  documentsCreatedBy,
  emailPlaceholder,
  pickedContact,
  plainDocument,
  sendBatch,
  sendBatchRaw,
} from '../utils/batch-fixtures.js';
import { useCommsMailCapture } from '../utils/delete-account-fixtures.js';
import { documentCountOf, seedContact, seedTemplate } from '../utils/document-fixtures.js';

const REQUEST_LIMIT_EXCEEDED = 155;
const LIMIT_KEYS = ['BATCHDOCS_USER_LIMIT', 'BATCHDOCS_USER_WINDOW_MS'];

const countFirstLookups = () => {
  const original = Parse.Query.prototype.first;
  const hits = new Map();
  spyOn(Parse.Query.prototype, 'first').and.callFake(function (...args) {
    hits.set(this.className, (hits.get(this.className) ?? 0) + 1);
    return original.apply(this, args);
  });
  return { of: className => hits.get(className) ?? 0 };
};

const recipientsOf = mail => mail.sent.map(message => message.to).sort();

describe('batchdocuments hardening', () => {
  const mail = useCommsMailCapture();
  let owner;
  let signer;
  let ownContact;
  let savedEnv;

  beforeEach(async () => {
    silenceConsole();
    savedEnv = Object.fromEntries(LIMIT_KEYS.map(key => [key, process.env[key]]));
    resetBatchDocumentsUserLimits();
    owner = await createCaller('contracts_Admin');
    signer = await createPlainUser();
    ownContact = await seedContact(owner, signer);
  });

  afterEach(async () => {
    LIMIT_KEYS.forEach(key => {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    });
    resetBatchDocumentsUserLimits();
    await purgeCreatedAccounts();
  });

  const ownDocument = (fields = {}) =>
    plainDocument({
      Placeholders: [contactPlaceholder('Signer 1', pickedContact(ownContact))],
      ...fields,
    });

  describe('recipients', () => {
    it('mails the stored contact and never the email sent with a contact placeholder', async () => {
      const victimContact = await seedContact(owner, await createPlainUser());
      const placeholder = {
        ...contactPlaceholder('Signer 1', pickedContact(ownContact)),
        signerObjId: victimContact.id,
        email: 'attacker@example.com',
      };

      await sendBatch([plainDocument({ Placeholders: [placeholder] })], owner.account);

      const [created] = await documentsCreatedBy(owner.account);
      const [stored] = created.get('Placeholders');
      expect(stored.signerObjId).toBe(ownContact.id);
      expect(stored.email).toBe(signer.email);
      expect(recipientsOf(mail)).toEqual([signer.email.toLowerCase()]);
    });

    it('still invites typed email recipients without a contact', async () => {
      await sendBatch(
        [plainDocument({ Placeholders: [emailPlaceholder('Signer 1', 'New.Guest@Example.com')] })],
        owner.account
      );

      expect(recipientsOf(mail)).toEqual(['new.guest@example.com']);
    });

    it('sends in order by default', async () => {
      await sendBatch([ownDocument()], owner.account);

      const [created] = await documentsCreatedBy(owner.account);
      expect(created.get('SendinOrder')).toBeTrue();
    });
  });

  describe('partial failures', () => {
    it('charges and mails only the documents that were saved', async () => {
      const documents = [
        ownDocument({ Name: 'Saved one' }),
        ownDocument({ Name: 'n'.repeat(251) }),
        ownDocument({ Name: 'Saved two' }),
      ];

      const result = await sendBatch(documents, owner.account);

      const created = await documentsCreatedBy(owner.account);
      expect(result).toEqual({ total: 3, created: 2, failed: 1 });
      expect(created.map(row => row.get('Name')).sort()).toEqual(['Saved one', 'Saved two']);
      expect(await documentCountOf(owner.extUser)).toBe(2);
      expect(mail.sent.length).toBe(2);
    });
  });

  describe('throughput', () => {
    it('limits the calls per user', async () => {
      process.env.BATCHDOCS_USER_LIMIT = '2';

      await sendBatch([ownDocument()], owner.account);
      await sendBatch([ownDocument()], owner.account);
      const third = await sendBatchRaw(JSON.stringify([ownDocument()]), owner.account);
      const other = await createCaller('contracts_Admin');
      const otherContact = await seedContact(other, await createPlainUser());
      const otherDocument = plainDocument({
        Placeholders: [contactPlaceholder('Signer 1', pickedContact(otherContact))],
      });

      expect(third.code).toBe(REQUEST_LIMIT_EXCEEDED);
      expect(await sendBatch([otherDocument], other.account)).toEqual(
        jasmine.objectContaining({ created: 1 })
      );
    });

    it('answers before the invitations are delivered', async () => {
      let release;
      const gate = new Promise(resolve => {
        release = resolve;
      });
      globalThis.fetch.and.callFake(async (url, init) => {
        await gate;
        return { status: 201, json: async () => ({ status: 'SENT' }), body: init?.body };
      });

      const body = await sendBatchRaw(JSON.stringify([ownDocument()]), owner.account);

      expect(body.result).toEqual({ total: 1, created: 1, failed: 0 });
      release();
      await settleBatchMailDispatches();
    });

    it('looks up the shared template and tenant once per call', async () => {
      const template = await seedTemplate(owner);
      const lookups = countFirstLookups();
      const documents = [1, 2, 3, 4, 5].map(index =>
        ownDocument({ Name: `Contract ${index}`, objectId: template.id })
      );

      await sendBatch(documents, owner.account);

      expect(lookups.of('contracts_Template')).toBe(1);
      expect(lookups.of('partners_Tenant')).toBeLessThanOrEqual(1);
    });
  });
});
