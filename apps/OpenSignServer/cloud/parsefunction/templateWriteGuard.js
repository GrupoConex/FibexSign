import { resolveCallerProfile } from './shared/callerProfile.js';
import { authorizeContactPointers } from './shared/contactAuthorization.js';
import { authorizePlaceholders } from './shared/placeholderAuthorization.js';
import { buildPrivateAcl } from './shared/recordAcl.js';
import { isTrustedStorageUrl } from './shared/storageUrlPolicy.js';

const PROTECTED_TEMPLATE_FIELDS = Object.freeze(['CreatedBy', 'ExtUserPtr']);

const isUsableId = id => typeof id === 'string' && id.length > 0;
const pointerId = value => value?.id ?? value?.objectId;
const toPointer = (className, objectId) => ({ __type: 'Pointer', className, objectId });
const asArray = value => (Array.isArray(value) ? value : []);

const toComparable = value => {
  if (Array.isArray(value)) {
    return value.map(toComparable);
  }
  return typeof value?.toPointer === 'function' ? value.toPointer() : value;
};

const readField = (row, field) =>
  field === 'ACL' ? (row?.getACL()?.toJSON() ?? null) : row?.get(field);

export const hasFieldChanged = (request, field) =>
  JSON.stringify(toComparable(readField(request.object, field)) ?? null) !==
  JSON.stringify(toComparable(readField(request.original, field)) ?? null);

export const hasAclChanged = request =>
  JSON.stringify(request.object?.getACL()?.toJSON() ?? null) !==
  JSON.stringify(request.original?.getACL()?.toJSON() ?? null);

const assertTrustedUrl = (url, fieldName = 'Template url') => {
  if (url && !isTrustedStorageUrl(url)) {
    throw new Parse.Error(Parse.Error.INVALID_JSON, `${fieldName} is not a trusted storage url.`);
  }
};

export async function validateTemplateTeams({ profile, teams }) {
  const teamList = asArray(teams);
  if (teamList.length === 0) return;
  const teamIds = [...new Set(teamList.map(pointerId).filter(isUsableId))];
  if (teamIds.length === 0) return;

  const orgId = profile.get('OrganizationId')?.id;
  const tenantId = profile.get('TenantId')?.id;
  if (!orgId && !tenantId) {
    throw new Parse.Error(
      Parse.Error.OPERATION_FORBIDDEN,
      'User has no organization for sharing teams.'
    );
  }

  const query = new Parse.Query('contracts_Teams');
  query.containedIn('objectId', teamIds);
  const foundTeams = await query.find({ useMasterKey: true });
  if (foundTeams.length !== teamIds.length) {
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Some shared teams do not exist.');
  }

  for (const team of foundTeams) {
    const teamOrgId = team.get('OrganizationId')?.id;
    const teamTenantId = team.get('TenantId')?.id;
    const matchOrg = orgId && teamOrgId && orgId === teamOrgId;
    const matchTenant = tenantId && teamTenantId && tenantId === teamTenantId;
    if (!matchOrg && !matchTenant) {
      throw new Parse.Error(
        Parse.Error.OPERATION_FORBIDDEN,
        'Teams must belong to your organization.'
      );
    }
  }
}

const collectExistingTemplateContacts = originalTemplate => {
  return [
    ...asArray(originalTemplate?.get('Signers')).map(pointerId),
    ...asArray(originalTemplate?.get('Bcc')).map(pointerId),
    ...asArray(originalTemplate?.get('Cc')).map(pointerId),
  ].filter(isUsableId);
};

async function handleTemplateCreation(request, callerId) {
  assertTrustedUrl(request.object.get('URL'), 'Template url');

  request.object.set('CreatedBy', toPointer('_User', callerId));

  const requestedProfileId = pointerId(request.object.get('ExtUserPtr'));
  const profile = await resolveCallerProfile(callerId, requestedProfileId);
  request.object.set('ExtUserPtr', toPointer('contracts_Users', profile.id));

  if (request.object.get('SharedWith')) {
    await validateTemplateTeams({ profile, teams: request.object.get('SharedWith') });
  }

  let signerUserIds = [];
  if (request.object.get('Signers')) {
    const signers = await authorizeContactPointers({
      userId: callerId,
      pointers: request.object.get('Signers'),
    });
    request.object.set('Signers', signers.pointers);
    signerUserIds = signers.signerUserIds;
  }

  if (request.object.get('Bcc')) {
    const bcc = await authorizeContactPointers({
      userId: callerId,
      pointers: request.object.get('Bcc'),
    });
    request.object.set('Bcc', bcc.pointers);
  }

  if (request.object.get('Cc')) {
    const cc = await authorizeContactPointers({
      userId: callerId,
      pointers: request.object.get('Cc'),
    });
    request.object.set('Cc', cc.pointers);
  }

  if (request.object.get('Placeholders')) {
    const placeholders = await authorizePlaceholders({
      userId: callerId,
      placeholders: request.object.get('Placeholders'),
    });
    request.object.set('Placeholders', placeholders);
  }

  request.object.setACL(buildPrivateAcl([callerId, ...signerUserIds]));
}

async function handleTemplateUpdate(request, callerId) {
  const ownerId = pointerId(request.original.get('CreatedBy'));
  if (!ownerId || callerId !== ownerId) {
    throw new Parse.Error(
      Parse.Error.OPERATION_FORBIDDEN,
      'Only the template owner may update this template.'
    );
  }

  for (const field of PROTECTED_TEMPLATE_FIELDS) {
    if (hasFieldChanged(request, field)) {
      throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, `${field} cannot be modified.`);
    }
  }

  if (hasFieldChanged(request, 'URL')) {
    assertTrustedUrl(request.object.get('URL'), 'Template url');
  }

  if (hasFieldChanged(request, 'SharedWith')) {
    const profile = await resolveCallerProfile(
      callerId,
      pointerId(request.original.get('ExtUserPtr'))
    );
    await validateTemplateTeams({ profile, teams: request.object.get('SharedWith') });
  }

  const allowedContacts = collectExistingTemplateContacts(request.original);

  let signerUserIds = null;
  if (hasFieldChanged(request, 'Signers')) {
    const signers = await authorizeContactPointers({
      userId: callerId,
      pointers: request.object.get('Signers'),
      templateContactIds: allowedContacts,
    });
    request.object.set('Signers', signers.pointers);
    signerUserIds = signers.signerUserIds;
  }

  if (hasFieldChanged(request, 'Bcc')) {
    const bcc = await authorizeContactPointers({
      userId: callerId,
      pointers: request.object.get('Bcc'),
      templateContactIds: allowedContacts,
    });
    request.object.set('Bcc', bcc.pointers);
  }

  if (hasFieldChanged(request, 'Cc')) {
    const cc = await authorizeContactPointers({
      userId: callerId,
      pointers: request.object.get('Cc'),
      templateContactIds: allowedContacts,
    });
    request.object.set('Cc', cc.pointers);
  }

  if (hasFieldChanged(request, 'Placeholders')) {
    const placeholders = await authorizePlaceholders({
      userId: callerId,
      placeholders: request.object.get('Placeholders'),
      templateContactIds: allowedContacts,
    });
    request.object.set('Placeholders', placeholders);
  }

  if (signerUserIds !== null) {
    request.object.setACL(buildPrivateAcl([callerId, ...signerUserIds]));
  } else if (hasAclChanged(request)) {
    throw new Parse.Error(
      Parse.Error.OPERATION_FORBIDDEN,
      'Template ACL cannot be modified directly.'
    );
  }
}

export async function guardTemplateSave(request) {
  if (request.master) {
    return;
  }

  const callerId = request.user?.id;
  if (!callerId) {
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Authentication is required.');
  }

  if (!request.original) {
    await handleTemplateCreation(request, callerId);
  } else {
    await handleTemplateUpdate(request, callerId);
  }
}

export default guardTemplateSave;
