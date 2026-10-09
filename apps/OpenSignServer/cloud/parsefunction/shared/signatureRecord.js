import { isTrustedStorageUrl } from './storageUrlPolicy.js';

export const SIGNATURE_CLASS = 'contracts_Signature';

const MASTER = { useMasterKey: true };
const URL_FIELDS = ['ImageURL', 'Initials', 'Stamp'];
const IMAGE_EXTENSION = /\.(png|jpe?g|webp|gif)$/i;
const FIELD_BY_PARAM = {
  signature: 'ImageURL',
  initials: 'Initials',
  stamp: 'Stamp',
  title: 'SignatureName',
};

const requireSessionUser = request => {
  if (!request.user) {
    throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'User is not authenticated.');
  }
  return request.user;
};

const assertClientUserMatches = (clientUserId, user) => {
  if (clientUserId && clientUserId !== user.id) {
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Cannot save signature for this user.');
  }
};

const hasImageExtension = value => IMAGE_EXTENSION.test(new URL(value).pathname);

const isAcceptedImageUrl = value => isTrustedStorageUrl(value) && hasImageExtension(value);

const assertValidFields = fields => {
  Object.entries(fields).forEach(([field, value]) => {
    const isInvalidType = typeof value !== 'string';
    const isInvalidUrl = URL_FIELDS.includes(field) && value !== '' && !isAcceptedImageUrl(value);
    if (isInvalidType || isInvalidUrl) {
      throw new Parse.Error(Parse.Error.VALIDATION_ERROR, `Invalid ${field}.`);
    }
  });
};

const assertOwnsRow = async (id, user) => {
  if (typeof id !== 'string') {
    throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'Invalid id.');
  }
  const row = await new Parse.Query(SIGNATURE_CLASS).select('UserId').get(id, MASTER);
  if (row.get('UserId')?.id !== user.id) {
    throw new Parse.Error(
      Parse.Error.OPERATION_FORBIDDEN,
      'Signature does not belong to the user.'
    );
  }
};

const buildOwnerAcl = user => {
  const acl = new Parse.ACL();
  acl.setReadAccess(user.id, true);
  acl.setWriteAccess(user.id, true);
  return acl;
};

const pickFields = (params, defaultValue) =>
  Object.fromEntries(
    Object.entries(FIELD_BY_PARAM)
      .map(([param, field]) => [field, params[param] || defaultValue])
      .filter(([, value]) => value !== undefined)
  );

export const pickProvidedFields = params => pickFields(params, undefined);

export const pickAllFields = params => pickFields(params, '');

export async function persistSignature(request, fields) {
  const { userId, id } = request.params;
  const user = requireSessionUser(request);
  assertClientUserMatches(userId, user);
  assertValidFields(fields);
  if (id) {
    await assertOwnsRow(id, user);
  }
  const signature = new Parse.Object(SIGNATURE_CLASS);
  if (id) {
    signature.id = id;
  } else {
    signature.set('UserId', { __type: 'Pointer', className: '_User', objectId: user.id });
  }
  signature.set(fields);
  signature.setACL(buildOwnerAcl(user));
  return signature.save(null, MASTER);
}
