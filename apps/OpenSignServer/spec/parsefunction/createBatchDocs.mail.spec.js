import {
  captureRejection,
  createCaller,
  createPlainUser,
  pointer,
  purgeCreatedAccounts,
  silenceConsole,
} from '../utils/auth-fixtures.js';
import {
  contactPlaceholder,
  countDocumentsOf,
  pickedContact,
  plainDocument,
  sendBatch,
  sendBatchRaw,
} from '../utils/batch-fixtures.js';
import { useCommsMailCapture } from '../utils/delete-account-fixtures.js';
import { reload, seedContact, seedTemplate } from '../utils/document-fixtures.js';

const MASTER = { useMasterKey: true };
const INVALID_JSON = 107;
const INVALID_SESSION_TOKEN = 209;
const MAX_DOCUMENTS = 50;
const ENV_KEYS = [
  'CORS_ALLOWED_ORIGINS',
  'PUBLIC_URL',
  'COMMS_BULK_PER_MINUTE',
  'COMMS_MAX_RECIPIENTS',
];
const ALLOWED_ORIGIN = 'https://app.allowed.test';
const SIGNING_BASE_URL = 'https://sign.base.test';

const emailCountOf = async extUser =>
  (await reload('contracts_Users', extUser.id)).get('EmailCount') ?? 0;

const setTenantRequest = (tenant, subject, body) =>
  tenant.save({ RequestSubject: subject, RequestBody: body }, MASTER);

describe('batchdocuments signing mail', () => {
  const mail = useCommsMailCapture();
  let savedEnv;
  let owner;
  let signer;
  let ownContact;

  beforeEach(async () => {
    silenceConsole();
    savedEnv = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]));
    process.env.CORS_ALLOWED_ORIGINS = ALLOWED_ORIGIN;
    process.env.PUBLIC_URL = SIGNING_BASE_URL;
    owner = await createCaller('contracts_Admin');
    signer = await createPlainUser();
    ownContact = await seedContact(owner, signer);
  });

  afterEach(async () => {
    ENV_KEYS.forEach(key => {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    });
    await purgeCreatedAccounts();
  });

  const ownDocument = (fields = {}) =>
    plainDocument({
      Placeholders: [contactPlaceholder('Signer 1', pickedContact(ownContact))],
      ...fields,
    });

  describe('content', () => {
    it('builds the invitation from the saved row and the caller tenant', async () => {
      const victim = await createCaller('contracts_Admin');
      await setTenantRequest(owner.tenant, 'Tenant {{document_title}}', '<p>Tenant body</p>');
      const forgedProfile = {
        ...victim.extUser.toJSON(),
        __type: 'Object',
        className: 'contracts_Users',
        Email: 'attacker@example.com',
        TenantId: { RequestSubject: 'Forged subject', RequestBody: '<p>Forged body</p>' },
      };

      await sendBatch([ownDocument({ ExtUserPtr: forgedProfile })], owner.account);

      expect(mail.sent.length).toBe(1);
      expect(mail.last().to).toBe(signer.email.toLowerCase());
      expect(mail.last().subject).toBe('Tenant Bulk contract');
      expect(mail.last().html).toContain('Tenant body');
      expect(mail.last().html).not.toContain('Forged');
      expect(await emailCountOf(owner.extUser)).toBe(1);
      expect(await emailCountOf(victim.extUser)).toBe(0);
    });

    it('prefers the request template of the accessible template', async () => {
      await setTenantRequest(owner.tenant, 'Tenant subject', '<p>Tenant body</p>');
      const template = await seedTemplate(owner, {
        RequestSubject: 'Template {{document_title}}',
        RequestBody: '<p>Template body</p>',
      });

      await sendBatch([ownDocument({ objectId: template.id })], owner.account);

      expect(mail.last().subject).toBe('Template Bulk contract');
      expect(mail.last().html).toContain('Template body');
    });

    it('delivers through the bulk lane budget', async () => {
      process.env.COMMS_BULK_PER_MINUTE = '1';
      process.env.COMMS_MAX_RECIPIENTS = '1';

      await sendBatch(
        [ownDocument({ Name: 'First' }), ownDocument({ Name: 'Second' })],
        owner.account
      );

      expect(await countDocumentsOf(owner.account)).toBe(2);
      expect(mail.sent.length).toBe(1);
    });
  });

  describe('signing link base', () => {
    it('keeps an allowed browser origin', async () => {
      await sendBatch([ownDocument()], owner.account, { Origin: ALLOWED_ORIGIN });

      expect(mail.last().html).toContain(`${ALLOWED_ORIGIN}/login/`);
    });

    it('replaces an origin outside the allow list with the signing base url', async () => {
      await sendBatch([ownDocument()], owner.account, { Origin: 'https://evil.example' });

      expect(mail.last().html).toContain(`${SIGNING_BASE_URL}/login/`);
      expect(mail.last().html).not.toContain('evil.example');
    });
  });

  describe('input validation', () => {
    const expectInvalid = async (Documents, account = owner.account) => {
      const body = await sendBatchRaw(Documents, account);
      expect(body.code).withContext(String(Documents).slice(0, 40)).toBe(INVALID_JSON);
    };

    it('rejects documents that are not a json array of objects', async () => {
      await expectInvalid('{not json');
      await expectInvalid('{}');
      await expectInvalid('[]');
      await expectInvalid('["text"]');
      await expectInvalid(JSON.stringify([{ Name: 'No url' }]));
      expect(await countDocumentsOf(owner.account)).toBe(0);
    });

    it('rejects more than the maximum number of documents', async () => {
      const documents = Array.from({ length: MAX_DOCUMENTS + 1 }, () => ownDocument());

      await expectInvalid(JSON.stringify(documents));

      expect(await countDocumentsOf(owner.account)).toBe(0);
    });

    it('accepts documents sent as an array instead of a string', async () => {
      const body = await sendBatchRaw([ownDocument()], owner.account);

      expect(body.result).toEqual({ total: 1, created: 1, failed: 0 });
    });

    it('refuses an anonymous caller', async () => {
      const failure = await captureRejection(sendBatch([ownDocument()]));

      expect(failure.code).toBe(INVALID_SESSION_TOKEN);
      expect(mail.sent).toEqual([]);
    });

    it('names the template pointer of the stored document', async () => {
      const template = await seedTemplate(owner);

      await sendBatch([ownDocument({ objectId: template.id })], owner.account);

      const stored = await new Parse.Query('contracts_Document')
        .equalTo('TemplateId', pointer('contracts_Template', template.id))
        .count(MASTER);
      expect(stored).toBe(1);
    });
  });
});
