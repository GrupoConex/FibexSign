const CLASS_NAME = '_User';
const PUBLIC_SIGNUP_REOPENED_WARNING =
  'Rolling back lock_user_create_clp re-opens public signup on _User';

const setCreatePermission = async (Parse, create) => {
  const schema = new Parse.Schema(CLASS_NAME);
  const current = await schema.get();
  schema.setCLP({ ...current.classLevelPermissions, create });
  await schema.update();
};

exports.up = async Parse => {
  await setCreatePermission(Parse, {});
};

exports.down = async Parse => {
  console.warn(PUBLIC_SIGNUP_REOPENED_WARNING);
  await setCreatePermission(Parse, { '*': true });
};
