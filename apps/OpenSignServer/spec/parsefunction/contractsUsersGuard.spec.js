import axios from 'axios';
import {
  PASSWORD,
  captureRejection,
  cloudRunAs,
  createCaller,
  createExtUser,
  createOrganization,
  createPlainUser,
  createTeam,
  createTenantMember,
  createTenantScope,
  findFirstByUserId,
  pointer,
  resetAuthState,
  silenceConsole,
  uniqueEmail,
} from '../utils/auth-fixtures.js';

const MASTER = { useMasterKey: true };
const PRODUCTION_CLP = {
  get: {},
  find: {},
  count: {},
  create: { '*': true },
  update: { '*': true },
  delete: {},
  addField: {},
};
const OPEN_CLP = Object.fromEntries(
  Object.keys(PRODUCTION_CLP).map(operation => [operation, { '*': true }])
);

const rest = (method, path, sessionToken, data) =>
  axios({
    method,
    url: `${process.env.SERVER_URL}${path}`,
    data,
    headers: {
      'X-Parse-Application-Id': process.env.APP_ID,
      'X-Parse-Javascript-Key': 'test',
      'X-Parse-Session-Token': sessionToken,
    },
    validateStatus: () => true,
  });

const putRow = (row, sessionToken, data) =>
  rest('put', `/classes/contracts_Users/${row.id}`, sessionToken, data);

const reload = row => new Parse.Query('contracts_Users').get(row.id, MASTER);

const applyClp = async classLevelPermissions => {
  const schema = new Parse.Schema('contracts_Users');
  schema.setCLP(classLevelPermissions);
  await schema.update();
};

const expectRejected = response => {
  expect(response.status).toBeGreaterThanOrEqual(400);
  expect(response.status).toBeLessThan(500);
};

describe('contracts_Users guard', () => {
  beforeAll(async () => {
    const seed = new Parse.Object('contracts_Users');
    seed.set('TourStatus', [{ seeded: true }]);
    ['JobTitle', 'Company', 'Language', 'Phone', 'Name', 'Email', 'UserRole'].forEach(field =>
      seed.set(field, 'seed')
    );
    seed.set('IsDisabled', false);
    seed.set('IsLinkedAccount', false);
    seed.set('TeamIds', []);
    ['DocumentCount', 'EmailCount', 'TemplateCount', 'usedStorage', 'DeleteOTPTries'].forEach(
      field => seed.set(field, 0)
    );
    seed.set('SignatureType', []);
    seed.set('IsLTVEnabled', false);
    seed.set('NotifyOnSignatures', false);
    seed.set('DeleteOTP', 'seed');
    seed.set('DeleteOTPExpiry', new Date());
    seed.set('DeleteOTPSentAt', new Date());
    await seed.save(null, MASTER);
    await seed.destroy(MASTER);
    await applyClp(PRODUCTION_CLP);
  });

  afterAll(async () => {
    await applyClp(OPEN_CLP);
  });

  beforeEach(async () => {
    silenceConsole();
    await resetAuthState();
  });

  afterEach(async () => {
    await resetAuthState();
  });

  describe('forged creation', () => {
    it('rejects a forged admin row created by an ordinary authenticated user', async () => {
      const attacker = await createPlainUser(uniqueEmail('forger'));
      const victimScope = await createTenantScope();

      const response = await rest('post', '/classes/contracts_Users', attacker.sessionToken, {
        UserRole: 'contracts_Admin',
        Email: attacker.email,
        Name: 'Forged Admin',
        TenantId: pointer('partners_Tenant', victimScope.tenant.id),
        OrganizationId: pointer('contracts_Organizations', victimScope.organization.id),
        UserId: pointer('_User', attacker.id),
      });

      expectRejected(response);
      expect(await findFirstByUserId('contracts_Users', attacker.id)).toBeUndefined();
    });

    it('rejects a forged row created without any session', async () => {
      const response = await rest('post', '/classes/contracts_Users', undefined, {
        UserRole: 'contracts_Admin',
        Email: uniqueEmail('anonymous-forger'),
      });

      expectRejected(response);
    });
  });

  describe('forged chain towards another tenant', () => {
    it('does not let a forged admin row reset passwords or add users in a foreign tenant', async () => {
      const attacker = await createPlainUser(uniqueEmail('chain-attacker'));
      const victim = await createCaller('contracts_Admin');
      const victimMember = await createTenantMember('contracts_User', victim);

      await rest('post', '/classes/contracts_Users', attacker.sessionToken, {
        UserRole: 'contracts_Admin',
        Email: attacker.email,
        TenantId: pointer('partners_Tenant', victim.tenant.id),
        OrganizationId: pointer('contracts_Organizations', victim.organization.id),
        UserId: pointer('_User', attacker.id),
      });
      const reset = await captureRejection(
        cloudRunAs(
          'resetpassword',
          { userId: victimMember.account.id, password: 'Attacker-Passw0rd!' },
          attacker.sessionToken
        )
      );
      const added = await captureRejection(
        cloudRunAs(
          'adduser',
          {
            name: 'Planted',
            email: uniqueEmail('planted'),
            password: 'Attacker-Passw0rd!',
            organization: { objectId: victim.organization.id },
            team: victim.team.id,
            role: 'User',
            tenantId: victim.tenant.id,
          },
          attacker.sessionToken
        )
      );

      await resetAuthState();
      const victimLogin = await captureRejection(
        Parse.User.logIn(victimMember.account.email, PASSWORD)
      );
      expect(reset).not.toBeNull();
      expect(added).not.toBeNull();
      expect(victimLogin).toBeNull();
    });

    it('does not let a member promote its own row and then reset foreign passwords', async () => {
      const victim = await createCaller('contracts_Admin');
      const victimMember = await createTenantMember('contracts_User', victim);
      const attackerScope = await createTenantScope();
      const attacker = await createTenantMember('contracts_User', attackerScope);
      const row = await findFirstByUserId('contracts_Users', attacker.account.id);

      const promotion = await putRow(row, attacker.account.sessionToken, {
        UserRole: 'contracts_Admin',
        TenantId: pointer('partners_Tenant', victim.tenant.id),
        OrganizationId: pointer('contracts_Organizations', victim.organization.id),
      });
      const reset = await captureRejection(
        cloudRunAs(
          'resetpassword',
          { userId: victimMember.account.id, password: 'Attacker-Passw0rd!' },
          attacker.account.sessionToken
        )
      );

      expectRejected(promotion);
      expect(reset).not.toBeNull();
      expect((await reload(row)).get('UserRole')).toBe('contracts_User');
    });
  });

  describe('protected fields', () => {
    const buildForeignTargets = async () => {
      const scope = await createTenantScope();
      const foreignOrganization = await createOrganization(scope.tenant, 'Foreign');
      const foreignTeam = await createTeam(foreignOrganization);
      const stranger = await createPlainUser(uniqueEmail('stranger'));
      return { scope, foreignOrganization, foreignTeam, stranger };
    };

    const protectedChanges = async member => {
      const { scope, foreignOrganization, foreignTeam, stranger } = await buildForeignTargets();
      return {
        UserRole: { UserRole: 'contracts_Admin' },
        TenantId: { TenantId: pointer('partners_Tenant', scope.tenant.id) },
        OrganizationId: {
          OrganizationId: pointer('contracts_Organizations', foreignOrganization.id),
        },
        TeamIds: { TeamIds: [pointer('contracts_Teams', foreignTeam.id)] },
        UserId: { UserId: pointer('_User', stranger.id) },
        CreatedBy: { CreatedBy: pointer('_User', stranger.id) },
        Email: { Email: uniqueEmail('changed') },
        IsLinkedAccount: { IsLinkedAccount: false },
        ACL: { ACL: { '*': { read: true, write: true } } },
        owner: { UserId: pointer('_User', member.account.id), UserRole: 'contracts_Admin' },
      };
    };

    it('rejects every change to an authorization relevant field on the own row', async () => {
      const scope = await createTenantScope();
      const member = await createTenantMember(
        'contracts_User',
        { ...scope, extras: { IsLinkedAccount: true } },
        'guarded'
      );
      const row = await findFirstByUserId('contracts_Users', member.account.id);
      const changes = await protectedChanges(member);

      for (const [field, body] of Object.entries(changes)) {
        const response = await putRow(row, member.account.sessionToken, body);
        expect(response.status).withContext(field).toBeGreaterThanOrEqual(400);
      }

      const stored = await reload(row);
      expect(stored.get('UserRole')).toBe('contracts_User');
      expect(stored.get('IsLinkedAccount')).toBeTrue();
      expect(stored.get('UserId').id).toBe(member.account.id);
      expect(stored.get('Email')).toBe(member.account.email);
    });

    it('accepts a request that resends the current protected values unchanged', async () => {
      const scope = await createTenantScope();
      const member = await createTenantMember('contracts_User', scope);
      const row = await findFirstByUserId('contracts_Users', member.account.id);

      const response = await putRow(row, member.account.sessionToken, {
        UserRole: 'contracts_User',
        TenantId: pointer('partners_Tenant', scope.tenant.id),
        OrganizationId: pointer('contracts_Organizations', scope.organization.id),
        TeamIds: [pointer('contracts_Teams', scope.team.id)],
        UserId: pointer('_User', member.account.id),
        Email: member.account.email,
        JobTitle: 'Resent',
      });

      expect(response.status).toBe(200);
      expect((await reload(row)).get('JobTitle')).toBe('Resent');
    });

    it('lets the owner update its profile and tour fields', async () => {
      const member = await createTenantMember('contracts_User', await createTenantScope());
      const row = await findFirstByUserId('contracts_Users', member.account.id);
      const profile = {
        TourStatus: [{ loginTour: true }],
        JobTitle: 'Engineer',
        Company: 'Acme',
        Language: 'es',
        Name: 'Renamed',
        Phone: '+5804141234567',
      };

      const response = await putRow(row, member.account.sessionToken, profile);

      const stored = await reload(row);
      expect(response.status).toBe(200);
      expect(stored.get('TourStatus')).toEqual(profile.TourStatus);
      expect(stored.get('JobTitle')).toBe('Engineer');
      expect(stored.get('Company')).toBe('Acme');
      expect(stored.get('Language')).toBe('es');
      expect(stored.get('Name')).toBe('Renamed');
      expect(stored.get('Phone')).toBe('+5804141234567');
    });

    it('rejects a profile update that carries no session', async () => {
      const member = await createTenantMember('contracts_User', await createTenantScope());
      const row = await findFirstByUserId('contracts_Users', member.account.id);

      const response = await putRow(row, undefined, { TourStatus: [{ driveTour: true }] });

      expectRejected(response);
      expect((await reload(row)).get('TourStatus')).toBeUndefined();
    });

    it('rejects a profile update of someone else by a user of another tenant', async () => {
      const victim = await createTenantMember('contracts_User', await createTenantScope());
      const stranger = await createCaller('contracts_Admin');
      const row = await findFirstByUserId('contracts_Users', victim.account.id);

      const response = await putRow(row, stranger.account.sessionToken, { JobTitle: 'Hijacked' });

      expectRejected(response);
      expect((await reload(row)).get('JobTitle')).toBeUndefined();
    });

    it('rejects a profile update of a colleague by an ordinary member of the same tenant', async () => {
      const admin = await createCaller('contracts_Admin');
      const actor = await createTenantMember('contracts_User', admin);
      const colleague = await createTenantMember('contracts_User', admin);
      const row = await findFirstByUserId('contracts_Users', colleague.account.id);

      const response = await putRow(row, actor.account.sessionToken, { JobTitle: 'Hijacked' });

      expectRejected(response);
    });

    it('lets an active tenant admin update a profile field of a member of its tenant', async () => {
      const admin = await createCaller('contracts_Admin');
      const member = await createTenantMember('contracts_User', admin);
      const row = await findFirstByUserId('contracts_Users', member.account.id);

      const response = await putRow(row, admin.account.sessionToken, { JobTitle: 'Promoted' });

      expect(response.status).toBe(200);
      expect((await reload(row)).get('JobTitle')).toBe('Promoted');
    });

    it('rejects a profile update of a member by an org admin', async () => {
      const orgAdmin = await createCaller('contracts_OrgAdmin');
      const member = await createTenantMember('contracts_User', orgAdmin);
      const row = await findFirstByUserId('contracts_Users', member.account.id);

      const response = await putRow(row, orgAdmin.account.sessionToken, { JobTitle: 'Nope' });

      expectRejected(response);
    });

    [
      ['disabled', { IsDisabled: true }],
      ['linked', { IsLinkedAccount: true }],
    ].forEach(([label, extras]) => {
      it(`rejects a profile update of a member by a ${label} admin`, async () => {
        const admin = await createCaller('contracts_Admin', {}, extras);
        const member = await createTenantMember('contracts_User', admin);
        const row = await findFirstByUserId('contracts_Users', member.account.id);

        const response = await putRow(row, admin.account.sessionToken, { JobTitle: 'Nope' });

        expectRejected(response);
      });
    });

    it('rejects a profile update of a member of another tenant by an admin', async () => {
      const admin = await createCaller('contracts_Admin');
      const foreign = await createTenantMember('contracts_User', await createTenantScope());
      const row = await findFirstByUserId('contracts_Users', foreign.account.id);

      const response = await putRow(row, admin.account.sessionToken, { JobTitle: 'Nope' });

      expectRejected(response);
    });

    const serverMaintainedChanges = {
      DocumentCount: 9999,
      EmailCount: 9999,
      TemplateCount: 9999,
      usedStorage: 1,
      SignatureType: [{ name: 'forged', enabled: true }],
      IsLTVEnabled: true,
      NotifyOnSignatures: true,
      DeleteOTP: '000000',
      DeleteOTPExpiry: { __type: 'Date', iso: '2999-01-01T00:00:00.000Z' },
      DeleteOTPSentAt: { __type: 'Date', iso: '2999-01-01T00:00:00.000Z' },
      DeleteOTPTries: 0,
    };

    Object.entries(serverMaintainedChanges).forEach(([field, value]) => {
      it(`rejects a change to the server maintained field ${field} even by the owner`, async () => {
        const member = await createTenantMember('contracts_User', await createTenantScope());
        const row = await findFirstByUserId('contracts_Users', member.account.id);

        const response = await putRow(row, member.account.sessionToken, { [field]: value });

        expectRejected(response);
        expect(response.data.error).toContain(field);
      });
    });

    it('rejects a change to a server maintained field even by a tenant admin', async () => {
      const admin = await createCaller('contracts_Admin');
      const member = await createTenantMember('contracts_User', admin);
      const row = await findFirstByUserId('contracts_Users', member.account.id);

      const response = await putRow(row, admin.account.sessionToken, { DocumentCount: 9999 });

      expectRejected(response);
    });

    it('keeps the tour status function working for the owner', async () => {
      const member = await createTenantMember('contracts_User', await createTenantScope());
      const row = await findFirstByUserId('contracts_Users', member.account.id);

      await cloudRunAs(
        'updatetourstatus',
        { TourStatus: [{ loginTour: true }], ExtUserId: row.id },
        member.account.sessionToken
      );

      expect((await reload(row)).get('TourStatus')).toEqual([{ loginTour: true }]);
    });

    it('does not let the tour status function write the row of another user', async () => {
      const victim = await createTenantMember('contracts_User', await createTenantScope());
      const attacker = await createPlainUser(uniqueEmail('tour-attacker'));
      const row = await findFirstByUserId('contracts_Users', victim.account.id);

      const error = await captureRejection(
        cloudRunAs(
          'updatetourstatus',
          { TourStatus: [{ forged: true }], ExtUserId: row.id },
          attacker.sessionToken
        )
      );

      expect(error).not.toBeNull();
      expect((await reload(row)).get('TourStatus')).toBeUndefined();
    });
  });

  describe('IsDisabled', () => {
    const disable = (row, sessionToken) => putRow(row, sessionToken, { IsDisabled: true });

    const memberOf = async (caller, role = 'contracts_User') => {
      const member = await createTenantMember(role, caller);
      return findFirstByUserId('contracts_Users', member.account.id);
    };

    it('lets a tenant admin disable and enable a member of the same tenant', async () => {
      const admin = await createCaller('contracts_Admin');
      const row = await memberOf(admin);

      const disabled = await disable(row, admin.account.sessionToken);
      const disabledFlag = (await reload(row)).get('IsDisabled');
      const enabled = await putRow(row, admin.account.sessionToken, { IsDisabled: false });

      expect(disabled.status).toBe(200);
      expect(disabledFlag).toBeTrue();
      expect(enabled.status).toBe(200);
      expect((await reload(row)).get('IsDisabled')).toBeFalse();
    });

    it('lets an org admin disable a member of its own organization', async () => {
      const orgAdmin = await createCaller('contracts_OrgAdmin');
      const row = await memberOf(orgAdmin);

      const response = await disable(row, orgAdmin.account.sessionToken);

      expect(response.status).toBe(200);
      expect((await reload(row)).get('IsDisabled')).toBeTrue();
    });

    it('rejects an org admin acting on another organization of the same tenant', async () => {
      const orgAdmin = await createCaller('contracts_OrgAdmin');
      const sibling = await createOrganization(orgAdmin.tenant, 'Sibling');
      const siblingTeam = await createTeam(sibling);
      const target = await createTenantMember('contracts_User', {
        tenant: orgAdmin.tenant,
        organization: sibling,
        team: siblingTeam,
      });
      const row = await findFirstByUserId('contracts_Users', target.account.id);

      const response = await disable(row, orgAdmin.account.sessionToken);

      expectRejected(response);
      expect((await reload(row)).get('IsDisabled')).toBeFalsy();
    });

    it('rejects an admin of a foreign tenant', async () => {
      const owner = await createCaller('contracts_Admin');
      const foreignAdmin = await createCaller('contracts_Admin');
      const row = await memberOf(owner);

      const response = await disable(row, foreignAdmin.account.sessionToken);

      expectRejected(response);
      expect((await reload(row)).get('IsDisabled')).toBeFalsy();
    });

    it('rejects an admin disabling its own row', async () => {
      const admin = await createCaller('contracts_Admin');
      const row = await findFirstByUserId('contracts_Users', admin.account.id);

      const response = await disable(row, admin.account.sessionToken);

      expectRejected(response);
      expect((await reload(row)).get('IsDisabled')).toBeFalsy();
    });

    ['contracts_User', 'contracts_Editor'].forEach(role => {
      it(`rejects a ${role} acting on a colleague`, async () => {
        const admin = await createCaller('contracts_Admin');
        const actor = await createTenantMember(role, admin);
        const row = await memberOf(admin);

        const response = await disable(row, actor.account.sessionToken);

        expectRejected(response);
      });
    });

    it('rejects a disabled admin', async () => {
      const admin = await createCaller('contracts_Admin', {}, { IsDisabled: true });
      const row = await memberOf(admin);

      const response = await disable(row, admin.account.sessionToken);

      expectRejected(response);
    });

    it('rejects an admin whose own row is a linked account', async () => {
      const admin = await createCaller('contracts_Admin', {}, { IsLinkedAccount: true });
      const row = await memberOf(admin);

      const response = await disable(row, admin.account.sessionToken);

      expectRejected(response);
    });

    ['contracts_Admin', 'contracts_OrgAdmin'].forEach(targetRole => {
      it(`rejects an org admin disabling a ${targetRole} of its own organization`, async () => {
        const orgAdmin = await createCaller('contracts_OrgAdmin');
        const target = await createTenantMember(targetRole, orgAdmin);
        const row = await findFirstByUserId('contracts_Users', target.account.id);

        const response = await disable(row, orgAdmin.account.sessionToken);

        expectRejected(response);
        expect((await reload(row)).get('IsDisabled')).toBeFalsy();
      });
    });

    it('rejects an org admin that combines the disabled flag with another change', async () => {
      const orgAdmin = await createCaller('contracts_OrgAdmin');
      const row = await memberOf(orgAdmin);

      const response = await putRow(row, orgAdmin.account.sessionToken, {
        IsDisabled: true,
        JobTitle: 'Sneaky',
      });

      expectRejected(response);
      expect((await reload(row)).get('IsDisabled')).toBeFalsy();
    });

    it('lets a tenant admin disable another admin of the tenant', async () => {
      const admin = await createCaller('contracts_Admin');
      const row = await memberOf(admin, 'contracts_Admin');

      const response = await disable(row, admin.account.sessionToken);

      expect(response.status).toBe(200);
    });

    it('ignores a disabled or linked extra row of the caller when an active one exists', async () => {
      const admin = await createCaller('contracts_Admin');
      await createExtUser({
        account: admin.account,
        role: 'contracts_User',
        tenant: admin.tenant,
        extras: { IsDisabled: true },
      });
      const row = await memberOf(admin);

      const response = await disable(row, admin.account.sessionToken);

      expect(response.status).toBe(200);
    });

    it('rejects a caller without any extended user', async () => {
      const admin = await createCaller('contracts_Admin');
      const outsider = await createPlainUser(uniqueEmail('outsider'));
      const row = await memberOf(admin);

      const response = await disable(row, outsider.sessionToken);

      expectRejected(response);
    });

    it('rejects an anonymous request', async () => {
      const admin = await createCaller('contracts_Admin');
      const row = await memberOf(admin);

      const response = await disable(row, undefined);

      expectRejected(response);
    });

    it('lets the Parse SDK toggle the flag with an admin session as the user list does', async () => {
      const admin = await createCaller('contracts_Admin');
      const row = await memberOf(admin);
      const extUser = new Parse.Object('contracts_Users');
      extUser.id = row.id;
      extUser.set('IsDisabled', true);

      await extUser.save(null, { sessionToken: admin.account.sessionToken });

      expect((await reload(row)).get('IsDisabled')).toBeTrue();
    });
  });

  describe('deletion', () => {
    it('rejects deleting an extended user with a user session', async () => {
      const admin = await createCaller('contracts_Admin');
      const target = await createTenantMember('contracts_User', admin);
      const row = await findFirstByUserId('contracts_Users', target.account.id);

      const response = await rest(
        'delete',
        `/classes/contracts_Users/${row.id}`,
        admin.account.sessionToken
      );

      expectRejected(response);
      expect(await reload(row)).toBeDefined();
    });
  });

  describe('server side writers', () => {
    it('keeps addUser working under the production permissions', async () => {
      const admin = await createCaller('contracts_Admin');
      const email = uniqueEmail('server-writer');

      const created = await cloudRunAs(
        'adduser',
        {
          name: 'Server Writer',
          email,
          password: 'Member-Passw0rd!',
          organization: { objectId: admin.organization.id },
          team: admin.team.id,
          role: 'Editor',
          tenantId: admin.tenant.id,
        },
        admin.account.sessionToken
      );

      expect(created.UserRole).toBe('contracts_Editor');
    });

    it('keeps the master key free to write server maintained counters', async () => {
      const member = await createTenantMember('contracts_User', await createTenantScope());
      const row = await findFirstByUserId('contracts_Users', member.account.id);
      row.set('DocumentCount', 7);
      row.set('DeleteOTP', '123456');

      await row.save(null, MASTER);

      const stored = await reload(row);
      expect(stored.get('DocumentCount')).toBe(7);
      expect(stored.get('DeleteOTP')).toBe('123456');
    });

    it('keeps the master key free to write protected fields', async () => {
      const scope = await createTenantScope();
      const account = await createPlainUser(uniqueEmail('master-writer'));
      const row = await createExtUser({
        account,
        role: 'contracts_User',
        tenant: scope.tenant,
        organization: scope.organization,
        team: scope.team,
      });
      row.set('UserRole', 'contracts_Editor');
      row.set('IsLinkedAccount', true);

      await row.save(null, MASTER);

      const stored = await reload(row);
      expect(stored.get('UserRole')).toBe('contracts_Editor');
      expect(stored.get('IsLinkedAccount')).toBeTrue();
    });
  });
});
