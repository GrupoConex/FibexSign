import {
  accountExists,
  deleteAsAdmin,
  elapseCooldown,
  existsRecord,
  reloadExtUser,
  requestOtpAndReadCode,
  stubSessionLookup,
  submitDeletion,
  useCommsMailCapture,
} from '../../utils/delete-account-fixtures.js';
import {
  createCaller,
  createTenantMember,
  interceptQuery,
  resetAuthState,
  silenceConsole,
} from '../../utils/auth-fixtures.js';

const failOnlyFirstAppTokenCleanup = () => {
  let calls = 0;
  return interceptQuery('findAll', 'appToken', run =>
    calls++ === 0 ? Promise.reject(new Error('boom')) : run()
  );
};

describe('deletion retried after a partial failure', () => {
  const mail = useCommsMailCapture();

  beforeEach(async () => {
    silenceConsole();
    spyOn(console, 'error');
    stubSessionLookup();
    await resetAuthState();
  });

  it('lets the account owner finish the cascade once the login was already removed', async () => {
    const admin = await createCaller('contracts_Admin');
    failOnlyFirstAppTokenCleanup();
    const first = await requestOtpAndReadCode(admin, mail);
    const failed = await submitDeletion(admin.account.id, first.code);
    await elapseCooldown(await reloadExtUser(admin.extUser));
    const second = await requestOtpAndReadCode(admin, mail);

    const retried = await submitDeletion(admin.account.id, second.code);

    expect(failed.status).toBe(400);
    expect(await accountExists(admin.account.id)).toBeFalse();
    expect(retried.status).toBe(200);
    expect(await existsRecord('contracts_Users', admin.extUser.id)).toBeFalse();
    expect(await existsRecord('partners_Tenant', admin.tenant.id)).toBeFalse();
  });

  it('lets the administrator finish removing a member whose login was already removed', async () => {
    const admin = await createCaller('contracts_Admin');
    const member = await createTenantMember('contracts_User', admin);
    failOnlyFirstAppTokenCleanup();
    const failed = await deleteAsAdmin(admin.account.sessionToken, member.account.id);

    const retried = await deleteAsAdmin(admin.account.sessionToken, member.account.id);

    expect(failed.status).toBe(400);
    expect(retried.status).toBe(200);
    expect(await existsRecord('contracts_Users', member.extUser.id)).toBeFalse();
  });
});
