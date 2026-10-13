const CONTACT_CLASS = 'contracts_Contactbook';
const MASTER = { useMasterKey: true };
const REFERENCE_TYPES = ['Pointer', 'Object'];

const isUsableId = id => typeof id === 'string' && id.length > 0;

const uniqueIds = ids => [...new Set((ids ?? []).filter(isUsableId))];

const isContactReference = value =>
  (value instanceof Parse.Object || REFERENCE_TYPES.includes(value?.__type)) &&
  value.className === CONTACT_CLASS;

export const contactsForbidden = () =>
  new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Not allowed to use these contacts');

export const toContactPointer = objectId => ({
  __type: 'Pointer',
  className: CONTACT_CLASS,
  objectId,
});

export const contactIdOf = value => {
  if (!isContactReference(value)) return undefined;
  const id = value.id ?? value.objectId;
  return isUsableId(id) ? id : undefined;
};

export const loadContacts = async ids => {
  const contactIds = uniqueIds(ids);
  if (contactIds.length === 0) return [];
  return new Parse.Query(CONTACT_CLASS)
    .containedIn('objectId', contactIds)
    .select('CreatedBy', 'UserId')
    .limit(contactIds.length)
    .find(MASTER);
};

const resolveTemplateContactIds = async templateContactIds => {
  const ids =
    typeof templateContactIds === 'function' ? await templateContactIds() : templateContactIds;
  return new Set(Array.isArray(ids) ? ids : []);
};

const assertForeignContactsAllowed = async (userId, contacts, templateContactIds) => {
  const foreignIds = contacts
    .filter(contact => contact.get('CreatedBy')?.id !== userId)
    .map(contact => contact.id);
  if (foreignIds.length === 0) return;
  const allowedIds = await resolveTemplateContactIds(templateContactIds);
  if (!foreignIds.every(id => allowedIds.has(id))) throw contactsForbidden();
};

export const authorizeContactIds = async ({ userId, ids, templateContactIds }) => {
  const contactIds = uniqueIds(ids);
  if (contactIds.length === 0) return [];
  const contacts = await loadContacts(contactIds);
  if (contacts.length !== contactIds.length) throw contactsForbidden();
  await assertForeignContactsAllowed(userId, contacts, templateContactIds);
  return contacts;
};

const requireContactId = value => {
  const id = contactIdOf(value);
  if (!id) throw contactsForbidden();
  return id;
};

export const authorizeContactPointers = async ({ userId, pointers, templateContactIds }) => {
  const requested = Array.isArray(pointers) ? pointers : [];
  const ids = uniqueIds(requested.map(requireContactId));
  const contacts = await authorizeContactIds({ userId, ids, templateContactIds });
  return {
    signerUserIds: uniqueIds(contacts.map(contact => contact.get('UserId')?.id)),
    pointers: ids.map(toContactPointer),
  };
};
