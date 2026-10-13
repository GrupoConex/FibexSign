import {
  createCaller,
  createPlainUser,
  interceptQuery,
  pointer,
  purgeCreatedAccounts,
} from '../../../spec/utils/auth-fixtures.js';
import { seedContact } from '../../../spec/utils/document-fixtures.js';
import { authorizeContactPointers, loadContacts } from './contactAuthorization.js';

const CONTACT_CLASS = 'contracts_Contactbook';
const OPERATION_FORBIDDEN = 119;

const contactPointer = objectId => pointer(CONTACT_CLASS, objectId);

const captureFailure = async promise => {
  try {
    await promise;
    return null;
  } catch (error) {
    return error;
  }
};

describe('contactAuthorization', () => {
  let owner;

  beforeEach(async () => {
    owner = await createCaller('contracts_Admin');
  });

  afterEach(async () => {
    await purgeCreatedAccounts();
  });

  describe('loadContacts', () => {
    it('returns the stored contacts with their creator and account', async () => {
      const signer = await createPlainUser();
      const contact = await seedContact(owner, signer);

      const [loaded] = await loadContacts([contact.id]);

      expect(loaded.id).toBe(contact.id);
      expect(loaded.get('CreatedBy').id).toBe(owner.account.id);
      expect(loaded.get('UserId').id).toBe(signer.id);
    });

    it('loads a repeated id once and skips unknown ids', async () => {
      const contact = await seedContact(owner, await createPlainUser());

      const loaded = await loadContacts([contact.id, contact.id, 'missingContact']);

      expect(loaded.map(row => row.id)).toEqual([contact.id]);
    });

    it('does not query when there is nothing to load', async () => {
      const lookup = interceptQuery('find', CONTACT_CLASS, run => run());

      expect(await loadContacts([])).toEqual([]);
      expect(await loadContacts(['', null, undefined])).toEqual([]);
      expect(lookup.hits()).toBe(0);
    });
  });

  describe('authorizeContactPointers', () => {
    let author;

    beforeEach(async () => {
      author = await createCaller('contracts_Admin');
    });

    const authorize = (pointers, templateContactIds) =>
      authorizeContactPointers({ userId: owner.account.id, pointers, templateContactIds });

    const expectForbidden = async promise => {
      const failure = await captureFailure(promise);
      expect(failure).toEqual(jasmine.any(Parse.Error));
      expect(failure?.code).toBe(OPERATION_FORBIDDEN);
    };

    it('returns the accounts of the own contacts', async () => {
      const first = await createPlainUser();
      const second = await createPlainUser();
      const contacts = [await seedContact(owner, first), await seedContact(owner, second)];

      const result = await authorize(contacts.map(contact => contactPointer(contact.id)));

      expect(result.signerUserIds.sort()).toEqual([first.id, second.id].sort());
    });

    it('accepts contacts sent as parse objects or included json rows', async () => {
      const signer = await createPlainUser();
      const contact = await seedContact(owner, signer);
      const includedRow = { __type: 'Object', className: CONTACT_CLASS, objectId: contact.id };

      const result = await authorize([
        Parse.Object.fromJSON(contactPointer(contact.id)),
        includedRow,
      ]);

      expect(result.signerUserIds).toEqual([signer.id]);
    });

    it('skips own contacts without an account', async () => {
      const contact = await seedContact(owner, await createPlainUser());
      contact.unset('UserId');
      await contact.save(null, { useMasterKey: true });

      expect(await authorize([contactPointer(contact.id)])).toEqual({
        signerUserIds: [],
        pointers: [contactPointer(contact.id)],
      });
    });

    [undefined, null, 'contact1', {}].forEach(pointers => {
      it(`treats ${JSON.stringify(pointers)} as no contacts without querying`, async () => {
        const lookup = interceptQuery('find', CONTACT_CLASS, run => run());

        expect(await authorize(pointers)).toEqual({ signerUserIds: [], pointers: [] });
        expect(lookup.hits()).toBe(0);
      });
    });

    it('returns bare verified pointers in request order without duplicates', async () => {
      const first = await seedContact(owner, await createPlainUser());
      const second = await seedContact(owner, await createPlainUser());
      const victim = await createPlainUser();
      const forgedRow = {
        __type: 'Object',
        className: CONTACT_CLASS,
        objectId: second.id,
        UserId: pointer('_User', victim.id),
        ExtUserPtr: pointer('contracts_Users', 'victimProfile'),
      };

      const result = await authorize([
        forgedRow,
        Parse.Object.fromJSON(contactPointer(first.id)),
        contactPointer(second.id),
      ]);

      expect(result.pointers).toEqual([contactPointer(second.id), contactPointer(first.id)]);
      expect(result.signerUserIds).not.toContain(victim.id);
    });

    it('rejects a plain object that is neither a pointer nor a parse object', async () => {
      const own = await seedContact(owner, await createPlainUser());
      const victim = await createPlainUser();

      await expectForbidden(
        authorize([
          { className: CONTACT_CLASS, objectId: own.id, UserId: pointer('_User', victim.id) },
        ])
      );
    });

    it('rejects a pointer to another class', async () => {
      await expectForbidden(authorize([pointer('_User', owner.account.id)]));
    });

    it('rejects an entry without an object id', async () => {
      await expectForbidden(authorize([{ className: CONTACT_CLASS, objectId: { $ne: null } }]));
    });

    it('rejects an unknown contact', async () => {
      await expectForbidden(authorize([contactPointer('missingContact')]));
    });

    it('rejects a contact of another user that the template does not name', async () => {
      const foreign = await seedContact(author, await createPlainUser());
      const own = await seedContact(owner, await createPlainUser());

      await expectForbidden(authorize([contactPointer(own.id), contactPointer(foreign.id)], []));
    });

    it('accepts a contact of another user named by the template', async () => {
      const signer = await createPlainUser();
      const foreign = await seedContact(author, signer);

      const result = await authorize([contactPointer(foreign.id)], [foreign.id]);

      expect(result.signerUserIds).toEqual([signer.id]);
    });

    it('loads the template contacts only when a foreign contact is sent', async () => {
      const own = await seedContact(owner, await createPlainUser());
      const foreign = await seedContact(author, await createPlainUser());
      const loadTemplateContacts = jasmine
        .createSpy('templateContacts')
        .and.resolveTo([foreign.id]);

      await authorize([contactPointer(own.id)], loadTemplateContacts);
      expect(loadTemplateContacts).not.toHaveBeenCalled();

      await authorize([contactPointer(own.id), contactPointer(foreign.id)], loadTemplateContacts);
      expect(loadTemplateContacts).toHaveBeenCalledTimes(1);
    });

    it('rejects foreign contacts when the template contacts are unknown', async () => {
      const foreign = await seedContact(author, await createPlainUser());

      await expectForbidden(authorize([contactPointer(foreign.id)]));
    });
  });
});
