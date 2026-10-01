import { hashOtp } from '../../cloud/parsefunction/shared/otpPolicy.js';
import {
  buildUserDetails,
  captureConsoleError,
  captureRejection,
  cloudRunAs,
  createOtpRecord,
  createPlainUser,
  createTenantMember,
  createCaller,
  createTenantScope,
  findFirstByUserId,
  findOtpRecord,
  findUserByUsername,
  pointer,
  purgeAllExtUsers,
  interceptQuery,
  rejectFindFor,
  rejectFirstFor,
  rejectSaveFor,
  resolveSaveFor,
  stubFirstFor,
  stubGetFor,
  resetAuthState,
  silenceConsole,
  uniqueEmail,
  waitUntil,
} from './auth-fixtures.js';

describe('auth fixtures', () => {
  it('generates distinct emails for the same prefix', () => {
    const first = uniqueEmail('dup');
    const second = uniqueEmail('dup');

    expect(first).not.toBe(second);
    expect(first).toMatch(/^dup-\d+-\d+@example\.com$/);
  });

  it('builds a pointer with the given class and id', () => {
    expect(pointer('_User', 'abc')).toEqual({
      __type: 'Pointer',
      className: '_User',
      objectId: 'abc',
    });
  });

  it('lets overrides win over the default user details', () => {
    const details = buildUserDetails({ role: 'contracts_User', name: 'Custom' });

    expect(details.role).toBe('contracts_User');
    expect(details.name).toBe('Custom');
    expect(details.company).toBe('Acme');
  });

  it('creates a plain user that can be found by username and holds a session token', async () => {
    const account = await createPlainUser();

    const stored = await findUserByUsername(account.email);

    expect(stored.id).toBe(account.id);
    expect(typeof account.sessionToken).toBe('string');
  });

  it('creates a tenant member linked to its tenant scope', async () => {
    const scope = await createTenantScope();

    const member = await createTenantMember('contracts_OrgAdmin', scope);
    const stored = await findFirstByUserId('contracts_Users', member.account.id);

    expect(stored.get('UserRole')).toBe('contracts_OrgAdmin');
    expect(stored.get('TenantId').id).toBe(scope.tenant.id);
    expect(stored.get('OrganizationId').id).toBe(scope.organization.id);
    expect(stored.get('TeamIds')[0].id).toBe(scope.team.id);
  });

  it('creates and finds an otp record keyed by email', async () => {
    const email = uniqueEmail('otp-fixture');

    await createOtpRecord(email, { otp: 123456 });
    const stored = await findOtpRecord(email);

    expect(stored.get('OtpHash')).toBe(hashOtp(123456));
    expect(stored.get('OTP')).toBeUndefined();
    expect(stored.get('FailedAttempts')).toBe(0);
  });

  it('captures a rejection and returns null on resolution', async () => {
    const rejected = await captureRejection(Promise.reject(new Error('boom')));
    const resolved = await captureRejection(Promise.resolve(1));

    expect(rejected.message).toBe('boom');
    expect(resolved).toBeNull();
  });

  it('runs cloud functions with and without a session token', async () => {
    const account = await createPlainUser();

    const anonymous = await cloudRunAs('getUserDetails', { email: uniqueEmail('nobody') });
    const authenticated = await cloudRunAs('getUserDetails', {}, account.sessionToken);

    expect(anonymous).toEqual({ exists: false });
    expect(authenticated).toBe('');
  });

  it('purges every ext user regardless of role or quantity', async () => {
    const scope = await createTenantScope();
    const members = await Promise.all([
      createTenantMember('contracts_User', scope, 'purge-user'),
      createTenantMember('contracts_Admin', scope, 'purge-admin'),
    ]);
    const extras = Array.from({ length: 1001 }, () => new Parse.Object('contracts_Users'));
    await Parse.Object.saveAll(extras, { useMasterKey: true });

    await purgeAllExtUsers();

    const survivors = await new Parse.Query('contracts_Users')
      .containedIn('objectId', [
        ...members.map(member => member.extUser.id),
        ...extras.map(extra => extra.id),
      ])
      .count({ useMasterKey: true });
    expect(survivors).toBe(0);
  });

  it('clears the sdk current user when resetting auth state', async () => {
    const account = await createPlainUser();
    await Parse.User.logIn(account.email, 'Str0ngPassw0rd!');
    expect(Parse.User.current()).toBeTruthy();

    await resetAuthState();

    expect(Parse.User.current()).toBeFalsy();
  });

  it('replaces console log with a spy and leaves console error untouched', () => {
    const logSpy = silenceConsole();

    expect(jasmine.isSpy(console.log)).toBeTrue();
    expect(jasmine.isSpy(console.error)).toBeFalse();
    expect(logSpy).toBe(console.log);
  });

  it('replaces console error with a spy on demand', () => {
    const errorSpy = captureConsoleError();

    expect(errorSpy).toBe(console.error);
    expect(jasmine.isSpy(console.error)).toBeTrue();
  });

  it('rejects saves only for the targeted class', async () => {
    const failure = new Error('targeted failure');
    rejectSaveFor('partners_Tenant', failure);

    const tenantError = await captureRejection(createTenantScope());
    const other = await new Parse.Object('fixture_Other').save(null, { useMasterKey: true });

    expect(tenantError).toBe(failure);
    expect(other.id).toBeDefined();
  });

  it('stubs query first only for the targeted class and counts its hits', async () => {
    const stubbed = { id: 'stubbed' };
    const stub = stubFirstFor('fixture_Stubbed', stubbed);

    const stubbedResult = await new Parse.Query('fixture_Stubbed').first({ useMasterKey: true });
    const passthroughResult = await new Parse.Query('fixture_Empty').first({ useMasterKey: true });

    expect(stubbedResult).toBe(stubbed);
    expect(passthroughResult).toBeUndefined();
    expect(stub.hits()).toBe(1);
  });

  it('stubs query get only for the targeted class', async () => {
    const stubbed = { id: 'stubbed-get' };
    const stub = stubGetFor('fixture_StubbedGet', stubbed);

    const stubbedResult = await new Parse.Query('fixture_StubbedGet').get('any', {
      useMasterKey: true,
    });
    const passthrough = await captureRejection(
      new Parse.Query('fixture_Empty').get('missing', { useMasterKey: true })
    );

    expect(stubbedResult).toBe(stubbed);
    expect(passthrough.code).toBe(Parse.Error.OBJECT_NOT_FOUND);
    expect(stub.hits()).toBe(1);
  });

  it('rejects query find only for the targeted class', async () => {
    const failure = new Error('find failed');
    const rejection = rejectFindFor('fixture_RejectedFind', failure);

    const rejected = await captureRejection(
      new Parse.Query('fixture_RejectedFind').find({ useMasterKey: true })
    );
    const passthrough = await new Parse.Query('fixture_Empty').find({ useMasterKey: true });

    expect(rejected).toBe(failure);
    expect(passthrough).toEqual([]);
    expect(rejection.hits()).toBe(1);
  });

  it('lets an intercepted query call the original implementation', async () => {
    const interception = interceptQuery('first', 'fixture_Wrapped', async callOriginal => {
      const original = await callOriginal();
      return { wrapped: original };
    });

    const result = await new Parse.Query('fixture_Wrapped').first({ useMasterKey: true });

    expect(result).toEqual({ wrapped: undefined });
    expect(interception.hits()).toBe(1);
  });

  it('resolves saves only for the targeted class with the given value', async () => {
    resolveSaveFor('partners_Tenant', undefined);

    const tenantResult = await new Parse.Object('partners_Tenant').save(null, {
      useMasterKey: true,
    });
    const other = await new Parse.Object('fixture_Resolved').save(null, { useMasterKey: true });

    expect(tenantResult).toBeUndefined();
    expect(other.id).toBeDefined();
  });

  it('creates a caller with tenant scope overrides and extras', async () => {
    const caller = await createCaller(
      'contracts_OrgAdmin',
      { organization: undefined },
      { Flag: 1 }
    );

    const stored = await findFirstByUserId('contracts_Users', caller.account.id);

    expect(stored.get('UserRole')).toBe('contracts_OrgAdmin');
    expect(stored.get('OrganizationId')).toBeUndefined();
    expect(stored.get('Flag')).toBe(1);
    expect(stored.get('TenantId').id).toBe(caller.tenant.id);
    expect(caller.organization.id).toBeDefined();
  });

  it('resolves waitUntil with true once the condition becomes true', async () => {
    let attempts = 0;

    const reached = await waitUntil(() => ++attempts >= 3, { intervalMs: 1 });

    expect(reached).toBeTrue();
    expect(attempts).toBe(3);
  });

  it('resolves waitUntil with false when the condition never becomes true', async () => {
    const reached = await waitUntil(() => false, { timeoutMs: 30, intervalMs: 5 });

    expect(reached).toBeFalse();
  });

  it('rejects query first only for the targeted class and counts its hits', async () => {
    const failure = new Error('first failed');
    const rejection = rejectFirstFor('fixture_Rejected', failure);

    const rejected = await captureRejection(
      new Parse.Query('fixture_Rejected').first({ useMasterKey: true })
    );
    const passthrough = await new Parse.Query('fixture_Empty').first({ useMasterKey: true });

    expect(rejected).toBe(failure);
    expect(passthrough).toBeUndefined();
    expect(rejection.hits()).toBe(1);
  });
});
