export const OBJECT_METADATA = ['__type', 'className', 'objectId'];
const SIGNER_FIELDS = ['Name', 'Email', 'JobTitle', 'Company'];
const CONTACT_FIELDS = [...SIGNER_FIELDS, 'TourStatus'];
const OWNER_SIGNER_FIELDS = [...SIGNER_FIELDS, 'Phone'];
const COPY_RECIPIENT_FIELDS = ['Name', 'Email', 'Phone'];

export const pick = (source, keys) =>
  Object.fromEntries(
    keys.filter(key => source?.[key] !== undefined).map(key => [key, source[key]])
  );

export const toPointer = (reference, className = reference?.className) =>
  reference?.objectId ? { __type: 'Pointer', className, objectId: reference.objectId } : reference;

export const isRecord = value => value !== null && typeof value === 'object';

const projectFieldsWith = fields => record =>
  isRecord(record) ? pick(record, [...OBJECT_METADATA, ...fields]) : record;

const projectContactWith = fields => contact =>
  isRecord(contact)
    ? {
        ...projectFieldsWith(fields)(contact),
        ...(contact.UserId === undefined ? {} : { UserId: toPointer(contact.UserId, '_User') }),
      }
    : contact;

export const projectContact = projectContactWith(CONTACT_FIELDS);

export const projectSigner = projectContactWith(SIGNER_FIELDS);

export const projectOwnerSigner = projectContactWith(OWNER_SIGNER_FIELDS);

export const projectCopyRecipient = projectFieldsWith(COPY_RECIPIENT_FIELDS);
