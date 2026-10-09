import axios from 'axios';
import passwordUtils from 'parse-server/lib/password.js';
import { secureUnverifiedAccounts } from '../../scripts/secure-unverified-accounts.js';
import {
  PASSWORD,
  captureRejection,
  createAuthDataAccount,
  createExtUser,
  createPlainUser,
  createTenantOwner,
  createTenantScope,
  isSessionValid,
  openPasswordSession,
  openPasswordSessionBypassingGate,
  pointer,
  purgeAllAccounts,
  resetAuthState,
  silenceConsole,
} from '../utils/auth-fixtures.js';

const MASTER = { useMasterKey: true };

const runOnLiveDatabase = apply =>
  secureUnverifiedAccounts({
    database: Parse.Server.database.adapter.database,
    apply,
    hashPassword: passwordUtils.hash,
    generatePassword: () => 'Rotated-By-Script-1!',
    now: () => new Date(),
  });

const registerContact = async account => {
  const contact = new Parse.Object('contracts_Contactbook');
  contact.set('UserId', pointer('_User', account.id));
  return contact.save(null, MASTER);
};

describe('secure-unverified-accounts against the live Parse server', () => {
  beforeAll(async () => {
    await purgeAllAccounts();
  });

  beforeEach(async () => {
    silenceConsole();
    await resetAuthState();
  });

  it('revokes a member session, keeps the password and then the login gate answers 205', async () => {
    const scope = await createTenantScope();
    const member = await createPlainUser();
    await createExtUser({ account: member, role: 'contracts_User', ...scope });
    const sessionToken = await openPasswordSessionBypassingGate(member.id, member.email);
    expect(await isSessionValid(sessionToken)).toBeTrue();

    await runOnLiveDatabase(true);

    expect(await isSessionValid(sessionToken)).toBeFalse();
    const rejection = await captureRejection(openPasswordSession(member.email, PASSWORD));
    expect(rejection.response.data.code).toBe(Parse.Error.EMAIL_NOT_FOUND);
  });

  it('secures a guest: old password and old session stop working', async () => {
    const guest = await createPlainUser();
    await registerContact(guest);
    const sessionToken = await openPasswordSessionBypassingGate(guest.id, guest.email);

    await runOnLiveDatabase(true);

    expect(await isSessionValid(sessionToken)).toBeFalse();
    const rejection = await captureRejection(openPasswordSession(guest.email, PASSWORD));
    expect(rejection).not.toBeNull();
  });

  it('leaves a tenant owner session and password usable', async () => {
    const { account } = await createTenantOwner();

    const summary = await runOnLiveDatabase(true);

    expect(summary.flagged.find(entry => entry.id === account.id).class).toBe('owner');
    expect(await isSessionValid(account.sessionToken)).toBeTrue();
    expect(await openPasswordSession(account.email, PASSWORD)).toEqual(jasmine.any(String));
  });

  it('flags authData accounts that are contacts', async () => {
    const anonymous = await createAuthDataAccount();
    await registerContact(anonymous);

    const summary = await runOnLiveDatabase(false);

    expect(summary.flagged.find(entry => entry.id === anonymous.id).indicators).toContain(
      'authData'
    );
  });

  it('rejects a client attempt to forge the secured marker', async () => {
    const attacker = await createPlainUser();

    const response = await axios.put(
      `${process.env.SERVER_URL}/users/${attacker.id}`,
      { credentialsSecuredAt: { __type: 'Date', iso: new Date().toISOString() } },
      {
        headers: {
          'X-Parse-Application-Id': process.env.APP_ID,
          'X-Parse-Javascript-Key': 'test',
          'X-Parse-Session-Token': attacker.sessionToken,
        },
        validateStatus: () => true,
      }
    );

    expect(response.status).toBeGreaterThanOrEqual(400);
    const stored = await new Parse.Query(Parse.User).get(attacker.id, MASTER);
    expect(stored.get('credentialsSecuredAt')).toBeUndefined();
  });
});
