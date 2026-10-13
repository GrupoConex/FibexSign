import { createRequire } from 'node:module';
import {
  createPlainUser,
  pointer,
  purgeCreatedAccounts,
  rejectFindFor,
  silenceConsole,
  uniqueEmail,
  waitUntil,
} from '../utils/auth-fixtures.js';

const require = createRequire(import.meta.url);
const migration = require('../../databases/migrations/20261013120000-backfill_document_template_acl.cjs');

const MASTER = { useMasterKey: true };
const DOCUMENT_CLASS = 'contracts_Document';
const TEMPLATE_CLASS = 'contracts_Template';
const CONTACT_CLASS = 'contracts_Contactbook';
const PAGE_OVERFLOW_ROWS = 520;
const ROLLBACK_NOTICE =
  'backfill_document_template_acl is a security fix and is not reverted on rollback';

const readWriteFor = (...userIds) =>
  Object.fromEntries(userIds.map(id => [id, { read: true, write: true }]));

const reload = (className, id) => new Parse.Query(className).get(id, MASTER);

const aclOf = async (className, id) => (await reload(className, id)).getACL()?.toJSON() ?? null;

const seedContact = async (creator, account) =>
  new Parse.Object(CONTACT_CLASS, {
    Name: 'Signer',
    Email: account.email,
    CreatedBy: pointer('_User', creator.id),
    UserId: pointer('_User', account.id),
  }).save(null, MASTER);

const seedContactWithoutAccount = async creator => {
  const contact = await seedContact(creator, await createPlainUser(uniqueEmail('guest')));
  contact.unset('UserId');
  return contact.save(null, MASTER);
};

const seedLegacyRow = async (className, { creator, signers = [], acl, fields = {} } = {}) => {
  const row = new Parse.Object(className, {
    Name: 'Legacy',
    URL: 'https://files.test/legacy.pdf',
    ...fields,
    ...(creator ? { CreatedBy: pointer('_User', creator.id) } : {}),
  });
  await row.save(null, MASTER);
  await waitUntil(async () => (await reload(className, row.id)).has('OriginIp'));
  if (signers.length > 0) row.set('Signers', signers);
  if (acl) row.setACL(acl);
  if (signers.length > 0 || acl) await row.save(null, MASTER);
  return row;
};

const TRIGGER_SETTLE_MS = 750;
const LOGGED_ID_LIMIT = 100;

const settleTriggers = () => new Promise(resolve => setTimeout(resolve, TRIGGER_SETTLE_MS));

const withoutAclAndUpdate = row => {
  const { ACL, updatedAt, ...fields } = row.toJSON();
  return fields;
};

const skippedReportOf = className =>
  console.log.calls
    .allArgs()
    .map(([message]) => String(message))
    .filter(message => message.includes(`${className}:`))
    .pop();

const reportedIdsOf = report => report.split('ids: ').pop().split(',').filter(Boolean);

const publicAcl = () => {
  const acl = new Parse.ACL();
  acl.setPublicReadAccess(true);
  return acl;
};

describe('contracts_Document and contracts_Template ACL backfill migration', () => {
  let creator;

  beforeEach(async () => {
    silenceConsole();
    creator = await createPlainUser(uniqueEmail('creator'));
  });

  afterEach(async () => {
    await purgeCreatedAccounts();
  });

  [DOCUMENT_CLASS, TEMPLATE_CLASS].forEach(className => {
    describe(`for ${className}`, () => {
      it('gives a row without ACL its creator and the signer accounts', async () => {
        const signer = await createPlainUser(uniqueEmail('signer'));
        const contact = await seedContact(creator, signer);
        const row = await seedLegacyRow(className, {
          creator,
          signers: [pointer(CONTACT_CLASS, contact.id)],
        });
        expect(await aclOf(className, row.id)).toBeNull();

        await migration.up(Parse);

        expect(await aclOf(className, row.id)).toEqual(readWriteFor(creator.id, signer.id));
      });

      it('gives a row without signers a private ACL for its creator', async () => {
        const row = await seedLegacyRow(className, { creator });

        await migration.up(Parse);

        expect(await aclOf(className, row.id)).toEqual(readWriteFor(creator.id));
      });

      it('backfills a row with an empty ACL', async () => {
        const row = await seedLegacyRow(className, { creator, acl: new Parse.ACL() });

        await migration.up(Parse);

        expect(await aclOf(className, row.id)).toEqual(readWriteFor(creator.id));
      });

      it('leaves a row that already has an ACL untouched', async () => {
        const row = await seedLegacyRow(className, { creator, acl: publicAcl() });
        const before = (await reload(className, row.id)).updatedAt;

        await migration.up(Parse);

        const after = await reload(className, row.id);
        expect(after.updatedAt.getTime()).toBe(before.getTime());
        expect(after.getACL().toJSON()).toEqual({ '*': { read: true } });
      });

      it('leaves a row without creator untouched and reports it', async () => {
        const row = await seedLegacyRow(className);

        await migration.up(Parse);

        expect(await aclOf(className, row.id)).toBeNull();
        expect(skippedReportOf(className)).toMatch(
          new RegExp(
            `${className}: [1-9][0-9]* rows without CreatedBy left untouched; ids: [A-Za-z0-9]+`
          )
        );
      });

      it('changes only the ACL and keeps it once the save triggers settle', async () => {
        const signer = await createPlainUser(uniqueEmail('signer'));
        const contact = await seedContact(creator, signer);
        await contact.save({ ExtUserPtr: pointer('contracts_Users', 'signerProfile') }, MASTER);
        const row = await seedLegacyRow(className, {
          creator,
          signers: [pointer(CONTACT_CLASS, contact.id)],
          fields: { AutomaticReminders: true, RemindOnceInEvery: 3, TimeToCompleteDays: 9 },
        });
        const before = withoutAclAndUpdate(await reload(className, row.id));

        await migration.up(Parse);
        await settleTriggers();

        const after = await reload(className, row.id);
        expect(withoutAclAndUpdate(after)).toEqual(before);
        expect(after.get('Signers')[0].className).toBe(CONTACT_CLASS);
        expect(after.getACL().toJSON()).toEqual(readWriteFor(creator.id, signer.id));
      });
    });
  });

  it('lists at most 100 ids of the rows left without creator', async () => {
    const orphans = Array.from(
      { length: LOGGED_ID_LIMIT + 1 },
      () => new Parse.Object(TEMPLATE_CLASS, { Name: 'Orphan' })
    );
    await Parse.Object.saveAll(orphans, { ...MASTER, batchSize: 100 });

    await migration.up(Parse);

    const reportedIds = reportedIdsOf(skippedReportOf(TEMPLATE_CLASS));
    expect(reportedIds.length).toBe(LOGGED_ID_LIMIT);
    const reportedRows = await new Parse.Query(TEMPLATE_CLASS)
      .containedIn('objectId', reportedIds)
      .limit(LOGGED_ID_LIMIT)
      .find(MASTER);
    expect(reportedRows.length).toBe(LOGGED_ID_LIMIT);
    reportedRows.forEach(row => expect(row.get('CreatedBy')).withContext(row.id).toBeUndefined());
  }, 60000);

  it('skips contacts without an account and signers of other classes', async () => {
    const guest = await seedContactWithoutAccount(creator);
    const profile = await createPlainUser(uniqueEmail('profile'));
    const row = await seedLegacyRow(DOCUMENT_CLASS, {
      creator,
      signers: [pointer(CONTACT_CLASS, guest.id), pointer('contracts_Users', profile.id)],
    });

    await migration.up(Parse);

    expect(await aclOf(DOCUMENT_CLASS, row.id)).toEqual(readWriteFor(creator.id));
  });

  it('is idempotent', async () => {
    const signer = await createPlainUser(uniqueEmail('signer'));
    const contact = await seedContact(creator, signer);
    const row = await seedLegacyRow(DOCUMENT_CLASS, {
      creator,
      signers: [pointer(CONTACT_CLASS, contact.id)],
    });

    await migration.up(Parse);
    await migration.up(Parse);

    expect(await aclOf(DOCUMENT_CLASS, row.id)).toEqual(readWriteFor(creator.id, signer.id));
  });

  it('processes more rows than a single page', async () => {
    const rows = Array.from(
      { length: PAGE_OVERFLOW_ROWS },
      () => new Parse.Object(TEMPLATE_CLASS, { CreatedBy: pointer('_User', creator.id) })
    );
    await Parse.Object.saveAll(rows, { ...MASTER, batchSize: 100 });

    await migration.up(Parse);

    const unprotectedIds = [];
    await new Parse.Query(TEMPLATE_CLASS)
      .equalTo('CreatedBy', pointer('_User', creator.id))
      .select('ACL')
      .each(row => {
        if (JSON.stringify(row.getACL()?.toJSON()) !== JSON.stringify(readWriteFor(creator.id))) {
          unprotectedIds.push(row.id);
        }
      }, MASTER);
    expect(unprotectedIds).toEqual([]);
  }, 180000);

  it('does not hide unexpected query errors', async () => {
    rejectFindFor(DOCUMENT_CLASS, new Error('database offline'));

    await expectAsync(migration.up(Parse)).toBeRejectedWithError('database offline');
  });

  it('reports that the security fix is not reverted on rollback and keeps the ACL', async () => {
    const warn = spyOn(console, 'warn');
    const row = await seedLegacyRow(DOCUMENT_CLASS, { creator });
    await migration.up(Parse);

    await migration.down(Parse);

    expect(warn).toHaveBeenCalledOnceWith(ROLLBACK_NOTICE);
    expect(await aclOf(DOCUMENT_CLASS, row.id)).toEqual(readWriteFor(creator.id));
  });
});
