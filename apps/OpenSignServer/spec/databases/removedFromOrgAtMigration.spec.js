import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const migration = require('../../databases/migrations/20261013130000-add_removedfromorgat_field.cjs');

const MASTER = { useMasterKey: true };
const CLASS_NAME = 'contracts_Users';
const FIELD = 'RemovedFromOrgAt';
const ROLLBACK_NOTICE =
  'add_removedfromorgat_field keeps RemovedFromOrgAt on rollback so removed members stay removed';

const fieldsOf = async () => (await new Parse.Schema(CLASS_NAME).get()).fields;

const dropFieldIfPresent = async () => {
  if (!(await fieldsOf())[FIELD]) return;
  const schema = new Parse.Schema(CLASS_NAME);
  schema.deleteField(FIELD);
  await schema.update();
};

const ensureClassExists = async () => {
  const seed = await new Parse.Object(CLASS_NAME).save({ Name: 'schema seed' }, MASTER);
  await seed.destroy(MASTER);
};

describe('RemovedFromOrgAt field migration', () => {
  beforeAll(async () => {
    await ensureClassExists();
  });

  beforeEach(async () => {
    await dropFieldIfPresent();
  });

  afterAll(async () => {
    await migration.up(Parse);
  });

  it('declares RemovedFromOrgAt as a date on contracts_Users', async () => {
    await migration.up(Parse);

    expect((await fieldsOf())[FIELD]).toEqual(jasmine.objectContaining({ type: 'Date' }));
  });

  it('can run again once the field exists', async () => {
    await migration.up(Parse);

    await expectAsync(migration.up(Parse)).toBeResolved();
    expect((await fieldsOf())[FIELD].type).toBe('Date');
  });

  it('keeps the field on rollback and explains why', async () => {
    const warn = spyOn(console, 'warn');
    await migration.up(Parse);

    await migration.down(Parse);

    expect((await fieldsOf())[FIELD].type).toBe('Date');
    expect(warn).toHaveBeenCalledWith(ROLLBACK_NOTICE);
  });
});
