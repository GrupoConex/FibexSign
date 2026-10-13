import {
  authorizeContactIds,
  contactIdOf,
  contactsForbidden,
  toContactPointer,
} from './contactAuthorization.js';

const isUsableId = id => typeof id === 'string' && id.length > 0;

const isEmptyPlainObject = value =>
  Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).length === 0;

const isEmptyReference = value =>
  value === undefined ||
  value === null ||
  value === '' ||
  (typeof value === 'object' && isEmptyPlainObject(value));

const signerObjIdOf = placeholder => {
  const value = placeholder?.signerObjId;
  if (isEmptyReference(value)) return undefined;
  if (!isUsableId(value)) throw contactsForbidden();
  return value;
};

const signerPtrIdOf = placeholder => {
  const value = placeholder?.signerPtr;
  if (isEmptyReference(value)) return undefined;
  const id = contactIdOf(value);
  if (!id) throw contactsForbidden();
  return id;
};

const withVerifiedSignerPointer = placeholder => {
  const signerPtrId = signerPtrIdOf(placeholder);
  return signerPtrId ? { ...placeholder, signerPtr: toContactPointer(signerPtrId) } : placeholder;
};

export const authorizePlaceholders = async ({ userId, placeholders, templateContactIds }) => {
  if (!Array.isArray(placeholders)) return [];
  const ids = placeholders.flatMap(placeholder => [
    signerObjIdOf(placeholder),
    signerPtrIdOf(placeholder),
  ]);
  await authorizeContactIds({ userId, ids, templateContactIds });
  return placeholders.map(withVerifiedSignerPointer);
};
