import {
  createAccountAsServer,
  findTenantIdOfUser,
  revokeUntrustedSessions,
  secureUnverifiedAccount,
} from '../../../cloud/parsefunction/shared/accountTakeoverGuard.js';
import {
  PASSWORD,
  captureRejection,
  createAuthDataAccount,
  createMasterKeySession,
  createPlainUser,
  createTenantOwner,
  interceptQuery,
  createTenantMember,
  createTenantScope,
  findUserByUsername,
  isSessionValid,
  openPasswordSession,
  loginRejected,
  markEmailVerified,
  resetAuthState,
  silenceConsole,
  uniqueEmail,
} from '../../utils/auth-fixtures.js';

const MASTER = { useMasterKey: true };

const readUser = userId => new Parse.Query(Parse.User).get(userId, MASTER);

const findSessions = userId => {
  const query = new Parse.Query(Parse.Session);
  query.equalTo('user', { __type: 'Pointer', className: '_User', objectId: userId });
  return query.find(MASTER);
};

describe('accountTakeoverGuard', () => {
  beforeEach(async () => {
    silenceConsole();
    await resetAuthState();
  });

  afterEach(async () => {
    await resetAuthState();
  });

  describe('secureUnverifiedAccount', () => {
    it('rotates the password of an unverified account without tenant', async () => {
      const attacker = await createPlainUser(uniqueEmail('guard-rotate'));

      const result = await secureUnverifiedAccount(attacker.id);

      expect(result).toEqual({ secured: true });
      expect(await loginRejected(attacker.email, PASSWORD)).toBeTrue();
    });

    it('revokes the sessions opened with the previous password', async () => {
      const attacker = await createPlainUser(uniqueEmail('guard-sessions'));
      expect(await isSessionValid(attacker.sessionToken)).toBeTrue();

      await secureUnverifiedAccount(attacker.id);

      expect(await isSessionValid(attacker.sessionToken)).toBeFalse();
    });

    it('revokes every password session of the account', async () => {
      const attacker = await createPlainUser(uniqueEmail('guard-many'));
      const secondToken = await openPasswordSession(attacker.email);

      await secureUnverifiedAccount(attacker.id);

      expect(await isSessionValid(secondToken)).toBeFalse();
      expect(await findSessions(attacker.id)).toEqual([]);
    });

    it('revokes the sessions that were opened by the server as well', async () => {
      const attacker = await createPlainUser(uniqueEmail('guard-masterkey'));
      const serverToken = await createMasterKeySession(attacker.id);

      await secureUnverifiedAccount(attacker.id);

      expect(await isSessionValid(serverToken)).toBeFalse();
      expect(await isSessionValid(attacker.sessionToken)).toBeFalse();
    });

    it('revokes a session that appears right after the first revocation pass', async () => {
      const attacker = await createPlainUser(uniqueEmail('guard-race'));
      let strayToken;
      const sessionLookups = interceptQuery('find', '_Session', async original => {
        const sessions = await original();
        if (!strayToken && sessions.length === 0) {
          strayToken = await createMasterKeySession(attacker.id);
        }
        return sessions;
      });

      await secureUnverifiedAccount(attacker.id);

      expect(sessionLookups.hits()).toBeGreaterThanOrEqual(2);
      expect(strayToken).toBeDefined();
      expect(await isSessionValid(strayToken)).toBeFalse();
    });

    it('removes the authData of an account pre-registered through a provider', async () => {
      const attacker = await createAuthDataAccount();

      const result = await secureUnverifiedAccount(attacker.id);

      expect(result).toEqual({ secured: true });
      expect((await readUser(attacker.id)).get('authData')).toBeFalsy();
      expect(await isSessionValid(attacker.sessionToken)).toBeFalse();
    });

    it('leaves a verified account untouched', async () => {
      const owner = await createPlainUser(uniqueEmail('guard-verified'));
      await markEmailVerified(owner.id);

      const result = await secureUnverifiedAccount(owner.id);

      expect(result).toEqual({ secured: false });
      expect(await loginRejected(owner.email, PASSWORD)).toBeFalse();
      expect(await isSessionValid(owner.sessionToken)).toBeTrue();
    });

    it('rotates an unverified member of another tenant', async () => {
      const scope = await createTenantScope();
      const other = await createTenantScope();
      const { account } = await createTenantMember('contracts_Admin', scope, 'guard-member');

      const result = await secureUnverifiedAccount(account.id, {
        linkingTenantId: other.tenant.id,
      });

      expect(result).toEqual({ secured: true });
      expect(await loginRejected(account.email, PASSWORD)).toBeTrue();
    });

    it('rotates an unverified member when no linking tenant is given', async () => {
      const scope = await createTenantScope();
      const { account } = await createTenantMember('contracts_Admin', scope, 'guard-no-tenant');

      const result = await secureUnverifiedAccount(account.id);

      expect(result).toEqual({ secured: true });
    });

    it('leaves an unverified member of the linking tenant untouched', async () => {
      const scope = await createTenantScope();
      const { account } = await createTenantMember('contracts_Admin', scope, 'guard-same');

      const result = await secureUnverifiedAccount(account.id, {
        linkingTenantId: scope.tenant.id,
      });

      expect(result).toEqual({ secured: false });
      expect(await loginRejected(account.email, PASSWORD)).toBeFalse();
      expect(await isSessionValid(account.sessionToken)).toBeTrue();
    });

    it('rotates a disabled member of the linking tenant', async () => {
      const scope = await createTenantScope();
      const { account } = await createTenantMember(
        'contracts_Admin',
        {
          ...scope,
          extras: { IsDisabled: true },
        },
        'guard-disabled'
      );

      const result = await secureUnverifiedAccount(account.id, {
        linkingTenantId: scope.tenant.id,
      });

      expect(result).toEqual({ secured: true });
    });

    it('leaves an unverified tenant owner untouched', async () => {
      const other = await createTenantScope();
      const { account } = await createTenantOwner('guard-owner');

      const result = await secureUnverifiedAccount(account.id, {
        linkingTenantId: other.tenant.id,
      });

      expect(result).toEqual({ secured: false });
      expect(await loginRejected(account.email, PASSWORD)).toBeFalse();
    });

    it('rejects with object not found when the account does not exist', async () => {
      const error = await captureRejection(secureUnverifiedAccount('missingUserId'));

      expect(error.code).toBe(Parse.Error.OBJECT_NOT_FOUND);
    });

    it('gives the account a password nobody knows', async () => {
      const attacker = await createPlainUser(uniqueEmail('guard-random'));
      await secureUnverifiedAccount(attacker.id);

      expect(await loginRejected(attacker.email, attacker.email)).toBeTrue();
    });
  });

  describe('findTenantIdOfUser', () => {
    it('returns the tenant of an active member', async () => {
      const scope = await createTenantScope();
      const { account } = await createTenantMember('contracts_User', scope, 'tenant-of');

      expect(await findTenantIdOfUser(account.id)).toBe(scope.tenant.id);
    });

    it('returns undefined for a disabled member', async () => {
      const scope = await createTenantScope();
      const { account } = await createTenantMember(
        'contracts_User',
        {
          ...scope,
          extras: { IsDisabled: true },
        },
        'tenant-of-disabled'
      );

      expect(await findTenantIdOfUser(account.id)).toBeUndefined();
    });

    it('returns undefined for an account without membership', async () => {
      const account = await createPlainUser(uniqueEmail('tenant-of-none'));

      expect(await findTenantIdOfUser(account.id)).toBeUndefined();
    });
  });

  describe('revokeUntrustedSessions', () => {
    it('revokes every non server session except the one to keep', async () => {
      const owner = await createPlainUser(uniqueEmail('revoke-others'));
      const otherToken = await openPasswordSession(owner.email);
      const serverToken = await createMasterKeySession(owner.id);

      await revokeUntrustedSessions(owner.id, owner.sessionToken);

      expect(await isSessionValid(owner.sessionToken)).toBeTrue();
      expect(await isSessionValid(otherToken)).toBeFalse();
      expect(await isSessionValid(serverToken)).toBeTrue();
    });

    it('revokes all untrusted sessions when there is no session to keep', async () => {
      const owner = await createPlainUser(uniqueEmail('revoke-all'));

      await revokeUntrustedSessions(owner.id);

      expect(await isSessionValid(owner.sessionToken)).toBeFalse();
    });
  });

  describe('createAccountAsServer', () => {
    it('creates the account with a normalized email as username and email', async () => {
      const email = uniqueEmail('Server-Made');

      const account = await createAccountAsServer({
        name: 'Server Made',
        email: ` ${email.toUpperCase()} `,
        password: PASSWORD,
        phone: '+5804141234567',
      });

      const stored = await findUserByUsername(email.toLowerCase());
      expect(account.id).toBe(stored.id);
      expect(stored.get('email')).toBe(email.toLowerCase());
      expect(stored.get('normalizedEmail')).toBe(email.toLowerCase());
      expect(stored.get('name')).toBe('Server Made');
      expect(stored.get('phone')).toBe('+5804141234567');
      expect(await loginRejected(email.toLowerCase(), PASSWORD)).toBeFalse();
    });

    it('omits the phone when none is given', async () => {
      const email = uniqueEmail('server-nophone');

      const account = await createAccountAsServer({ name: 'No Phone', email, password: PASSWORD });

      expect((await readUser(account.id)).get('phone')).toBeUndefined();
    });

    it('rejects with username taken when the email is already registered', async () => {
      const existing = await createPlainUser(uniqueEmail('server-dup'));

      const error = await captureRejection(
        createAccountAsServer({ name: 'Dup', email: existing.email, password: PASSWORD })
      );

      expect(error.code).toBe(Parse.Error.USERNAME_TAKEN);
    });
  });
});
