import { deleteUser } from '../../../cloud/customRoute/deleteAccount/deleteUserCascade.js';
import {
  countOwnedRecords,
  createDeletableAdmin,
  createLocalFile,
  existsRecord,
  localFileExists,
  localFileUrl,
  removeLocalFile,
  requestOtpAndReadCode,
  saveRows,
  seedOwnedRecords,
  submitDeletion,
  uniqueFileName,
  useCommsMailCapture,
} from '../../utils/delete-account-fixtures.js';
import {
  createPlainUser,
  createExtUser,
  createTenantMember,
  interceptQuery,
  loginRejected,
  pointer,
  rejectFindFor,
  rejectFirstFor,
  resetAuthState,
  silenceConsole,
  uniqueEmail,
} from '../../utils/auth-fixtures.js';

const MASTER = { useMasterKey: true };
const SIGNATURES_BEYOND_DEFAULT_PAGE = 105;
const NO_RECORDS = {
  documents: 0,
  templates: 0,
  contacts: 0,
  appTokens: 0,
  dataFiles: 0,
  credits: 0,
  signatures: 0,
  sessions: 0,
  extUsers: 0,
};

const rejectAll = (method, className) =>
  interceptQuery(method, className, () => Promise.reject(new Error('boom')));

const rejectDestroyFor = className => {
  const original = Parse.Object.prototype.destroy;
  return spyOn(Parse.Object.prototype, 'destroy').and.callFake(function (...args) {
    return this.className === className
      ? Promise.reject(new Error('boom'))
      : original.apply(this, args);
  });
};

describe('account deletion cascade', () => {
  const mail = useCommsMailCapture();

  beforeEach(async () => {
    silenceConsole();
    spyOn(console, 'error');
    await resetAuthState();
  });

  it('removes every record the account owns together with its tenant structure', async () => {
    const admin = await createDeletableAdmin();
    const fileName = uniqueFileName('owned');
    const filePath = await createLocalFile(fileName);
    await seedOwnedRecords(admin, { documentUrl: localFileUrl(fileName) });
    const { code } = await requestOtpAndReadCode(admin, mail);

    const response = await submitDeletion(admin.account.id, code);

    expect(response.status).toBe(200);
    expect(await countOwnedRecords(admin)).toEqual(NO_RECORDS);
    expect(await existsRecord('_User', admin.account.id)).toBeFalse();
    expect(await existsRecord('partners_Tenant', admin.tenant.id)).toBeFalse();
    expect(await existsRecord('contracts_Organizations', admin.organization.id)).toBeFalse();
    expect(await existsRecord('contracts_Teams', admin.team.id)).toBeFalse();
    expect(await localFileExists(filePath)).toBeFalse();
    await removeLocalFile(filePath);
  });

  it('removes owned rows beyond the default page size of a query', async () => {
    const admin = await createDeletableAdmin();
    await seedOwnedRecords(admin, { signatures: SIGNATURES_BEYOND_DEFAULT_PAGE });
    const { code } = await requestOtpAndReadCode(admin, mail);

    await submitDeletion(admin.account.id, code);

    expect((await countOwnedRecords(admin)).signatures).toBe(0);
  });

  it('keeps the login but makes it unusable when other contacts still reference it', async () => {
    const admin = await createDeletableAdmin();
    await saveRows('contracts_Contactbook', [
      { Name: 'Saved by someone else', UserId: pointer('_User', admin.account.id) },
    ]);
    const { code } = await requestOtpAndReadCode(admin, mail);

    const response = await submitDeletion(admin.account.id, code);

    expect(response.status).toBe(200);
    expect(await existsRecord('_User', admin.account.id)).toBeTrue();
    expect(await loginRejected(admin.account.email, 'Str0ngPassw0rd!')).toBeTrue();
    expect((await countOwnedRecords(admin)).sessions).toBe(0);
    expect(await existsRecord('contracts_Users', admin.extUser.id)).toBeFalse();
  });

  it('deletes a non admin member without touching the tenant structure', async () => {
    const admin = await createDeletableAdmin();
    const member = await createTenantMember('contracts_User', admin);

    const outcome = await deleteUser(member.account.id);

    expect(outcome.code).toBe(200);
    expect(await existsRecord('_User', member.account.id)).toBeFalse();
    expect(await existsRecord('partners_Tenant', admin.tenant.id)).toBeTrue();
    expect(await existsRecord('contracts_Teams', admin.team.id)).toBeTrue();
  });

  it('completes when referenced team and organization are already gone', async () => {
    const admin = await createDeletableAdmin();
    await admin.team.destroy(MASTER);
    await admin.organization.destroy(MASTER);
    const { code } = await requestOtpAndReadCode(admin, mail);

    const response = await submitDeletion(admin.account.id, code);

    expect(response.status).toBe(200);
    expect(await existsRecord('contracts_Users', admin.extUser.id)).toBeFalse();
  });

  it('completes for an admin without tenant or organization references', async () => {
    const account = await createPlainUser(uniqueEmail('bare-admin'));
    const extUser = await createExtUser({ account, role: 'contracts_Admin' });

    const outcome = await deleteUser(account.id);

    expect(outcome.code).toBe(200);
    expect(await existsRecord('contracts_Users', extUser.id)).toBeFalse();
  });

  it('can be repeated after the login account was already removed', async () => {
    const admin = await createDeletableAdmin();
    await (await new Parse.Query(Parse.User).get(admin.account.id, MASTER)).destroy(MASTER);

    const outcome = await deleteUser(admin.account.id);

    expect(outcome.code).toBe(200);
    expect(await existsRecord('contracts_Users', admin.extUser.id)).toBeFalse();
  });

  it('can be repeated for an orphaned login that other contacts still reference', async () => {
    const admin = await createDeletableAdmin();
    await saveRows('contracts_Contactbook', [
      { Name: 'Saved', UserId: pointer('_User', admin.account.id) },
    ]);
    await (await new Parse.Query(Parse.User).get(admin.account.id, MASTER)).destroy(MASTER);

    const outcome = await deleteUser(admin.account.id);

    expect(outcome.code).toBe(200);
  });

  it('refuses an unknown account', async () => {
    const outcome = await deleteUser('missingUser1');

    expect(outcome).toEqual({ code: 400, message: 'User not found.' });
  });
});

describe('account deletion cascade failures', () => {
  beforeEach(async () => {
    silenceConsole();
    spyOn(console, 'error');
    await resetAuthState();
  });

  const stageFailures = [
    [
      'document cleanup',
      () => rejectFindFor('contracts_Document', new Error('boom')),
      'Failed during contracts_Template cleanup:boom',
    ],
    [
      'contactbook cleanup',
      () => rejectFindFor('contracts_Contactbook', new Error('boom')),
      'Failed during contactbook cleanup:boom',
    ],
    [
      'login account cleanup',
      () => rejectAll('count', 'contracts_Contactbook'),
      'Failed during contactbook current user cleanup: boom',
    ],
    [
      'app token cleanup',
      () => rejectAll('findAll', 'appToken'),
      'Failed to delete appToken entries:boom',
    ],
    [
      'data files cleanup',
      () => rejectFindFor('partners_DataFiles', new Error('boom')),
      'Failed during partners_DataFiles cleanup:boom',
    ],
    [
      'organization cleanup',
      () => rejectFirstFor('contracts_Organizations', new Error('boom')),
      'Failed to delete contracts_Organizations entry:boom',
    ],
    [
      'tenant cleanup',
      () => rejectFirstFor('partners_Tenant', new Error('boom')),
      'Failed during partners_Tenant cleanup: boom',
    ],
    [
      'tenant credits cleanup',
      () => rejectAll('findAll', 'partners_TenantCredits'),
      'Failed during partners_TenantCredits cleanup:boom',
    ],
    [
      'signature cleanup',
      () => rejectAll('findAll', 'contracts_Signature'),
      'Failed during contracts_Signature cleanup:boom',
    ],
    [
      'contracts user removal',
      () => rejectDestroyFor('contracts_Users'),
      'Failed to delete contracts_Users entry:boom',
    ],
  ];

  stageFailures.forEach(([stage, installFailure, expectedMessage]) => {
    it(`reports the ${stage} failure and stops`, async () => {
      const admin = await createDeletableAdmin();
      installFailure();

      const outcome = await deleteUser(admin.account.id);

      expect(outcome).toEqual({ code: 400, message: expectedMessage });
    });
  });

  it('names the team that could not be removed', async () => {
    const admin = await createDeletableAdmin();
    rejectFirstFor('contracts_Teams', new Error('boom'));

    const outcome = await deleteUser(admin.account.id);

    expect(outcome).toEqual({
      code: 400,
      message: `Failed to delete team with ID ${admin.team.id}boom`,
    });
  });

  it('reports a failure that carries no message', async () => {
    const admin = await createDeletableAdmin();
    interceptQuery('findAll', 'appToken', () => Promise.reject('plain failure'));

    const outcome = await deleteUser(admin.account.id);

    expect(outcome.message).toBe('Failed to delete appToken entries:plain failure');
  });

  it('reports a failure of the initial lookup', async () => {
    const admin = await createDeletableAdmin();
    rejectFirstFor('contracts_Users', new Error('boom'));

    const outcome = await deleteUser(admin.account.id);

    expect(outcome).toEqual({ code: 400, message: 'User deletion failed: boom' });
  });
});
