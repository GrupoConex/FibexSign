import axios from 'axios';
import {
  accountExists,
  existsRecord,
  requestOtpAndReadCode,
  submitDeletion,
  useCommsMailCapture,
} from '../../utils/delete-account-fixtures.js';
import {
  createCaller,
  createExtUser,
  createPlainUser,
  createTenant,
  createTenantMember,
  interceptQuery,
  rejectFirstFor,
  resetAuthState,
  silenceConsole,
  uniqueEmail,
} from '../../utils/auth-fixtures.js';
import { knownDefect } from '../../utils/known-defect.js';

const ROUTE_ROOT = 'http://localhost:30001';
const NOT_PERMITTED =
  'This action is not permitted. Kindly contact your administrator to request account deletion.';
const TEAM_USERS_REMAIN =
  "To delete this account, start by removing all team users associated with it. Once all users are removed, you'll be able to permanently delete the account.";

const createAdminWithLinkedProfileFirst = async () => {
  const otherTenant = await createTenant('Other tenant');
  const home = await createCaller('contracts_Admin');
  const guest = await createPlainUser(uniqueEmail('dual-profile'));
  const linkedRow = await createExtUser({
    account: guest,
    role: 'contracts_User',
    tenant: otherTenant,
    extras: { IsLinkedAccount: true },
  });
  const ownRow = await createExtUser({
    account: guest,
    role: 'contracts_Admin',
    tenant: home.tenant,
    organization: home.organization,
    team: home.team,
  });
  return { account: guest, linkedRow, ownRow, tenant: home.tenant };
};

describe('self service account deletion', () => {
  const mail = useCommsMailCapture();

  beforeEach(async () => {
    silenceConsole();
    spyOn(console, 'error');
    await resetAuthState();
  });

  it('requires a code when the request carries no body', async () => {
    const admin = await createCaller('contracts_Admin');
    await requestOtpAndReadCode(admin, mail);

    const response = await axios.post(`${ROUTE_ROOT}/delete-account/${admin.account.id}`, null, {
      validateStatus: () => true,
    });

    expect(response.status).toBe(400);
    expect(response.data).toBe('OTP is required.');
  });

  it('acts on the own profile even when a linked profile was stored first', async () => {
    const dual = await createAdminWithLinkedProfileFirst();
    const { code } = await requestOtpAndReadCode(
      { account: dual.account, extUser: dual.ownRow },
      mail
    );

    const response = await submitDeletion(dual.account.id, code);

    expect(response.status).toBe(200);
    expect(await accountExists(dual.account.id)).toBeFalse();
    expect(await existsRecord('contracts_Users', dual.ownRow.id)).toBeFalse();
  });

  it('refuses an account that does not exist', async () => {
    const response = await submitDeletion('missingUser1', '123456');

    expect(response.data).toBe('User not found.');
  });

  it('refuses a login that has no profile', async () => {
    const bare = await createPlainUser(uniqueEmail('no-profile'));

    const response = await submitDeletion(bare.id, '123456');

    expect(response.data).toBe('User not found.');
    expect(await accountExists(bare.id)).toBeTrue();
  });

  it('refuses a member that is not the account administrator', async () => {
    const admin = await createCaller('contracts_Admin');
    const member = await createTenantMember('contracts_User', admin);

    const response = await submitDeletion(member.account.id, '123456');

    expect(response.data).toBe(NOT_PERMITTED);
    expect(await accountExists(member.account.id)).toBeTrue();
  });

  it('refuses while team users still belong to the tenant', async () => {
    const admin = await createCaller('contracts_Admin');
    await createTenantMember('contracts_User', admin);
    const { code } = await requestOtpAndReadCode(admin, mail);

    const response = await submitDeletion(admin.account.id, code);

    expect(response.data).toBe(TEAM_USERS_REMAIN);
    expect(await accountExists(admin.account.id)).toBeTrue();
  });

  it('reports an unexpected failure with its message', async () => {
    const admin = await createCaller('contracts_Admin');
    rejectFirstFor('contracts_Users', new Error('database offline'));

    const response = await submitDeletion(admin.account.id, '123456');

    expect(response.status).toBe(500);
    expect(response.data).toBe('database offline');
  });

  it('reports an unexpected failure that carries no message', async () => {
    const admin = await createCaller('contracts_Admin');
    interceptQuery('first', 'contracts_Users', () => Promise.reject({}));

    const response = await submitDeletion(admin.account.id, '123456');

    expect(response.status).toBe(500);
    expect(response.data).toBe('An error occurred while deleting your account.');
  });

  it(
    'KNOWN DEFECT DEF-L2-02 answers refusals with an error status',
    knownDefect(
      'DEF-L2-02',
      'self service refusals (unknown account, not permitted, team users remain) answer HTTP 200',
      async check => {
        const admin = await createCaller('contracts_Admin');
        const member = await createTenantMember('contracts_User', admin);

        const unknown = await submitDeletion('missingUser1', '123456');
        const notPermitted = await submitDeletion(member.account.id, '123456');

        check(unknown.status >= 400, 'unknown account refused with an error status');
        check(notPermitted.status >= 400, 'non admin refused with an error status');
      }
    )
  );

  it(
    'KNOWN DEFECT DEF-L2-04 removes the linked profiles of the deleted login in other tenants',
    knownDefect(
      'DEF-L2-04',
      'self deletion leaves IsLinkedAccount profiles pointing to a login that no longer exists',
      async check => {
        const dual = await createAdminWithLinkedProfileFirst();
        const { code } = await requestOtpAndReadCode(
          { account: dual.account, extUser: dual.ownRow },
          mail
        );

        await submitDeletion(dual.account.id, code);

        check(
          !(await existsRecord('contracts_Users', dual.linkedRow.id)),
          'linked profile removed with the login'
        );
      }
    )
  );
});
