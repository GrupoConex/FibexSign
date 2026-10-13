import { resolveCallerProfile } from './shared/callerProfile.js';
import { authorizeContactPointers } from './shared/contactAuthorization.js';
import { authorizePlaceholders } from './shared/placeholderAuthorization.js';
import { buildPrivateAcl } from './shared/recordAcl.js';
import { isTrustedStorageUrl } from './shared/storageUrlPolicy.js';
import { findAccessibleTemplate } from './shared/documentDraft.js';
import { templateContactIds } from './shared/templateAccess.js';

const PROTECTED_DOCUMENT_FIELDS = Object.freeze([
  'CreatedBy',
  'ExtUserPtr',
  'IsCompleted',
  'AuditTrail',
  'DocumentHash',
  'OriginIp',
]);

const FORBIDDEN_ON_CREATE = Object.freeze([
  'IsCompleted',
  'AuditTrail',
  'DocumentHash',
  'OriginIp',
]);

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

const assertTrustedUrl = (url, fieldName = 'Document url') => {
  if (url && !isTrustedStorageUrl(url)) {
    throw new Parse.Error(Parse.Error.INVALID_JSON, `${fieldName} is not a trusted storage url.`);
  }
};

const collectAllowedContactIds = async (userId, originalDoc, newDoc) => {
  const existingContacts = [
    ...asArray(originalDoc?.get('Signers')).map(pointerId),
    ...asArray(originalDoc?.get('Bcc')).map(pointerId),
    ...asArray(originalDoc?.get('Cc')).map(pointerId),
  ].filter(isUsableId);

  const templateRef = originalDoc?.get('TemplateId') || newDoc?.get('TemplateId');
  const templateId = pointerId(templateRef);
  let templateContacts = [];
  if (templateId) {
    const template = await findAccessibleTemplate(userId, templateId);
    if (template) {
      templateContacts = templateContactIds(template);
    }
  }

  return [...new Set([...existingContacts, ...templateContacts])];
};

async function handleDocumentCreation(request, callerId) {
  for (const field of FORBIDDEN_ON_CREATE) {
    const value = request.object.get(field);
    if (value !== undefined && value !== null) {
      if (field === 'IsCompleted' && value !== true) continue;
      throw new Parse.Error(
        Parse.Error.OPERATION_FORBIDDEN,
        `Cannot set ${field} on document creation.`
      );
    }
  }

  assertTrustedUrl(request.object.get('URL'), 'Document url');
  assertTrustedUrl(request.object.get('SignedUrl'), 'Document signed url');

  request.object.set('CreatedBy', toPointer('_User', callerId));

  const requestedProfileId = pointerId(request.object.get('ExtUserPtr'));
  const profile = await resolveCallerProfile(callerId, requestedProfileId);
  request.object.set('ExtUserPtr', toPointer('contracts_Users', profile.id));

  const allowedContactIds = await collectAllowedContactIds(callerId, null, request.object);

  let signerUserIds = [];
  if (request.object.get('Signers')) {
    const signers = await authorizeContactPointers({
      userId: callerId,
      pointers: request.object.get('Signers'),
      templateContactIds: allowedContactIds,
    });
    request.object.set('Signers', signers.pointers);
    signerUserIds = signers.signerUserIds;
  }

  if (request.object.get('Bcc')) {
    const bcc = await authorizeContactPointers({
      userId: callerId,
      pointers: request.object.get('Bcc'),
      templateContactIds: allowedContactIds,
    });
    request.object.set('Bcc', bcc.pointers);
  }

  if (request.object.get('Cc')) {
    const cc = await authorizeContactPointers({
      userId: callerId,
      pointers: request.object.get('Cc'),
      templateContactIds: allowedContactIds,
    });
    request.object.set('Cc', cc.pointers);
  }

  if (request.object.get('Placeholders')) {
    const placeholders = await authorizePlaceholders({
      userId: callerId,
      placeholders: request.object.get('Placeholders'),
      templateContactIds: allowedContactIds,
    });
    request.object.set('Placeholders', placeholders);
  }

  request.object.setACL(buildPrivateAcl([callerId, ...signerUserIds]));
}

async function handleDocumentUpdate(request, callerId) {
  const ownerId = pointerId(request.original.get('CreatedBy'));
  const isOwner = Boolean(ownerId && callerId === ownerId);

  if (!isOwner) {
    const dirtyKeys = request.object.dirtyKeys ? request.object.dirtyKeys() : [];
    const changedNonArchive = dirtyKeys.filter(
      key => key !== 'IsArchive' && hasFieldChanged(request, key)
    );
    if (changedNonArchive.length > 0) {
      throw new Parse.Error(
        Parse.Error.OPERATION_FORBIDDEN,
        'Non-owners are only allowed to modify IsArchive.'
      );
    }
    if (hasAclChanged(request)) {
      throw new Parse.Error(
        Parse.Error.OPERATION_FORBIDDEN,
        'Non-owners cannot modify document ACL.'
      );
    }
    return;
  }

  for (const field of PROTECTED_DOCUMENT_FIELDS) {
    if (hasFieldChanged(request, field)) {
      throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, `${field} cannot be modified.`);
    }
  }

  if (hasFieldChanged(request, 'URL')) {
    assertTrustedUrl(request.object.get('URL'), 'Document url');
  }
  if (hasFieldChanged(request, 'SignedUrl')) {
    assertTrustedUrl(request.object.get('SignedUrl'), 'Document signed url');
  }

  const allowedContactIds = await collectAllowedContactIds(
    callerId,
    request.original,
    request.object
  );

  let signerUserIds = null;
  if (hasFieldChanged(request, 'Signers')) {
    const signers = await authorizeContactPointers({
      userId: callerId,
      pointers: request.object.get('Signers'),
      templateContactIds: allowedContactIds,
    });
    request.object.set('Signers', signers.pointers);
    signerUserIds = signers.signerUserIds;
  }

  if (hasFieldChanged(request, 'Bcc')) {
    const bcc = await authorizeContactPointers({
      userId: callerId,
      pointers: request.object.get('Bcc'),
      templateContactIds: allowedContactIds,
    });
    request.object.set('Bcc', bcc.pointers);
  }

  if (hasFieldChanged(request, 'Cc')) {
    const cc = await authorizeContactPointers({
      userId: callerId,
      pointers: request.object.get('Cc'),
      templateContactIds: allowedContactIds,
    });
    request.object.set('Cc', cc.pointers);
  }

  if (hasFieldChanged(request, 'Placeholders')) {
    const placeholders = await authorizePlaceholders({
      userId: callerId,
      placeholders: request.object.get('Placeholders'),
      templateContactIds: allowedContactIds,
    });
    request.object.set('Placeholders', placeholders);
  }

  if (signerUserIds !== null) {
    request.object.setACL(buildPrivateAcl([callerId, ...signerUserIds]));
  } else if (hasAclChanged(request)) {
    throw new Parse.Error(
      Parse.Error.OPERATION_FORBIDDEN,
      'Document ACL cannot be modified directly.'
    );
  }
}

export async function guardDocumentSave(request) {
  if (request.master) {
    return;
  }

  const callerId = request.user?.id;
  if (!callerId) {
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Authentication is required.');
  }

  if (!request.original) {
    await handleDocumentCreation(request, callerId);
  } else {
    await handleDocumentUpdate(request, callerId);
  }
}

export default guardDocumentSave;
