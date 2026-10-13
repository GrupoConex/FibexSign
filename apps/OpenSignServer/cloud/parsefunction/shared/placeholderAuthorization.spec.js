import {
  createCaller,
  createPlainUser,
  interceptQuery,
  pointer,
  purgeCreatedAccounts,
} from '../../../spec/utils/auth-fixtures.js';
import { seedContact } from '../../../spec/utils/document-fixtures.js';
import { authorizePlaceholders } from './placeholderAuthorization.js';

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

describe('authorizePlaceholders', () => {
  let owner;
  let author;

  beforeEach(async () => {
    owner = await createCaller('contracts_Admin');
    author = await createCaller('contracts_Admin');
  });

  afterEach(async () => {
    await purgeCreatedAccounts();
  });

  const authorize = (placeholders, templateContactIds) =>
    authorizePlaceholders({ userId: owner.account.id, placeholders, templateContactIds });

  const expectForbidden = async promise => {
    const failure = await captureFailure(promise);
    expect(failure).toEqual(jasmine.any(Parse.Error));
    expect(failure?.code).toBe(OPERATION_FORBIDDEN);
  };

  it('replaces the signer of an own contact with a bare pointer and keeps the rest', async () => {
    const contact = await seedContact(owner, await createPlainUser());
    const victim = await createPlainUser();
    const placeholder = {
      Id: 'role1',
      Role: 'Role 1',
      signerObjId: contact.id,
      signerPtr: {
        __type: 'Object',
        className: CONTACT_CLASS,
        objectId: contact.id,
        UserId: pointer('_User', victim.id),
      },
      placeHolder: [{ pageNumber: 1, pos: [] }],
    };

    const [authorized] = await authorize([placeholder]);

    expect(authorized).toEqual({
      ...placeholder,
      signerPtr: contactPointer(contact.id),
      email: contact.get('Email'),
    });
  });

  it('takes the signer id and email of a contact placeholder from the stored contact', async () => {
    const contact = await seedContact(owner, await createPlainUser());
    const other = await seedContact(owner, await createPlainUser());

    const [authorized] = await authorize([
      { signerObjId: other.id, signerPtr: contactPointer(contact.id), email: 'attacker@x.com' },
    ]);

    expect(authorized).toEqual({
      signerObjId: contact.id,
      signerPtr: contactPointer(contact.id),
      email: contact.get('Email'),
    });
  });

  it('links a placeholder named only by its signer id to the stored contact', async () => {
    const contact = await seedContact(owner, await createPlainUser());

    const [authorized] = await authorize([{ signerObjId: contact.id, email: 'attacker@x.com' }]);

    expect(authorized).toEqual({
      signerObjId: contact.id,
      signerPtr: contactPointer(contact.id),
      email: contact.get('Email'),
    });
  });

  it('keeps placeholders without a signer untouched', async () => {
    const placeholders = [
      { Id: 'role1', Role: 'Role 1', signerPtr: {}, signerObjId: '' },
      { Id: 'role2', Role: 'prefill', placeHolder: [] },
    ];

    expect(await authorize(placeholders)).toEqual(placeholders);
  });

  it('accepts a contact of another user named by the template', async () => {
    const foreign = await seedContact(author, await createPlainUser());

    const [authorized] = await authorize(
      [{ signerObjId: foreign.id, signerPtr: contactPointer(foreign.id) }],
      [foreign.id]
    );

    expect(authorized.signerPtr).toEqual(contactPointer(foreign.id));
  });

  it('rejects a foreign contact referenced by signerObjId', async () => {
    const foreign = await seedContact(author, await createPlainUser());

    await expectForbidden(authorize([{ signerObjId: foreign.id, signerPtr: {} }], []));
  });

  it('rejects a foreign contact referenced by signerPtr', async () => {
    const foreign = await seedContact(author, await createPlainUser());

    await expectForbidden(authorize([{ signerPtr: contactPointer(foreign.id) }]));
  });

  it('rejects a signer pointer to another class', async () => {
    await expectForbidden(authorize([{ signerPtr: pointer('_User', owner.account.id) }]));
  });

  it('rejects a signer given as a plain object without a parse type', async () => {
    const contact = await seedContact(owner, await createPlainUser());

    await expectForbidden(
      authorize([{ signerPtr: { className: CONTACT_CLASS, objectId: contact.id } }])
    );
  });

  [{ $ne: null }, 42].forEach(signerObjId => {
    it(`rejects the signer id ${JSON.stringify(signerObjId)}`, async () => {
      await expectForbidden(authorize([{ signerObjId }]));
    });
  });

  it('rejects an unknown contact', async () => {
    await expectForbidden(authorize([{ signerObjId: 'missingContact' }]));
  });

  [undefined, null, 'none', {}].forEach(placeholders => {
    it(`treats ${JSON.stringify(placeholders)} as no placeholders without querying`, async () => {
      const lookup = interceptQuery('find', CONTACT_CLASS, run => run());

      expect(await authorize(placeholders)).toEqual([]);
      expect(lookup.hits()).toBe(0);
    });
  });

  it('does not mutate the received placeholders', async () => {
    const contact = await seedContact(owner, await createPlainUser());
    const placeholder = Object.freeze({
      signerObjId: contact.id,
      signerPtr: Object.freeze({
        __type: 'Object',
        className: CONTACT_CLASS,
        objectId: contact.id,
      }),
    });

    await authorize(Object.freeze([placeholder]));

    expect(placeholder.signerPtr.__type).toBe('Object');
  });
});
