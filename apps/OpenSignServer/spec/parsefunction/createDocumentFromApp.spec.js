import {
  captureRejection,
  cloudRunAs,
  createCaller,
  createExtUser,
  createPlainUser,
  pointer,
  purgeCreatedAccounts,
  silenceConsole,
  uniqueEmail,
} from '../utils/auth-fixtures.js';
import {
  aclOf,
  canReadRow,
  countRows,
  documentCountOf,
  fileUrl,
  ownerFields,
  readWriteFor,
  reload,
  runFunctionOverRest,
  seedContact,
  seedTemplate,
  waitForAcl,
  waitForDocumentCount,
} from '../utils/document-fixtures.js';

const CLASS_NAME = 'contracts_Document';
const INVALID_JSON = 107;
const INVALID_SESSION_TOKEN = 209;
const VALIDATION_ERROR = 142;
const OPERATION_FORBIDDEN = 119;
const DEFAULT_FLAGS = [
  'SentToOthers',
  'SendinOrder',
  'SendInOrderStrict',
  'IsEnableOTP',
  'IsTourEnabled',
  'AllowModifications',
  'AutomaticReminders',
  'NotifyOnSignatures',
];
const OPTIONAL_FIELDS = [
  'Description',
  'Note',
  'SignedUrl',
  'TimeToCompleteDays',
  'RemindOnceInEvery',
  'DocSentAt',
  'RedirectUrl',
  'TemplateId',
  'Signers',
  'Placeholders',
  'SignatureType',
  'Bcc',
  'Cc',
  'PenColors',
];
const SENT_AT = '2026-01-02T03:04:05.000Z';

const uniqueName = prefix => uniqueEmail(prefix).replace('@example.com', '');

const create = (document, account) =>
  cloudRunAs('createdocumentfromapp', { document }, account?.sessionToken);

const contactPointer = objectId => pointer('contracts_Contactbook', objectId);

describe('createdocumentfromapp', () => {
  let owner;

  beforeEach(async () => {
    silenceConsole();
    owner = await createCaller('contracts_Admin');
  });

  afterEach(async () => {
    await purgeCreatedAccounts();
  });

  it('rejects a call without a document payload as invalid json', async () => {
    const failure = await captureRejection(
      cloudRunAs('createdocumentfromapp', {}, owner.account.sessionToken)
    );

    expect(failure.code).toBe(INVALID_JSON);
  });

  it('rejects an anonymous caller and stores nothing', async () => {
    const name = uniqueName('anonymous');

    const failure = await captureRejection(create({ Name: name, ...ownerFields(owner) }));

    expect(failure.code).toBe(INVALID_SESSION_TOKEN);
    expect(await countRows(CLASS_NAME, 'Name', name)).toBe(0);
  });

  it('stores safe defaults when the payload only names the owner', async () => {
    const created = await create(
      { ...ownerFields(owner), Signers: [], Placeholders: 'none', Bcc: [], PenColors: {} },
      owner.account
    );

    const stored = await reload(CLASS_NAME, created.id);
    expect(stored.get('Name')).toBe('untitled document');
    expect(stored.get('OriginIp')).toBe('');
    DEFAULT_FLAGS.forEach(flag => expect(stored.get(flag)).withContext(flag).toBeFalse());
    ['Description', 'Note', 'SignedUrl', 'RedirectUrl', 'TemplateId', 'DocSentAt'].forEach(field =>
      expect(stored.get(field)).withContext(field).toBeUndefined()
    );
    ['Signers', 'Placeholders', 'SignatureType', 'Bcc', 'Cc', 'PenColors'].forEach(field =>
      expect(stored.get(field)).withContext(field).toBeUndefined()
    );
  });

  it('stores every supplied field and the server derived ip instead of a spoofed header', async () => {
    const signer = await createPlainUser();
    const contact = await seedContact(owner, signer);
    const contactPointer = pointer('contracts_Contactbook', contact.id);
    const template = await seedTemplate(owner);
    const document = {
      Name: uniqueName('full'),
      URL: fileUrl('full.pdf'),
      ...ownerFields(owner),
      Description: 'description',
      Note: 'note',
      SignedUrl: fileUrl('signed.pdf'),
      ...Object.fromEntries(DEFAULT_FLAGS.map(flag => [flag, true])),
      SendInOrderStrict: 'yes',
      TimeToCompleteDays: '7',
      RemindOnceInEvery: '2',
      DocSentAt: { iso: SENT_AT },
      RedirectUrl: 'https://redirect.test',
      TemplateId: pointer('contracts_Template', template.id),
      Signers: [contactPointer],
      Placeholders: [{ Role: 'Role 1', placeHolder: [] }],
      SignatureType: [{ name: 'draw', enabled: true }],
      Bcc: [contactPointer],
      Cc: [contactPointer],
      PenColors: ['blue'],
    };

    const body = await runFunctionOverRest(
      'createdocumentfromapp',
      { document },
      { 'X-Parse-Session-Token': owner.account.sessionToken, 'x-real-ip': '203.0.113.7' }
    );

    const stored = await reload(CLASS_NAME, body.result.objectId);
    expect(stored.get('OriginIp')).not.toBe('203.0.113.7');
    expect(stored.get('OriginIp')).toBeTruthy();
    DEFAULT_FLAGS.forEach(flag => expect(stored.get(flag)).withContext(flag).toBeTrue());
    expect(stored.get('TimeToCompleteDays')).toBe(7);
    expect(stored.get('RemindOnceInEvery')).toBe(2);
    expect(stored.get('DocSentAt')).toEqual(new Date(SENT_AT));
    OPTIONAL_FIELDS.forEach(field => expect(stored.get(field)).withContext(field).toBeDefined());
    expect(stored.get('PenColors')).toEqual(['blue']);
    await waitForAcl(CLASS_NAME, stored.id);
  });

  it('increments the document count of the extended user of the payload', async () => {
    await create({ ...ownerFields(owner) }, owner.account);

    expect(await waitForDocumentCount(owner.extUser, 1)).toBeTrue();
  });

  it('propagates a rejected save and stores nothing', async () => {
    const name = 'n'.repeat(251);

    const failure = await captureRejection(
      create({ Name: name, ...ownerFields(owner) }, owner.account)
    );

    expect(failure.code).toBe(VALIDATION_ERROR);
    expect(await countRows(CLASS_NAME, 'Name', name)).toBe(0);
  });

  it('restricts a document with signers to its creator and the signer accounts', async () => {
    const signer = await createPlainUser();
    const contact = await seedContact(owner, signer);

    const created = await create(
      { ...ownerFields(owner), Signers: [pointer('contracts_Contactbook', contact.id)] },
      owner.account
    );

    expect(await waitForAcl(CLASS_NAME, created.id)).toBeTrue();
    expect(await aclOf(CLASS_NAME, created.id)).toEqual(readWriteFor(owner.account.id, signer.id));
  });

  it('keeps a document without signers private to its creator', async () => {
    const stranger = await createPlainUser();

    const created = await create({ ...ownerFields(owner) }, owner.account);

    expect(await aclOf(CLASS_NAME, created.id)).toEqual(readWriteFor(owner.account.id));
    expect(await canReadRow(stranger.sessionToken, CLASS_NAME, created.id)).toBeFalse();
  });

  describe('binding to the session user', () => {
    let victim;

    beforeEach(async () => {
      victim = await createCaller('contracts_Admin');
    });

    it('rejects signers from the contact book of another user and stores nothing', async () => {
      const victimContact = await seedContact(victim, await createPlainUser());
      const name = uniqueName('spoofed');

      const failure = await captureRejection(
        create(
          { Name: name, ...ownerFields(owner), Signers: [contactPointer(victimContact.id)] },
          owner.account
        )
      );

      expect(failure.code).toBe(OPERATION_FORBIDDEN);
      expect(await countRows(CLASS_NAME, 'Name', name)).toBe(0);
    });

    it('rejects bcc and cc contacts of another user', async () => {
      const victimContact = await seedContact(victim, await createPlainUser());

      const bccFailure = await captureRejection(
        create({ ...ownerFields(owner), Bcc: [contactPointer(victimContact.id)] }, owner.account)
      );
      const ccFailure = await captureRejection(
        create({ ...ownerFields(owner), Cc: [contactPointer(victimContact.id)] }, owner.account)
      );

      expect(bccFailure.code).toBe(OPERATION_FORBIDDEN);
      expect(ccFailure.code).toBe(OPERATION_FORBIDDEN);
    });

    it('rejects a signer pointer that is not a contact', async () => {
      const failure = await captureRejection(
        create(
          { ...ownerFields(owner), Signers: [pointer('_User', victim.account.id)] },
          owner.account
        )
      );

      expect(failure.code).toBe(OPERATION_FORBIDDEN);
    });

    it('attributes the document to the caller when another owner is sent', async () => {
      const created = await create({ ...ownerFields(victim) }, owner.account);

      const stored = await reload(CLASS_NAME, created.id);
      expect(stored.get('CreatedBy').id).toBe(owner.account.id);
      expect(stored.get('ExtUserPtr').id).toBe(owner.extUser.id);
      expect(await aclOf(CLASS_NAME, created.id)).toEqual(readWriteFor(owner.account.id));
      expect(await waitForDocumentCount(owner.extUser, 1)).toBeTrue();
      expect(await documentCountOf(victim.extUser)).toBe(0);
    });

    it('accepts a linked profile of the caller', async () => {
      const linked = await createExtUser({
        account: owner.account,
        role: 'contracts_User',
        tenant: owner.tenant,
        extras: { IsLinkedAccount: true },
      });

      const created = await create(
        {
          CreatedBy: pointer('_User', owner.account.id),
          ExtUserPtr: pointer('contracts_Users', linked.id),
        },
        owner.account
      );

      expect((await reload(CLASS_NAME, created.id)).get('ExtUserPtr').id).toBe(linked.id);
      expect(await waitForDocumentCount(linked, 1)).toBeTrue();
    });
  });
});
