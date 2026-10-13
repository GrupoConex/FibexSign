import {
  captureRejection,
  cloudRunAs,
  createCaller,
  createPlainUser,
  pointer,
  purgeCreatedAccounts,
  rejectSaveFor,
  silenceConsole,
} from '../utils/auth-fixtures.js';
import {
  canReadRow,
  fileUrl,
  reload,
  runFunctionOverRest,
  seedContact,
  seedDocument,
} from '../utils/document-fixtures.js';
import { knownDefect } from '../utils/known-defect.js';

const CLASS_NAME = 'contracts_Template';
const INVALID_SESSION_TOKEN = 209;
const OBJECT_NOT_FOUND = 101;
const BOOLEAN_SETTINGS = [
  'SendinOrder',
  'SendInOrderStrict',
  'AutomaticReminders',
  'IsEnableOTP',
  'IsTourEnabled',
  'AllowModifications',
  'NotifyOnSignatures',
];
const OPTIONAL_COPIES = [
  'RemindOnceInEvery',
  'EmailEditorType',
  'Placeholders',
  'SignatureType',
  'Bcc',
  'Cc',
  'PenColors',
];
const REMINDER_DATE = new Date('2026-05-06T07:08:09.000Z');

const saveAsTemplate = (params, account) =>
  cloudRunAs('saveastemplate', params, account?.sessionToken);

const signedPlaceholders = () => [
  { Role: 'prefill', placeHolder: [{ pageNumber: 1, pos: [{ key: 0, type: 'text' }] }] },
  {
    signerObjId: 'contact1',
    signerPtr: { objectId: 'contact1' },
    email: 'signer@example.com',
    Id: 'signer1',
    placeHolder: [
      {
        pageNumber: 1,
        pos: [
          {
            key: 1,
            type: 'text',
            SignUrl: 'u',
            options: { defaultValue: 'd', response: 'r', isReadOnly: true },
          },
          { key: 2, type: 'signature', SignUrl: 'u', options: { defaultValue: '', response: 'r' } },
          { key: 3, type: 'date', options: { defaultValue: 'today' } },
          { key: 4, type: 'signature', SignUrl: 'u', options: { response: 'r' } },
          { key: 5, type: 'text', options: { response: 'r' } },
          { key: 6, type: 'checkbox' },
        ],
      },
      { pageNumber: 2 },
    ],
  },
  { Role: 'Witness' },
];

const selfSignedPages = () => [
  {
    pageNumber: 1,
    pos: [
      { key: 1, type: 'text', options: { defaultValue: 'd', isReadOnly: true, response: 'x' } },
      { key: 2, type: 'signature', signatureType: 'draw', options: { name: 'sign' } },
      { key: 3, type: 'date' },
    ],
  },
];

describe('saveastemplate', () => {
  let owner;

  beforeEach(async () => {
    silenceConsole();
    owner = await createCaller('contracts_Admin');
  });

  afterEach(async () => {
    await purgeCreatedAccounts();
  });

  it('rejects an anonymous caller', async () => {
    const doc = await seedDocument(owner);

    const failure = await captureRejection(saveAsTemplate({ docId: doc.id }));

    expect(failure.code).toBe(INVALID_SESSION_TOKEN);
  });

  const hiddenDocuments = {
    'a missing document id': async () => ({}),
    'an unknown document': async () => ({ docId: 'missingDoc1' }),
    'a document of another user': async () => ({
      docId: (await seedDocument(await createCaller('contracts_Admin'))).id,
    }),
    'an archived own document': async () => ({
      docId: (await seedDocument(owner, { IsArchive: true })).id,
    }),
  };
  Object.entries(hiddenDocuments).forEach(([label, buildParams]) => {
    it(`reports ${label} as not found`, async () => {
      const failure = await captureRejection(saveAsTemplate(await buildParams(), owner.account));

      expect(failure.code).toBe(OBJECT_NOT_FOUND);
      expect(failure.message).toBe('document not found.');
    });
  });

  it('applies the template defaults to a bare document', async () => {
    const doc = await seedDocument(owner, { Name: 'Bare' });

    const template = await saveAsTemplate({ docId: doc.id }, owner.account);

    const stored = await reload(CLASS_NAME, template.id);
    expect(stored.get('Name')).toBe('Bare');
    expect(stored.get('CreatedBy').id).toBe(owner.account.id);
    expect(stored.get('ExtUserPtr').id).toBe(owner.extUser.id);
    BOOLEAN_SETTINGS.forEach(field => expect(stored.get(field)).withContext(field).toBeFalse());
    expect(stored.get('TimeToCompleteDays')).toBe(15);
    OPTIONAL_COPIES.forEach(field => expect(stored.get(field)).withContext(field).toBeUndefined());
  });

  it('copies every configured setting and records the server derived ip', async () => {
    const contact = pointer(
      'contracts_Contactbook',
      (await seedContact(owner, await createPlainUser())).id
    );
    const doc = await seedDocument(owner, {
      Note: 'note',
      Description: 'description',
      ...Object.fromEntries(BOOLEAN_SETTINGS.map(field => [field, true])),
      SenderName: 'Sender',
      SenderMail: 'sender@example.com',
      RequestBody: '<p>body</p>',
      RequestSubject: 'subject',
      EmailEditorType: 'html',
      NextReminderDate: REMINDER_DATE,
      RedirectUrl: 'https://redirect.test',
      TimeToCompleteDays: 10,
      RemindOnceInEvery: 2,
      SignatureType: [{ name: 'draw', enabled: true }],
      Bcc: [contact],
      Cc: [contact],
      PenColors: ['red'],
    });

    const body = await runFunctionOverRest(
      'saveastemplate',
      { docId: doc.id },
      { 'X-Parse-Session-Token': owner.account.sessionToken, 'x-real-ip': '203.0.113.9' }
    );

    const stored = await reload(CLASS_NAME, body.result.objectId);
    BOOLEAN_SETTINGS.forEach(field => expect(stored.get(field)).withContext(field).toBeTrue());
    expect(stored.get('TimeToCompleteDays')).toBe(10);
    expect(stored.get('RemindOnceInEvery')).toBe(2);
    expect(stored.get('EmailEditorType')).toBe('html');
    expect(stored.get('SenderMail')).toBe('sender@example.com');
    expect(stored.get('PenColors')).toEqual(['red']);
    expect(stored.get('Bcc').map(row => row.id)).toEqual([contact.objectId]);
    expect(stored.get('OriginIp')).toBeTruthy();
    expect(stored.get('OriginIp')).not.toBe('203.0.113.9');
  });

  it('turns the signer placeholders into reusable roles without values', async () => {
    const doc = await seedDocument(owner, { Placeholders: signedPlaceholders() });

    const template = await saveAsTemplate({ docId: doc.id }, owner.account);

    const [signer, witness] = (await reload(CLASS_NAME, template.id)).get('Placeholders');
    expect(signer).toEqual(
      jasmine.objectContaining({
        signerObjId: '',
        signerPtr: {},
        email: '',
        Role: 'Role 1',
        Id: 'signer1',
      })
    );
    expect(witness.Role).toBe('Witness');
    expect(witness.placeHolder).toEqual([]);
    expect(signer.placeHolder[1].pos).toEqual([]);
    expect(signer.placeHolder[0].pos).toEqual([
      {
        key: 1,
        type: 'text input',
        options: { defaultValue: '', response: '', isReadOnly: false },
      },
      { key: 2, type: 'signature', signatureType: '', options: { defaultValue: '', response: '' } },
      { key: 3, type: 'date', options: { defaultValue: '', response: '' } },
      { key: 4, type: 'signature', signatureType: '', options: { response: '' } },
      { key: 5, type: 'text input', options: { response: '' } },
      { key: 6, type: 'checkbox', options: { response: '' } },
    ]);
  });

  it('wraps self signed widgets into one required role', async () => {
    const doc = await seedDocument(owner, {
      IsSignyourself: true,
      Placeholders: selfSignedPages(),
    });

    const template = await saveAsTemplate({ docId: doc.id }, owner.account);

    const [role] = (await reload(CLASS_NAME, template.id)).get('Placeholders');
    expect(role).toEqual(
      jasmine.objectContaining({
        signerObjId: '',
        signerPtr: {},
        blockColor: '#93a3db',
        Role: 'Role 1',
        email: '',
      })
    );
    expect(role.Id).toEqual(jasmine.any(Number));
    expect(role.placeHolder[0].pos).toEqual([
      {
        key: 1,
        type: 'text input',
        signatureType: '',
        options: { defaultValue: '', isReadOnly: false, response: '', status: 'required' },
      },
      {
        key: 2,
        type: 'signature',
        signatureType: '',
        options: { name: 'sign', status: 'required', response: '' },
      },
      { key: 3, type: 'date', signatureType: '', options: { status: 'required', response: '' } },
    ]);
  });

  it('propagates a failing template save', async () => {
    const doc = await seedDocument(owner);
    rejectSaveFor(CLASS_NAME, new Parse.Error(OBJECT_NOT_FOUND, 'save failed'));

    const failure = await captureRejection(saveAsTemplate({ docId: doc.id }, owner.account));

    expect(failure.message).toBe('save failed');
  });

  it(
    'KNOWN DEFECT DEF-L3-10 keeps a template saved from a document private to its owner',
    knownDefect(
      'DEF-L3-10',
      'saveastemplate stores the template with no ACL, so any session can read and write it',
      async check => {
        const stranger = await createPlainUser();
        const doc = await seedDocument(owner, { URL: fileUrl('private.pdf') });

        const template = await saveAsTemplate({ docId: doc.id }, owner.account);

        check(
          !(await canReadRow(stranger.sessionToken, CLASS_NAME, template.id)),
          'unrelated session cannot read the template'
        );
      }
    )
  );
});
