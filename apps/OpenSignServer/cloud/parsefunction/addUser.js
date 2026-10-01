const MASTER = { useMasterKey: true };

const toUserPointer = userId => ({ __type: 'Pointer', className: '_User', objectId: userId });

const buildMemberAcl = (callerId, memberId) => {
  const acl = new Parse.ACL();
  [callerId, memberId].forEach(userId => {
    acl.setReadAccess(userId, true);
    acl.setWriteAccess(userId, true);
  });
  return acl;
};

const serializeExtUser = (extUser, accountId, isLinkedAccount) => ({
  ...JSON.parse(JSON.stringify(extUser)),
  UserId: toUserPointer(accountId),
  ...(isLinkedAccount && { linkedExistingAccount: true }),
});

const buildDuplicateAccountError = () =>
  new Parse.Error(Parse.Error.DUPLICATE_VALUE, 'An account with this email already exists.');

const hasTenantMembership = account => {
  const membershipQuery = new Parse.Query('contracts_Users');
  membershipQuery.equalTo('UserId', toUserPointer(account.id));
  return membershipQuery.first(MASTER);
};

async function findOrphanAccount(email) {
  const accountQuery = new Parse.Query(Parse.User);
  accountQuery.equalTo('email', email);
  const account = await accountQuery.first(MASTER);
  if (!account || (await hasTenantMembership(account))) {
    throw buildDuplicateAccountError();
  }
  return account;
}

async function obtainAccount({ name, email, password, phone }) {
  const account = new Parse.User();
  account.set('name', name);
  account.set('username', email);
  account.set('email', email);
  account.set('password', password);
  if (phone) {
    account.set('phone', phone);
  }
  try {
    const createdAccount = await account.save();
    return createdAccount && { account: createdAccount, isLinkedAccount: false };
  } catch (err) {
    if (err.code === Parse.Error.USERNAME_TAKEN) {
      return { account: await findOrphanAccount(email), isLinkedAccount: true };
    }
    throw new Parse.Error(400, err?.message || 'something went wrong');
  }
}

export default async function addUser(request) {
  const { phone, name, password, organization, team, tenantId, timezone, role } = request.params;
  const email = request.params?.email?.toLowerCase()?.replace(/\s/g, '');
  if (!request.user) {
    throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'Invalid session token.');
  }
  const currentUser = { __type: 'Pointer', className: '_User', objectId: request.user.id };
  if (name && email && password && organization && team && role && tenantId) {
    try {
      // Derive the caller's tenant/organization/role from the server-side
      // record rather than trusting client-supplied identifiers. This
      // prevents an authenticated low-privileged user from creating an admin
      // or assigning the new user to an arbitrary tenant/organization/team.
      const callerQuery = new Parse.Query('contracts_Users');
      callerQuery.equalTo('UserId', currentUser);
      callerQuery.notEqualTo('IsDisabled', true);
      const callerExtUser = await callerQuery.first({ useMasterKey: true });
      if (!callerExtUser) {
        throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'User not found.');
      }
      const callerRole = callerExtUser.get('UserRole');
      const isAdmin = callerRole === 'contracts_Admin';
      const isOrgAdmin = callerRole === 'contracts_OrgAdmin';
      if (!isAdmin && !isOrgAdmin) {
        throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Unauthorized.');
      }
      const callerTenantId = callerExtUser.get('TenantId')?.id;
      const callerOrgId = callerExtUser.get('OrganizationId')?.id;
      // Enforce tenant-bound writes for all admins and require org scope for OrgAdmin callers.
      if (!callerTenantId || tenantId !== callerTenantId || (isOrgAdmin && !callerOrgId)) {
        throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Unauthorized.');
      }

      // Only allow creating non-admin roles; never allow elevating to a
      // tenant Admin through this endpoint.
      const allowedRoles = ['OrgAdmin', 'Editor', 'User'];
      if (!allowedRoles.includes(role)) {
        throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Invalid role.');
      }

      // Resolve and authorize the target organization within the caller's tenant.
      const targetOrgId = organization.objectId;
      if (!targetOrgId) {
        throw new Parse.Error(Parse.Error.INVALID_QUERY, 'Please provide all required fields.');
      }
      const orgQuery = new Parse.Query('contracts_Organizations');
      const targetOrg = await orgQuery.get(targetOrgId, { useMasterKey: true });
      if (targetOrg.get('TenantId')?.id !== callerTenantId) {
        throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Unauthorized.');
      }
      // An OrgAdmin may only add users to their own organization.
      if (isOrgAdmin && targetOrgId !== callerOrgId) {
        throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Unauthorized.');
      }

      // Authorize the target team belongs to the target organization.
      const teamQuery = new Parse.Query('contracts_Teams');
      const targetTeam = await teamQuery.get(team, { useMasterKey: true });
      if (targetTeam.get('OrganizationId')?.id !== targetOrgId) {
        throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Unauthorized.');
      }

      const extUser = new Parse.Object('contracts_Users');
      extUser.set('Name', name);
      if (phone) {
        extUser.set('Phone', phone);
      }
      extUser.set('Email', email);
      extUser.set('UserRole', `contracts_${role}`);
      extUser.set('TeamIds', [
        {
          __type: 'Pointer',
          className: 'contracts_Teams',
          objectId: team,
        },
      ]);
      extUser.set('OrganizationId', {
        __type: 'Pointer',
        className: 'contracts_Organizations',
        objectId: targetOrgId,
      });
      if (organization.company) {
        extUser.set('Company', organization.company);
      }

      extUser.set('TenantId', {
        __type: 'Pointer',
        className: 'partners_Tenant',
        objectId: callerTenantId,
      });
      if (timezone) {
        extUser.set('Timezone', timezone);
      }
      const obtainedAccount = await obtainAccount({ name, email, password, phone });
      if (!obtainedAccount) {
        return undefined;
      }
      const { account, isLinkedAccount } = obtainedAccount;
      if (isLinkedAccount) {
        extUser.set('IsLinkedAccount', true);
      }
      extUser.set('CreatedBy', currentUser);
      extUser.set('UserId', toUserPointer(account.id));
      extUser.setACL(buildMemberAcl(request.user.id, account.id));
      const savedExtUser = await extUser.save(null, MASTER);
      return serializeExtUser(savedExtUser, account.id, isLinkedAccount);
    } catch (err) {
      console.log('err', err);
      if (err?.code === Parse.Error.DUPLICATE_VALUE) {
        throw err;
      }
      throw new Parse.Error(400, err?.message || 'something went wrong');
    }
  } else {
    throw new Parse.Error(400, 'Please provide all required fields.');
  }
}
