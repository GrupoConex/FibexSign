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

const withStoredContact = (placeholder, contactsById) => {
  const contactId = signerPtrIdOf(placeholder) ?? signerObjIdOf(placeholder);
  if (!contactId) return placeholder;
  return {
    ...placeholder,
    signerObjId: contactId,
    signerPtr: toContactPointer(contactId),
    email: contactsById.get(contactId)?.get('Email') ?? '',
  };
};

export const authorizePlaceholders = async ({ userId, placeholders, templateContactIds }) => {
  if (!Array.isArray(placeholders)) return [];
  const ids = placeholders.flatMap(placeholder => [
    signerObjIdOf(placeholder),
    signerPtrIdOf(placeholder),
  ]);
  const contacts = await authorizeContactIds({ userId, ids, templateContactIds });
  const contactsById = new Map(contacts.map(contact => [contact.id, contact]));
  return placeholders.map(placeholder => withStoredContact(placeholder, contactsById));
};
