import axios from 'axios';
import {
  captureRejection,
  cloudRunAs,
  createPlainUser,
  pointer,
  purgeCreatedAccounts,
  silenceConsole,
} from '../utils/auth-fixtures.js';

const MASTER = { useMasterKey: true };
const CLASS_NAME = 'contracts_Signature';
const OPERATION_FORBIDDEN = 119;
const OBJECT_NOT_FOUND = 101;
const INVALID_VALUE = 142;
const INVALID_SESSION_TOKEN = 209;
const STORAGE_ENV = {
  DO_SPACE: 'vault',
  DO_ENDPOINT: 'ams3.digitaloceanspaces.com',
  DO_BASEURL: 'https://cdn.firma.example',
  DO_REGION: 'ams3',
  DO_ACCESS_KEY_ID: 'key',
  DO_SECRET_ACCESS_KEY: 'secret',
};
const OWN_URL = 'https://cdn.firma.example/owner_sign.png';
const OWN_INITIALS_URL = 'https://cdn.firma.example/owner_initials.png';
const OWN_STAMP_URL = 'https://cdn.firma.example/owner_stamp.png';
const FOREIGN_URL = 'https://attacker.example/stolen-key.png';
const FUNCTION_NAMES = ['savesignature', 'managesign'];
const URL_PARAMS = { signature: 'ImageURL', initials: 'Initials', stamp: 'Stamp' };

const applyEnv = overrides => {
  const saved = Object.fromEntries(Object.keys(overrides).map(key => [key, process.env[key]]));
  Object.assign(process.env, overrides);
  return () =>
    Object.entries(saved).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
};

const seedLegacyRow = async (ownerId, fields = {}) => {
  const row = new Parse.Object(CLASS_NAME);
  row.set('ImageURL', fields.ImageURL ?? OWN_URL);
  row.set('Initials', fields.Initials ?? OWN_INITIALS_URL);
  row.set('SignatureName', fields.SignatureName ?? 'legacy');
  if (ownerId) row.set('UserId', pointer('_User', ownerId));
  return row.save(null, MASTER);
};

const readMetadata = id =>
  new Parse.Query(CLASS_NAME).select('UserId', 'SignatureName', 'ACL').get(id, MASTER);

const readRaw = async id => {
  const rows = await new Parse.Query(CLASS_NAME).equalTo('objectId', id).find(MASTER);
  return rows[0];
};

const countRows = () => new Parse.Query(CLASS_NAME).count(MASTER);

const ownerOnlyAcl = ownerId => ({ [ownerId]: { read: true, write: true } });

describe('signature ownership', () => {
  let restoreEnv;
  let owner;
  let intruder;

  beforeEach(async () => {
    silenceConsole();
    restoreEnv = applyEnv(STORAGE_ENV);
    owner = await createPlainUser();
    intruder = await createPlainUser();
  });

  afterEach(async () => {
    restoreEnv();
    await purgeCreatedAccounts();
  });

  FUNCTION_NAMES.forEach(functionName => {
    const run = (params, account) => cloudRunAs(functionName, params, account?.sessionToken);

    describe(functionName, () => {
      it('rejects an anonymous caller and creates nothing', async () => {
        const before = await countRows();

        const failure = await captureRejection(run({ userId: owner.id, signature: OWN_URL }));

        expect(failure.code).toBe(INVALID_SESSION_TOKEN);
        expect(await countRows()).toBe(before);
      });

      it('creates the row for the session user with a private ACL', async () => {
        const saved = await run({ signature: OWN_URL, title: 'mine' }, owner);

        const row = await readMetadata(saved.id);
        expect(row.get('UserId').id).toBe(owner.id);
        expect(row.getACL().toJSON()).toEqual(ownerOnlyAcl(owner.id));
      });

      it('accepts the user id of the session when the client sends it', async () => {
        const saved = await run({ userId: owner.id, signature: OWN_URL }, owner);

        expect((await readMetadata(saved.id)).get('UserId').id).toBe(owner.id);
      });

      it('refuses a client supplied user id that is not the session user', async () => {
        const before = await countRows();

        const failure = await captureRejection(
          run({ userId: owner.id, signature: OWN_URL }, intruder)
        );

        expect(failure.code).toBe(OPERATION_FORBIDDEN);
        expect(await countRows()).toBe(before);
      });

      it('refuses a user that overwrites the signature of another user', async () => {
        const victimRow = await seedLegacyRow(owner.id, { SignatureName: 'victim' });

        const failure = await captureRejection(
          run({ id: victimRow.id, signature: OWN_URL, title: 'taken over' }, intruder)
        );

        const after = await readMetadata(victimRow.id);
        expect(failure.code).toBe(OPERATION_FORBIDDEN);
        expect(after.get('UserId').id).toBe(owner.id);
        expect(after.get('SignatureName')).toBe('victim');
      });

      it('does not let an intruder claim a row that has no owner', async () => {
        const orphan = await seedLegacyRow(undefined);

        const failure = await captureRejection(
          run({ id: orphan.id, signature: OWN_URL }, intruder)
        );

        expect(failure.code).toBe(OPERATION_FORBIDDEN);
        expect((await readMetadata(orphan.id)).get('UserId')).toBeUndefined();
      });

      it('reports an unknown row id as not found', async () => {
        const failure = await captureRejection(
          run({ id: 'doesNotExist', signature: OWN_URL }, owner)
        );

        expect(failure.code).toBe(OBJECT_NOT_FOUND);
      });

      it('lets the owner update the own row and privatizes a legacy ACL', async () => {
        const row = await seedLegacyRow(owner.id);

        await run({ id: row.id, signature: OWN_URL, title: 'renamed' }, owner);

        const after = await readMetadata(row.id);
        expect(after.get('SignatureName')).toBe('renamed');
        expect(after.get('UserId').id).toBe(owner.id);
        expect(after.getACL().toJSON()).toEqual(ownerOnlyAcl(owner.id));
      });

      it('keeps the row out of reach of anonymous reads', async () => {
        const saved = await run({ signature: OWN_URL }, owner);

        const response = await axios.get(
          `${process.env.SERVER_URL}/classes/${CLASS_NAME}/${saved.id}`,
          {
            headers: {
              'X-Parse-Application-Id': process.env.APP_ID,
              'X-Parse-Javascript-Key': 'test',
            },
            validateStatus: () => true,
          }
        );

        expect([OBJECT_NOT_FOUND, OPERATION_FORBIDDEN]).toContain(response.data.code);
        expect(JSON.stringify(response.data)).not.toContain('owner_sign');
      });

      Object.entries(URL_PARAMS).forEach(([param, field]) => {
        it(`rejects a foreign url in ${field} and saves nothing`, async () => {
          const before = await countRows();

          const failure = await captureRejection(run({ [param]: FOREIGN_URL }, owner));

          expect(failure.code).toBe(INVALID_VALUE);
          expect(await countRows()).toBe(before);
        });

        it(`rejects a foreign url in ${field} on update and keeps the stored value`, async () => {
          const row = await seedLegacyRow(owner.id);

          const failure = await captureRejection(run({ id: row.id, [param]: FOREIGN_URL }, owner));

          expect(failure.code).toBe(INVALID_VALUE);
          expect(JSON.stringify((await readRaw(row.id)).toJSON())).not.toContain('attacker');
        });

        it(`rejects a non string ${field}`, async () => {
          const failure = await captureRejection(run({ [param]: { $ne: null } }, owner));

          expect(failure.code).toBe(INVALID_VALUE);
        });
      });

      Object.entries(URL_PARAMS).forEach(([param, field]) => {
        const rejectedNames = [
          'owner_sign.svg',
          'owner_sign.svg+xml',
          'owner_sign.pdf',
          'owner_sign.html',
          'owner_sign',
          'owner_sign.png.exe',
        ];
        rejectedNames.forEach(name => {
          it(`rejects ${name} as ${field} even on the own storage`, async () => {
            const before = await countRows();

            const failure = await captureRejection(
              run({ [param]: `https://cdn.firma.example/${name}` }, owner)
            );

            expect(failure.code).toBe(INVALID_VALUE);
            expect(await countRows()).toBe(before);
          });
        });

        ['PNG', 'jpg', 'JPEG', 'webp', 'gif'].forEach(extension => {
          it(`accepts .${extension} as ${field} on the own storage`, async () => {
            const url = `https://cdn.firma.example/image.${extension}?X-Amz-Signature=abc`;

            const saved = await run({ [param]: url }, owner);

            expect(saved.id).toBeDefined();
          });
        });
      });

      it('accepts urls of the own storage in every url field', async () => {
        const saved = await run(
          { signature: OWN_URL, initials: OWN_INITIALS_URL, stamp: OWN_STAMP_URL },
          owner
        );

        const row = await readRaw(saved.id);
        expect(row.get('ImageURL')).toContain('owner_sign.png');
        expect(row.get('Initials')).toContain('owner_initials.png');
        expect(row.get('Stamp')).toContain('owner_stamp.png');
      });
    });
  });

  describe('savesignature partial updates', () => {
    it('keeps the fields that are not sent', async () => {
      const row = await seedLegacyRow(owner.id);

      await cloudRunAs('savesignature', { id: row.id, stamp: OWN_STAMP_URL }, owner.sessionToken);

      const after = await readRaw(row.id);
      expect(after.get('Initials')).toContain('owner_initials.png');
      expect(after.get('Stamp')).toContain('owner_stamp.png');
    });
  });

  describe('managesign full updates', () => {
    it('clears the fields that are sent empty', async () => {
      const row = await seedLegacyRow(owner.id);

      await cloudRunAs('managesign', { id: row.id, signature: OWN_URL }, owner.sessionToken);

      const after = await new Parse.Query(CLASS_NAME)
        .select('Initials', 'Stamp', 'SignatureName')
        .get(row.id, MASTER);
      expect(after.get('Initials')).toBe('');
      expect(after.get('Stamp')).toBe('');
      expect(after.get('SignatureName')).toBe('');
    });
  });

  describe('getdefaultsignature', () => {
    it('returns the row of the session user', async () => {
      const row = await seedLegacyRow(owner.id);

      const found = await cloudRunAs(
        'getdefaultsignature',
        { userId: owner.id },
        owner.sessionToken
      );

      expect(found.id).toBe(row.id);
    });

    it('refuses to read the signature of another user', async () => {
      await seedLegacyRow(owner.id);

      const failure = await captureRejection(
        cloudRunAs('getdefaultsignature', { userId: owner.id }, intruder.sessionToken)
      );

      expect(failure).not.toBeNull();
    });

    it('returns the row created through savesignature after it became private', async () => {
      const saved = await cloudRunAs('savesignature', { signature: OWN_URL }, owner.sessionToken);

      const found = await cloudRunAs(
        'getdefaultsignature',
        { userId: owner.id },
        owner.sessionToken
      );

      expect(found.id).toBe(saved.id);
    });
  });
});
