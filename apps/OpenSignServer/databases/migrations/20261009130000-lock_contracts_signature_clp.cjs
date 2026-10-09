const CLASS_NAME = 'contracts_Signature';
const OPERATIONS = ['get', 'find', 'count', 'create', 'update', 'delete', 'addField'];
const MASTER_KEY_ONLY = Object.fromEntries(OPERATIONS.map(operation => [operation, {}]));
const ROLLBACK_NOTICE =
  'lock_contracts_signature_clp is a security fix and is not reverted on rollback';
const MASTER = { useMasterKey: true };
const PAGE_SIZE = 500;

const createWithPermissions = async (Parse, permissions) => {
  const schema = new Parse.Schema(CLASS_NAME);
  schema.setCLP(permissions);
  await schema.save();
};

const applyPermissions = async (Parse, permissions, createIfMissing) => {
  const schema = new Parse.Schema(CLASS_NAME);
  let current;
  try {
    current = await schema.get();
  } catch (error) {
    if (error.code !== Parse.Error.INVALID_CLASS_NAME) {
      throw error;
    }
    if (createIfMissing) {
      await createWithPermissions(Parse, permissions);
    }
    return;
  }
  schema.setCLP({ ...current.classLevelPermissions, ...permissions });
  await schema.update();
};

const buildAcl = ownerId => {
  const acl = new Parse.ACL();
  if (ownerId) {
    acl.setReadAccess(ownerId, true);
    acl.setWriteAccess(ownerId, true);
  }
  return acl;
};

const isExpectedAcl = (acl, ownerId) => {
  if (!acl) return false;
  const entries = Object.entries(acl.toJSON());
  const expectedEntries = ownerId ? 1 : 0;
  return (
    entries.length === expectedEntries &&
    entries.every(([id, access]) => id === ownerId && access.read === true && access.write === true)
  );
};

const needsBackfill = row => !isExpectedAcl(row.getACL(), row.get('UserId')?.id);

const fetchPage = Parse => lastObjectId => {
  const query = new Parse.Query(CLASS_NAME)
    .select('UserId', 'ACL')
    .ascending('objectId')
    .limit(PAGE_SIZE);
  if (lastObjectId) {
    query.greaterThan('objectId', lastObjectId);
  }
  return query.find(MASTER);
};

const protectRows = async (Parse, rows) => {
  const protectedRows = rows.filter(needsBackfill).map(row => {
    row.setACL(buildAcl(row.get('UserId')?.id));
    return row;
  });
  await Parse.Object.saveAll(protectedRows, MASTER);
};

const backfillOwnerAcls = async Parse => {
  const loadPage = fetchPage(Parse);
  let rows = await loadPage();
  while (rows.length > 0) {
    await protectRows(Parse, rows);
    rows = await loadPage(rows[rows.length - 1].id);
  }
};

exports.up = async Parse => {
  await applyPermissions(Parse, MASTER_KEY_ONLY, true);
  await backfillOwnerAcls(Parse);
};

exports.down = async () => {
  console.warn(ROLLBACK_NOTICE);
};
