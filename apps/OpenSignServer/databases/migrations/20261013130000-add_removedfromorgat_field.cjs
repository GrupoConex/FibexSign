const CLASS_NAME = 'contracts_Users';
const FIELD = 'RemovedFromOrgAt';
const ROLLBACK_NOTICE =
  'add_removedfromorgat_field keeps RemovedFromOrgAt on rollback so removed members stay removed';

const hasField = async Parse => {
  const { fields } = await new Parse.Schema(CLASS_NAME).get();
  return Boolean(fields?.[FIELD]);
};

exports.up = async Parse => {
  if (await hasField(Parse)) return;
  const schema = new Parse.Schema(CLASS_NAME);
  schema.addDate(FIELD);
  await schema.update();
};

exports.down = async () => {
  console.warn(ROLLBACK_NOTICE);
};
