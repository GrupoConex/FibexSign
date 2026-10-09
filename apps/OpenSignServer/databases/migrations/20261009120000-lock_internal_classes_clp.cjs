const CLASS_NAMES = ['defaultdata_Otp', 'Migration', '_Role'];
const OPERATIONS = ['get', 'find', 'count', 'create', 'update', 'delete', 'addField'];
const MASTER_KEY_ONLY = Object.fromEntries(OPERATIONS.map(operation => [operation, {}]));
const PUBLIC_ACCESS = Object.fromEntries(OPERATIONS.map(operation => [operation, { '*': true }]));
const PUBLIC_ACCESS_REOPENED_WARNING =
  'Rolling back lock_internal_classes_clp re-opens public access to internal classes';

const createWithPermissions = async (Parse, className, permissions) => {
  const schema = new Parse.Schema(className);
  schema.setCLP(permissions);
  await schema.save();
};

const applyPermissions = async (Parse, className, permissions, createIfMissing) => {
  const schema = new Parse.Schema(className);
  let current;
  try {
    current = await schema.get();
  } catch (error) {
    if (error.code !== Parse.Error.INVALID_CLASS_NAME) {
      throw error;
    }
    if (createIfMissing) {
      await createWithPermissions(Parse, className, permissions);
    }
    return;
  }
  schema.setCLP({ ...current.classLevelPermissions, ...permissions });
  await schema.update();
};

const applyToAllClasses = async (Parse, permissions, createIfMissing) => {
  for (const className of CLASS_NAMES) {
    await applyPermissions(Parse, className, permissions, createIfMissing);
  }
};

exports.up = async Parse => {
  await applyToAllClasses(Parse, MASTER_KEY_ONLY, true);
};

exports.down = async Parse => {
  console.warn(PUBLIC_ACCESS_REOPENED_WARNING);
  await applyToAllClasses(Parse, PUBLIC_ACCESS, false);
};
