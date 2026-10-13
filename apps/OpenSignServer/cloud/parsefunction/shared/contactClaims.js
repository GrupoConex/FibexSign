import { contactsForbidden, loadContacts } from './contactAuthorization.js';

const CLAIM_FIELDS = ['UserId', 'CreatedBy'];

const claimedIdOf = claim => claim?.objectId ?? claim?.id;

const hasClaims = reference =>
  typeof reference?.objectId === 'string' &&
  CLAIM_FIELDS.some(field => reference[field] !== undefined && reference[field] !== null);

const matchesStored = (reference, contact) =>
  Boolean(contact) &&
  CLAIM_FIELDS.every(
    field =>
      reference[field] === undefined ||
      reference[field] === null ||
      claimedIdOf(reference[field]) === contact.get(field)?.id
  );

export const assertContactClaimsMatch = async references => {
  const claimed = (references ?? []).filter(hasClaims);
  if (claimed.length === 0) return;
  const contacts = await loadContacts(claimed.map(reference => reference.objectId));
  const byId = new Map(contacts.map(contact => [contact.id, contact]));
  if (!claimed.every(reference => matchesStored(reference, byId.get(reference.objectId)))) {
    throw contactsForbidden();
  }
};
