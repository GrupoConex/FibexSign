import {
  captureRejection,
  cloudRunAs,
  createCaller,
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
  fileUrl,
  ownerFields,
  readWriteFor,
  reload,
  runFunctionOverRest,
  seedContact,
  waitForAcl,
  waitForDocumentCount,
} from '../utils/document-fixtures.js';
import { knownDefect } from '../utils/known-defect.js';

const CLASS_NAME = 'contracts_Document';
const INVALID_JSON = 107;
const INVALID_SESSION_TOKEN = 209;
const VALIDATION_ERROR = 142;
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

const findByName = name =>
  new Parse.Query(CLASS_NAME).equalTo('Name', name).first({ useMasterKey: true });

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
      TemplateId: 'template1',
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

  it(
    'KNOWN DEFECT DEF-L3-01 keeps a document without signers private to its creator',
    knownDefect(
      'DEF-L3-01',
      'createdocumentfromapp stores documents without signers with no ACL, so any session can read and write them',
      async check => {
        const stranger = await createPlainUser();
        const created = await create({ ...ownerFields(owner) }, owner.account);

        await waitForAcl(CLASS_NAME, created.id);

        check((await aclOf(CLASS_NAME, created.id)) !== null, 'document carries an ACL');
        check(
          !(await canReadRow(stranger.sessionToken, CLASS_NAME, created.id)),
          'unrelated session cannot read the document'
        );
      }
    )
  );

  it(
    'KNOWN DEFECT DEF-L3-02 binds the new document to the session user and the own contacts',
    knownDefect(
      'DEF-L3-02',
      'createdocumentfromapp trusts client supplied CreatedBy, ExtUserPtr and Signers of another user',
      async check => {
        const victim = await createCaller('contracts_Admin');
        const victimSigner = await createPlainUser();
        const victimContact = await seedContact(victim, victimSigner);
        const name = uniqueName('spoofed');

        await captureRejection(
          create(
            {
              Name: name,
              ...ownerFields(victim),
              Signers: [pointer('contracts_Contactbook', victimContact.id)],
            },
            owner.account
          )
        );

        const stored = await findByName(name);
        if (stored) await waitForAcl(CLASS_NAME, stored.id);
        check(
          !stored || stored.get('CreatedBy').id === owner.account.id,
          'CreatedBy is the caller'
        );
        check(
          !stored || stored.get('ExtUserPtr').id === owner.extUser.id,
          'ExtUserPtr is the caller'
        );
        check(
          !stored || !stored.get('Signers').some(signer => signer.id === victimContact.id),
          'signers come from the caller contact book'
        );
      }
    )
  );
});
