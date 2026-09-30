const MASTER = { useMasterKey: true };
const DISABLED_FLAG = 'IsDisabled';
const PRIVILEGED_ROLES = Object.freeze(['contracts_Admin', 'contracts_OrgAdmin']);

export const PROTECTED_CONTRACTS_USERS_FIELDS = Object.freeze([
  'UserId',
  'TenantId',
  'OrganizationId',
  'UserRole',
  'TeamIds',
  'IsLinkedAccount',
  'CreatedBy',
  'Email',
  'ACL',
  'DocumentCount',
  'EmailCount',
  'TemplateCount',
  'usedStorage',
  'SignatureType',
  'IsLTVEnabled',
  'NotifyOnSignatures',
  'DeleteOTP',
  'DeleteOTPExpiry',
  'DeleteOTPSentAt',
  'DeleteOTPTries',
]);

const buildForbiddenError = message => new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, message);

const toComparable = value => {
  if (Array.isArray(value)) {
    return value.map(toComparable);
  }
  return typeof value?.toPointer === 'function' ? value.toPointer() : value;
};

const readField = (row, field) => (field === 'ACL' ? row.getACL() : row.get(field));

const hasFieldChanged = (request, field) =>
  JSON.stringify(toComparable(readField(request.object, field)) ?? null) !==
  JSON.stringify(toComparable(readField(request.original, field)) ?? null);

const hasDisabledFlagChanged = request =>
  Boolean(request.object.get(DISABLED_FLAG)) !== Boolean(request.original.get(DISABLED_FLAG));

const changesOnlyDisabledFlag = request =>
  request.object.dirtyKeys().every(key => key === DISABLED_FLAG);

const isSameId = (first, second) => Boolean(first) && first === second;

async function findActiveCallerRow(callerId) {
  const query = new Parse.Query('contracts_Users');
  query.equalTo('UserId', { __type: 'Pointer', className: '_User', objectId: callerId });
  query.notEqualTo(DISABLED_FLAG, true);
  query.notEqualTo('IsLinkedAccount', true);
  return query.first(MASTER);
}

const isTenantAdminOf = (callerRow, target) =>
  callerRow.get('UserRole') === 'contracts_Admin' &&
  isSameId(callerRow.get('TenantId')?.id, target.get('TenantId')?.id);

const isOrgAdminOfOrdinaryMember = (callerRow, target) =>
  callerRow.get('UserRole') === 'contracts_OrgAdmin' &&
  isSameId(callerRow.get('OrganizationId')?.id, target.get('OrganizationId')?.id) &&
  !PRIVILEGED_ROLES.includes(target.get('UserRole'));

const mayManageAsOrgAdmin = (request, callerRow) =>
  hasDisabledFlagChanged(request) &&
  changesOnlyDisabledFlag(request) &&
  isOrgAdminOfOrdinaryMember(callerRow, request.original);

async function assertCallerMayUpdate(request) {
  const callerId = request.user?.id;
  if (!callerId) {
    throw buildForbiddenError('Authentication is required to update this record.');
  }
  const isOwner = isSameId(callerId, request.original.get('UserId')?.id);
  if (isOwner && hasDisabledFlagChanged(request)) {
    throw buildForbiddenError(`${DISABLED_FLAG} cannot be modified.`);
  }
  if (isOwner) {
    return;
  }
  const callerRow = await findActiveCallerRow(callerId);
  const isAllowed =
    callerRow &&
    (isTenantAdminOf(callerRow, request.original) || mayManageAsOrgAdmin(request, callerRow));
  if (!isAllowed) {
    throw buildForbiddenError('You are not allowed to update this record.');
  }
}

export async function guardContractsUsersSave(request) {
  if (request.master) {
    return;
  }
  if (!request.original) {
    throw buildForbiddenError('Creating contracts_Users records is not allowed.');
  }
  const changedField = PROTECTED_CONTRACTS_USERS_FIELDS.find(field =>
    hasFieldChanged(request, field)
  );
  if (changedField) {
    throw buildForbiddenError(`${changedField} cannot be modified.`);
  }
  await assertCallerMayUpdate(request);
}

export async function guardContractsUsersDelete(request) {
  if (!request.master) {
    throw buildForbiddenError('Deleting contracts_Users records is not allowed.');
  }
}
