const CLASS_NAME = 'contracts_Users';

const setCreatePermission = async (Parse, create) => {
  const schema = new Parse.Schema(CLASS_NAME);
  const current = await schema.get();
  schema.setCLP({ ...current.classLevelPermissions, create });
  await schema.update();
};

/**
 *
 * @param {Parse} Parse
 */
exports.up = async Parse => {
  await setCreatePermission(Parse, {});
};

/**
 *
 * @param {Parse} Parse
 */
exports.down = async Parse => {
  await setCreatePermission(Parse, { '*': true });
};
