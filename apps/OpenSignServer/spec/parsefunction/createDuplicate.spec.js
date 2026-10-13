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
  countRows,
  fileUrl,
  reload,
  runFunctionOverRest,
  seedContact,
  seedTemplate,
} from '../utils/document-fixtures.js';
import { knownDefect } from '../utils/known-defect.js';

const MASTER = { useMasterKey: true };
const CLASS_NAME = 'contracts_Template';
const INVALID_QUERY = 102;
const SCRIPT_FAILED = 141;
const INVALID_SESSION_TOKEN = 209;
const DENIED = 'You cannot create duplicate of this template.';
const FALSE_DEFAULTS = [
  'SentToOthers',
  'SendinOrder',
  'SendInOrderStrict',
  'AutomaticReminders',
  'IsEnableOTP',
  'AllowModifications',
];
const ABSENT_BY_DEFAULT = [
  'Note',
  'Description',
  'Placeholders',
  'SignatureType',
  'NotifyOnSignatures',
  'SharedWith',
  'IsTourEnabled',
  'Bcc',
  'Cc',
  'RedirectUrl',
  'TimeToCompleteDays',
];

const uniqueName = prefix => uniqueEmail(prefix).replace('@example.com', '');

const duplicate = (params, account) => cloudRunAs('createduplicate', params, account?.sessionToken);

describe('createduplicate', () => {
  let owner;

  beforeEach(async () => {
    silenceConsole();
    owner = await createCaller('contracts_Admin');
  });

  afterEach(async () => {
    await purgeCreatedAccounts();
  });

  it('rejects an anonymous caller', async () => {
    const template = await seedTemplate(owner);

    const failure = await captureRejection(duplicate({ templateId: template.id }));

    expect(failure.code).toBe(INVALID_SESSION_TOKEN);
  });

  it(
    'KNOWN DEFECT DEF-L3-16 rejects a call without a template id as an invalid query',
    knownDefect(
      'DEF-L3-16',
      'createduplicate silently resolves undefined when templateId is missing instead of rejecting with INVALID_QUERY',
      async check => {
        const ownRows = () =>
          countRows(CLASS_NAME, 'CreatedBy', pointer('_User', owner.account.id));
        const before = await ownRows();

        const failure = await captureRejection(duplicate({}, owner.account));

        check(failure?.code === INVALID_QUERY, 'missing template id rejected as invalid query');
        check((await ownRows()) === before, 'nothing is created');
      }
    )
  );

  it('refuses to duplicate a template of another user', async () => {
    const name = uniqueName('foreign');
    const template = await seedTemplate(await createCaller('contracts_Admin'), { Name: name });

    const failure = await captureRejection(duplicate({ templateId: template.id }, owner.account));

    expect(failure.code).toBe(INVALID_QUERY);
    expect(failure.message).toBe(DENIED);
    expect(await countRows(CLASS_NAME, 'Name', name)).toBe(1);
  });

  it('refuses to duplicate an archived own template', async () => {
    const template = await seedTemplate(owner, { IsArchive: true });

    const failure = await captureRejection(duplicate({ templateId: template.id }, owner.account));

    expect(failure.message).toBe(DENIED);
  });

  it('copies every configured field and keeps only signers that point at a contact', async () => {
    const contact = await seedContact(owner, await createPlainUser());
    const contactPointer = pointer('contracts_Contactbook', contact.id);
    const template = await seedTemplate(owner, {
      SignedUrl: fileUrl('signed.pdf'),
      ...Object.fromEntries(FALSE_DEFAULTS.map(flag => [flag, true])),
      RemindOnceInEvery: 3,
      Signers: [contactPointer, { Role: 'unlinked' }],
      Note: 'note',
      Description: 'description',
      Placeholders: [{ Role: 'Role 1', placeHolder: [] }],
      SignatureType: [{ name: 'draw', enabled: true }],
      NotifyOnSignatures: false,
      SharedWith: [pointer('contracts_Teams', owner.team.id)],
      IsTourEnabled: true,
      Bcc: [contactPointer],
      Cc: [contactPointer],
      OriginIp: '198.51.100.4',
      RedirectUrl: 'https://redirect.test',
      TimeToCompleteDays: 7,
    });

    const result = await duplicate({ templateId: template.id }, owner.account);

    const copy = await reload(CLASS_NAME, result.objectId);
    expect(copy.id).not.toBe(template.id);
    FALSE_DEFAULTS.forEach(flag => expect(copy.get(flag)).withContext(flag).toBeTrue());
    expect(copy.get('Signers').map(signer => signer.id)).toEqual([contact.id]);
    expect(copy.get('RemindOnceInEvery')).toBe(3);
    expect(copy.get('TimeToCompleteDays')).toBe(7);
    expect(copy.get('OriginIp')).toBe('198.51.100.4');
    expect(copy.get('NotifyOnSignatures')).toBeFalse();
    ABSENT_BY_DEFAULT.forEach(field => expect(copy.get(field)).withContext(field).toBeDefined());
    expect(copy.get('CreatedBy').id).toBe(owner.account.id);
    expect(copy.get('ExtUserPtr').id).toBe(owner.extUser.id);
  });

  it('applies defaults when the template only holds the essentials', async () => {
    const template = await seedTemplate(owner);

    const result = await duplicate({ templateId: template.id }, owner.account);

    const copy = await reload(CLASS_NAME, result.objectId);
    FALSE_DEFAULTS.forEach(flag => expect(copy.get(flag)).withContext(flag).toBeFalse());
    expect(copy.get('RemindOnceInEvery')).toBe(5);
    expect(copy.get('Signers')).toEqual([]);
    ABSENT_BY_DEFAULT.forEach(field => expect(copy.get(field)).withContext(field).toBeUndefined());
    expect(copy.get('OriginIp')).toBeFalsy();
  });

  it('records the caller ip when the template has none', async () => {
    const template = await seedTemplate(owner);

    const body = await runFunctionOverRest(
      'createduplicate',
      { templateId: template.id },
      { 'X-Parse-Session-Token': owner.account.sessionToken }
    );

    expect((await reload(CLASS_NAME, body.result.objectId)).get('OriginIp')).toBeTruthy();
  });

  it('gives the copy the same ACL as the original template', async () => {
    const teammate = await createPlainUser();
    const template = await seedTemplate(owner);
    template.setACL(
      new Parse.ACL({
        [owner.account.id]: { read: true, write: true },
        [teammate.id]: { read: true },
      })
    );
    await template.save(null, MASTER);

    const result = await duplicate({ templateId: template.id }, owner.account);

    expect(await aclOf(CLASS_NAME, result.objectId)).toEqual(await aclOf(CLASS_NAME, template.id));
  });

  it(
    'KNOWN DEFECT DEF-L3-15 duplicates a template without a sender profile without crashing',
    knownDefect(
      'DEF-L3-15',
      'createduplicate reads ExtUserPtr.objectId without optional chaining and fails with an internal TypeError',
      async check => {
        const name = uniqueName('profileless');
        const template = await seedTemplate(owner, { Name: name, ExtUserPtr: undefined });

        const failure = await captureRejection(
          duplicate({ templateId: template.id }, owner.account)
        );

        check(failure?.code !== SCRIPT_FAILED, 'no internal script failure');
        check(!/Cannot read properties/.test(failure?.message ?? ''), 'no TypeError leaks');
      }
    )
  );
});
