const CLASS_NAMES = ['contracts_Document', 'contracts_Template'];
const CONTACT_CLASS = 'contracts_Contactbook';
const ROLLBACK_NOTICE =
  'backfill_document_template_acl is a security fix and is not reverted on rollback';
const MASTER = { useMasterKey: true };
const PAGE_SIZE = 500;
const LOGGED_ID_LIMIT = 100;

const isUsableId = id => typeof id === 'string' && id.length > 0;

const hasNoAcl = row => Object.keys(row.getACL()?.toJSON() ?? {}).length === 0;

const creatorIdOf = row => row.get('CreatedBy')?.id;

const signerContactIds = row =>
  (row.get('Signers') ?? [])
    .filter(signer => signer?.className === CONTACT_CLASS && isUsableId(signer.id))
    .map(signer => signer.id);

const buildAcl = (Parse, userIds) =>
  [...new Set(userIds.filter(isUsableId))].reduce((acl, userId) => {
    acl.setReadAccess(userId, true);
    acl.setWriteAccess(userId, true);
    return acl;
  }, new Parse.ACL());

const loadContactAccounts = async (Parse, rows) => {
  const contactIds = [...new Set(rows.flatMap(signerContactIds))];
  if (contactIds.length === 0) return new Map();
  const contacts = await new Parse.Query(CONTACT_CLASS)
    .containedIn('objectId', contactIds)
    .select('UserId')
    .limit(contactIds.length)
    .find(MASTER);
  return new Map(contacts.map(contact => [contact.id, contact.get('UserId')?.id]));
};

const fetchPage = (Parse, className) => lastObjectId => {
  const query = new Parse.Query(className)
    .select('CreatedBy', 'Signers', 'ACL')
    .ascending('objectId')
    .limit(PAGE_SIZE);
  if (lastObjectId) {
    query.greaterThan('objectId', lastObjectId);
  }
  return query.find(MASTER);
};

const protectPage = async (Parse, rows) => {
  const pending = rows.filter(hasNoAcl);
  const owned = pending.filter(row => isUsableId(creatorIdOf(row)));
  const accountsByContact = await loadContactAccounts(Parse, owned);
  const protectedRows = owned.map(row => {
    const signerIds = signerContactIds(row).map(contactId => accountsByContact.get(contactId));
    row.setACL(buildAcl(Parse, [creatorIdOf(row), ...signerIds]));
    return row;
  });
  await Parse.Object.saveAll(protectedRows, MASTER);
  return pending.filter(row => !isUsableId(creatorIdOf(row))).map(row => row.id);
};

const backfillClass = async (Parse, className) => {
  const loadPage = fetchPage(Parse, className);
  let skippedCount = 0;
  let reportedIds = [];
  let rows = await loadPage();
  while (rows.length > 0) {
    const skippedIds = await protectPage(Parse, rows);
    skippedCount += skippedIds.length;
    reportedIds = [...reportedIds, ...skippedIds].slice(0, LOGGED_ID_LIMIT);
    rows = await loadPage(rows[rows.length - 1].id);
  }
  console.log(
    `backfill_document_template_acl ${className}: ${skippedCount} rows without CreatedBy left untouched; ids: ${reportedIds.join(',')}`
  );
};

exports.up = async Parse => {
  for (const className of CLASS_NAMES) {
    await backfillClass(Parse, className);
  }
};

exports.down = async () => {
  console.warn(ROLLBACK_NOTICE);
};
