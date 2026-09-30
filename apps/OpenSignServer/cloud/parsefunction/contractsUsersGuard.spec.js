import {
  PROTECTED_CONTRACTS_USERS_FIELDS,
  guardContractsUsersDelete,
  guardContractsUsersSave,
} from './contractsUsersGuard.js';

const pointerTo = (className, objectId) =>
  Parse.Object.fromJSON({ __type: 'Pointer', className, objectId });

const buildRow = (fields = {}, acl = new Parse.ACL(), dirtyKeys = []) => ({
  id: 'row-1',
  get: key => fields[key],
  getACL: () => acl,
  dirtyKeys: () => dirtyKeys,
});

const baseFields = () => ({
  UserId: pointerTo('_User', 'user-1'),
  TenantId: pointerTo('partners_Tenant', 'tenant-1'),
  OrganizationId: pointerTo('contracts_Organizations', 'org-1'),
  TeamIds: [{ __type: 'Pointer', className: 'contracts_Teams', objectId: 'team-1' }],
  UserRole: 'contracts_User',
  CreatedBy: pointerTo('_User', 'creator-1'),
  Email: 'member@example.com',
  IsLinkedAccount: undefined,
  JobTitle: 'Engineer',
});

const OWNER = { id: 'user-1' };

const buildUpdate = (changes = {}, requestOverrides = {}) => ({
  master: false,
  user: OWNER,
  original: buildRow(baseFields()),
  object: buildRow({ ...baseFields(), ...changes }, new Parse.ACL(), Object.keys(changes)),
  ...requestOverrides,
});

const captureRejection = async promise => {
  try {
    await promise;
    return null;
  } catch (error) {
    return error;
  }
};

describe('contractsUsersGuard', () => {
  describe('guardContractsUsersDelete', () => {
    it('refuses deletions that do not use the master key', async () => {
      const error = await captureRejection(guardContractsUsersDelete({ master: false }));

      expect(error.code).toBe(Parse.Error.OPERATION_FORBIDDEN);
    });

    it('allows deletions with the master key', async () => {
      expect(await captureRejection(guardContractsUsersDelete({ master: true }))).toBeNull();
    });
  });

  describe('guardContractsUsersSave', () => {
    it('lists every authorization relevant field as protected', () => {
      expect([...PROTECTED_CONTRACTS_USERS_FIELDS].sort()).toEqual(
        [
          'ACL',
          'CreatedBy',
          'DeleteOTP',
          'DeleteOTPExpiry',
          'DeleteOTPSentAt',
          'DeleteOTPTries',
          'DocumentCount',
          'Email',
          'EmailCount',
          'IsLTVEnabled',
          'IsLinkedAccount',
          'NotifyOnSignatures',
          'OrganizationId',
          'SignatureType',
          'TeamIds',
          'TemplateCount',
          'TenantId',
          'UserId',
          'UserRole',
          'usedStorage',
        ].sort()
      );
    });

    it('allows everything with the master key', async () => {
      const request = buildUpdate({ UserRole: 'contracts_Admin' }, { master: true });

      expect(await captureRejection(guardContractsUsersSave(request))).toBeNull();
    });

    it('refuses the creation of a row without the master key', async () => {
      const request = { master: false, original: undefined, object: buildRow(baseFields()) };

      const error = await captureRejection(guardContractsUsersSave(request));

      expect(error.code).toBe(Parse.Error.OPERATION_FORBIDDEN);
    });

    it('allows the creation of a row with the master key', async () => {
      const request = { master: true, original: undefined, object: buildRow(baseFields()) };

      expect(await captureRejection(guardContractsUsersSave(request))).toBeNull();
    });

    it('allows an update that only touches profile fields', async () => {
      const request = buildUpdate({ JobTitle: 'Manager' });

      expect(await captureRejection(guardContractsUsersSave(request))).toBeNull();
    });

    it('allows an update that resends identical protected values', async () => {
      const request = buildUpdate({
        TenantId: pointerTo('partners_Tenant', 'tenant-1'),
        TeamIds: [{ __type: 'Pointer', className: 'contracts_Teams', objectId: 'team-1' }],
      });

      expect(await captureRejection(guardContractsUsersSave(request))).toBeNull();
    });

    const changesByField = {
      UserId: { UserId: pointerTo('_User', 'someone-else') },
      TenantId: { TenantId: pointerTo('partners_Tenant', 'tenant-2') },
      OrganizationId: { OrganizationId: pointerTo('contracts_Organizations', 'org-2') },
      TeamIds: {
        TeamIds: [{ __type: 'Pointer', className: 'contracts_Teams', objectId: 'team-2' }],
      },
      UserRole: { UserRole: 'contracts_Admin' },
      CreatedBy: { CreatedBy: pointerTo('_User', 'someone-else') },
      Email: { Email: 'other@example.com' },
      IsLinkedAccount: { IsLinkedAccount: false },
      DocumentCount: { DocumentCount: 5 },
      EmailCount: { EmailCount: 5 },
      TemplateCount: { TemplateCount: 5 },
      usedStorage: { usedStorage: 5 },
      SignatureType: { SignatureType: [{ name: 'draw' }] },
      IsLTVEnabled: { IsLTVEnabled: true },
      NotifyOnSignatures: { NotifyOnSignatures: true },
      DeleteOTP: { DeleteOTP: '111111' },
      DeleteOTPExpiry: { DeleteOTPExpiry: new Date(1) },
      DeleteOTPSentAt: { DeleteOTPSentAt: new Date(1) },
      DeleteOTPTries: { DeleteOTPTries: 3 },
    };

    Object.entries(changesByField).forEach(([field, changes]) => {
      it(`refuses an update that changes ${field}`, async () => {
        const error = await captureRejection(guardContractsUsersSave(buildUpdate(changes)));

        expect(error.code).toBe(Parse.Error.OPERATION_FORBIDDEN);
        expect(error.message).toContain(field);
      });
    });

    it('refuses an update that changes the ACL', async () => {
      const publicAcl = new Parse.ACL();
      publicAcl.setPublicReadAccess(true);
      const request = buildUpdate();
      request.object = buildRow({ ...baseFields() }, publicAcl);
      request.original = buildRow({ ...baseFields() }, new Parse.ACL());

      const error = await captureRejection(guardContractsUsersSave(request));

      expect(error.message).toContain('ACL');
    });

    it('allows an update that keeps the ACL', async () => {
      const acl = new Parse.ACL();
      acl.setPublicReadAccess(true);
      const request = buildUpdate();
      request.object = buildRow({ ...baseFields() }, acl);
      request.original = buildRow({ ...baseFields() }, acl);

      expect(await captureRejection(guardContractsUsersSave(request))).toBeNull();
    });

    it('treats a missing protected value and null as the same value', async () => {
      const request = buildUpdate({ IsLinkedAccount: null });

      expect(await captureRejection(guardContractsUsersSave(request))).toBeNull();
    });

    it('refuses any update without an authenticated caller', async () => {
      const error = await captureRejection(
        guardContractsUsersSave(buildUpdate({ JobTitle: 'Manager' }, { user: undefined }))
      );

      expect(error.code).toBe(Parse.Error.OPERATION_FORBIDDEN);
    });

    it('refuses the owner toggling its own disabled flag', async () => {
      const error = await captureRejection(
        guardContractsUsersSave(buildUpdate({ IsDisabled: true }))
      );

      expect(error.message).toContain('IsDisabled');
    });

    it('treats an unset disabled flag and false as the same value', async () => {
      const request = buildUpdate({ IsDisabled: false });

      expect(await captureRejection(guardContractsUsersSave(request))).toBeNull();
    });
  });
});
