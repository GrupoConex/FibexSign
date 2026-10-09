import { generateId } from '../../../Utils.js';
import { buildOwnExtUserQuery, findById, toUserPointer } from './accountLookup.js';
import { deleteContactsInBatch, deleteDataFiles, deleteInBatches } from './deleteFileUrl.js';

const MASTER = { useMasterKey: true };
const ADMIN_ROLE = 'contracts_Admin';
const GENERATED_PASSWORD_LENGTH = 16;

export const DELETION_SUCCESS = Object.freeze({
  code: 200,
  message: 'User and all associated data deleted successfully.',
});

const rejection = message => ({ code: 400, message });

const describeError = err => err?.message ?? String(err);

const destroyAll = async objects => {
  if (objects.length > 0) await Parse.Object.destroyAll(objects, MASTER);
};

const destroyAllWhere = async (className, field, pointer) =>
  destroyAll(await new Parse.Query(className).equalTo(field, pointer).findAll(MASTER));

const destroyIfPresent = async (className, objectId) => {
  const found = objectId ? await findById(className, objectId) : undefined;
  if (found) await found.destroy(MASTER);
};

const revokeSessions = userPointer => destroyAllWhere('_Session', 'user', userPointer);

const retireAccountWithContacts = async (userPointer, userId) => {
  const user = await findById('_User', userId);
  if (!user) return;
  user.set('password', generateId(GENERATED_PASSWORD_LENGTH));
  user.set('emailVerified', false);
  user.unset('ProfilePic');
  await user.save(null, MASTER);
  await revokeSessions(userPointer);
};

const removeAccount = async (userPointer, userId) => {
  await revokeSessions(userPointer);
  await destroyIfPresent('_User', userId);
};

const settleLoginAccount = async (userPointer, userId) => {
  const remainingContacts = await new Parse.Query('contracts_Contactbook')
    .equalTo('UserId', userPointer)
    .count(MASTER);
  if (remainingContacts === 0) {
    await removeAccount(userPointer, userId);
    return;
  }
  await retireAccountWithContacts(userPointer, userId);
};

const buildTargetQuery = (userId, actor) => {
  const query = buildOwnExtUserQuery(userId);
  if (actor.tenantPtr) {
    query.equalTo('TenantId', actor.tenantPtr);
    if (actor.isOrgAdmin) query.equalTo('OrganizationId', actor.orgPtr);
  } else if (actor.adminId) {
    query.equalTo('CreatedBy', toUserPointer(actor.adminId));
  }
  return query;
};

const judgeTarget = (target, actor) => {
  if (!target) return rejection(actor.isOrgAdmin ? 'Unauthorized.' : 'User not found.');
  const isTargetAdmin = target.get('UserRole') === ADMIN_ROLE;
  if (actor.isOrgAdmin && isTargetAdmin) return rejection('Unauthorized.');
  if (actor.adminId && isTargetAdmin) {
    return rejection('An error occurred while deleting your account.');
  }
  return null;
};

const tenantOwnerStages = target => {
  const tenantId = target.get('TenantId')?.id;
  const teamStages = (target.get('TeamIds') ?? []).map(team => ({
    prefix: `Failed to delete team with ID ${team.id}`,
    run: () => destroyIfPresent('contracts_Teams', team.id),
  }));
  return [
    {
      prefix: 'Failed to delete contracts_Organizations entry:',
      run: () => destroyIfPresent('contracts_Organizations', target.get('OrganizationId')?.id),
    },
    ...teamStages,
    {
      prefix: 'Failed during partners_Tenant cleanup: ',
      run: () => destroyIfPresent('partners_Tenant', tenantId),
    },
    {
      prefix: 'Failed during partners_TenantCredits cleanup:',
      run: () =>
        tenantId &&
        destroyAllWhere('partners_TenantCredits', 'PartnersTenant', {
          __type: 'Pointer',
          className: 'partners_Tenant',
          objectId: tenantId,
        }),
    },
  ];
};

const buildStages = (target, userPointer, userId) => [
  {
    prefix: 'Failed during contracts_Template cleanup:',
    run: async () => {
      await deleteInBatches('contracts_Document', userPointer);
      await deleteInBatches('contracts_Template', userPointer);
    },
  },
  {
    prefix: 'Failed during contactbook cleanup:',
    run: () => deleteContactsInBatch('contracts_Contactbook', userPointer),
  },
  {
    prefix: 'Failed during contactbook current user cleanup: ',
    run: () => settleLoginAccount(userPointer, userId),
  },
  {
    prefix: 'Failed to delete appToken entries:',
    run: () => destroyAllWhere('appToken', 'UserId', userPointer),
  },
  {
    prefix: 'Failed during partners_DataFiles cleanup:',
    run: () => deleteDataFiles('partners_DataFiles', userPointer),
  },
  ...(target.get('UserRole') === ADMIN_ROLE ? tenantOwnerStages(target) : []),
  {
    prefix: 'Failed during contracts_Signature cleanup:',
    run: () => destroyAllWhere('contracts_Signature', 'UserId', userPointer),
  },
  {
    prefix: 'Failed to delete contracts_Users entry:',
    run: () => target.destroy(MASTER),
  },
];

const runStage = async ({ prefix, run }) => {
  try {
    await run();
    return null;
  } catch (err) {
    console.error(prefix, err);
    return rejection(`${prefix}${describeError(err)}`);
  }
};

const runStages = async stages => {
  for (const stage of stages) {
    const failure = await runStage(stage);
    if (failure) return failure;
  }
  return DELETION_SUCCESS;
};

export async function deleteUser(userId, actor = {}) {
  try {
    const target = await buildTargetQuery(userId, actor).first(MASTER);
    const refusal = judgeTarget(target, actor);
    if (refusal) return refusal;
    return await runStages(buildStages(target, toUserPointer(userId), userId));
  } catch (error) {
    console.error('User deletion process failed:', error);
    return rejection(`User deletion failed: ${describeError(error)}`);
  }
}
