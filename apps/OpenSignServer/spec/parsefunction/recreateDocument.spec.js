import {
  captureRejection,
  cloudRunAs,
  createCaller,
  createPlainUser,
  pointer,
  purgeCreatedAccounts,
  rejectSaveFor,
  silenceConsole,
  uniqueEmail,
} from '../utils/auth-fixtures.js';
import {
  aclOf,
  countRows,
  fileUrl,
  readWriteFor,
  reload,
  seedContact,
  seedDocument,
  waitForAcl,
  waitForDocumentCount,
} from '../utils/document-fixtures.js';
import { knownDefect } from '../utils/known-defect.js';

const CLASS_NAME = 'contracts_Document';
const INVALID_QUERY = 102;
const INVALID_SESSION_TOKEN = 209;
const OBJECT_NOT_FOUND = 101;
const EXCLUDED_FIELDS = [
  'DocSentAt',
  'SignedUrl',
  'AuditTrail',
  'DeclineBy',
  'DeclineReason',
  'DocumentHash',
  'CertificateUrl',
];

const uniqueName = prefix => uniqueEmail(prefix).replace('@example.com', '');

const recreate = (params, account) => cloudRunAs('recreatedoc', params, account?.sessionToken);

const usedPlaceholders = signerPointer => [
  {
    Role: 'Role 1',
    signerPtr: signerPointer,
    placeHolder: [
      {
        pageNumber: 1,
        pos: [
          {
            key: 1,
            type: 'text',
            SignUrl: fileUrl('sign.png'),
            options: { name: 'field', response: 'filled', defaultValue: 'preset' },
          },
          { key: 2, type: 'signature', options: { response: fileUrl('signature.png') } },
        ],
      },
      { pageNumber: 2 },
    ],
  },
  { Role: 'Role 2' },
];

const finishedFields = signer => ({
  IsDeclined: true,
  IsCompleted: true,
  DocSentAt: new Date(),
  SignedUrl: fileUrl('signed.pdf'),
  AuditTrail: [{ UserPtr: pointer('_User', signer.id), Activity: 'Signed' }],
  DeclineBy: pointer('_User', signer.id),
  DeclineReason: 'reason',
  DocumentHash: 'hash',
  CertificateUrl: fileUrl('certificate.pdf'),
});

describe('recreatedoc', () => {
  let owner;

  beforeEach(async () => {
    silenceConsole();
    owner = await createCaller('contracts_Admin');
  });

  afterEach(async () => {
    await purgeCreatedAccounts();
  });

  it('rejects a call without a document id as an invalid query', async () => {
    const failure = await captureRejection(recreate({}, owner.account));

    expect(failure.code).toBe(INVALID_QUERY);
  });

  it('rejects an anonymous caller', async () => {
    const doc = await seedDocument(owner);

    const failure = await captureRejection(recreate({ docId: doc.id }));

    expect(failure.code).toBe(INVALID_SESSION_TOKEN);
  });

  it('reports an unknown document as not found', async () => {
    const failure = await captureRejection(recreate({ docId: 'missingDoc1' }, owner.account));

    expect(failure.code).toBe(OBJECT_NOT_FOUND);
  });

  it('reports an archived document as not found', async () => {
    const doc = await seedDocument(owner, { IsArchive: true });

    const failure = await captureRejection(recreate({ docId: doc.id }, owner.account));

    expect(failure.code).toBe(OBJECT_NOT_FOUND);
  });

  it('refuses to recreate a self signed document and creates nothing', async () => {
    const name = uniqueName('self');
    const doc = await seedDocument(owner, { Name: name, IsSignyourself: true });

    const failure = await captureRejection(recreate({ docId: doc.id }, owner.account));

    expect(failure.message).toBe('Signyourself Document not allowed');
    expect(await countRows(CLASS_NAME, 'Name', name)).toBe(1);
  });

  it('creates a fresh unsigned copy for the owner and returns only its identity', async () => {
    const signer = await createPlainUser();
    const contact = await seedContact(owner, signer);
    const signerPointer = pointer('contracts_Contactbook', contact.id);
    const name = uniqueName('copy');
    const doc = await seedDocument(owner, {
      Name: name,
      Signers: [signerPointer],
      Placeholders: usedPlaceholders(signerPointer),
      ...finishedFields(signer),
    });
    await waitForAcl(CLASS_NAME, doc.id);

    const result = await recreate({ docId: doc.id }, owner.account);

    expect(Object.keys(result).sort()).toEqual(['createdAt', 'objectId', 'updatedAt']);
    const copy = await reload(CLASS_NAME, result.objectId);
    expect(copy.get('Name')).toBe(name);
    expect(copy.get('CreatedBy').id).toBe(owner.account.id);
    expect(copy.get('IsDeclined')).toBeFalse();
    expect(copy.get('IsCompleted')).toBeFalse();
    EXCLUDED_FIELDS.forEach(field => expect(copy.get(field)).withContext(field).toBeUndefined());
    expect(await waitForAcl(CLASS_NAME, copy.id)).toBeTrue();
    expect(await aclOf(CLASS_NAME, copy.id)).toEqual(readWriteFor(owner.account.id, signer.id));
    expect(await waitForDocumentCount(owner.extUser, 1)).toBeTrue();
  });

  it('clears responses, defaults and signature images from the copied placeholders', async () => {
    const signerPointer = pointer('contracts_Contactbook', 'contact1');
    const doc = await seedDocument(owner, { Placeholders: usedPlaceholders(signerPointer) });

    const result = await recreate({ docId: doc.id }, owner.account);

    const [first, second] = (await reload(CLASS_NAME, result.objectId)).get('Placeholders');
    const [textWidget, signatureWidget] = first.placeHolder[0].pos;
    expect(textWidget.SignUrl).toBeUndefined();
    expect(textWidget.type).toBe('text input');
    expect(textWidget.options).toEqual({ name: 'field', response: '', defaultValue: '' });
    expect(signatureWidget.type).toBe('signature');
    expect(signatureWidget.options).toEqual({ response: '', defaultValue: '' });
    expect(first.placeHolder[1].pos).toEqual([]);
    expect(second.placeHolder).toEqual([]);
  });

  it('propagates a failing save of the copy', async () => {
    const doc = await seedDocument(owner);
    rejectSaveFor(CLASS_NAME, new Parse.Error(INVALID_QUERY, 'save failed'));

    const failure = await captureRejection(recreate({ docId: doc.id }, owner.account));

    expect(failure.code).toBe(INVALID_QUERY);
    expect(failure.message).toBe('save failed');
  });

  it(
    'KNOWN DEFECT DEF-L3-08 refuses to recreate a document of another user',
    knownDefect(
      'DEF-L3-08',
      'recreatedoc has no ownership check: any session clones any document by objectId into the victim account',
      async check => {
        const intruder = await createCaller('contracts_Admin');
        const name = uniqueName('victim');
        const doc = await seedDocument(owner, { Name: name });

        const failure = await captureRejection(recreate({ docId: doc.id }, intruder.account));

        check(failure !== null, 'intruder call is rejected');
        check((await countRows(CLASS_NAME, 'Name', name)) === 1, 'no copy of the victim document');
      }
    )
  );
});
