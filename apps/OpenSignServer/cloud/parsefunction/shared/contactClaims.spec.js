import {
  captureRejection,
  createCaller,
  createPlainUser,
  interceptQuery,
  pointer,
  purgeCreatedAccounts,
} from '../../../spec/utils/auth-fixtures.js';
import { seedContact, seedRow } from '../../../spec/utils/document-fixtures.js';
import { assertContactClaimsMatch } from './contactClaims.js';

const CONTACT_CLASS = 'contracts_Contactbook';
const OPERATION_FORBIDDEN = 119;

const asClientJson = contact => JSON.parse(JSON.stringify(contact));

describe('contactClaims assertContactClaimsMatch', () => {
  let owner;
  let signer;
  let contact;

  beforeEach(async () => {
    owner = await createCaller('contracts_Admin');
    signer = await createPlainUser();
    contact = await seedContact(owner, signer);
  });

  afterEach(async () => {
    await purgeCreatedAccounts();
  });

  it('accepts contact objects whose claims match the stored contact', async () => {
    const typed = { ...asClientJson(contact), __type: 'Object', className: CONTACT_CLASS };

    await expectAsync(assertContactClaimsMatch([asClientJson(contact), typed])).toBeResolved();
  });

  it('rejects a contact object that claims another account', async () => {
    const forged = { ...asClientJson(contact), UserId: pointer('_User', owner.account.id) };

    const failure = await captureRejection(assertContactClaimsMatch([forged]));

    expect(failure.code).toBe(OPERATION_FORBIDDEN);
  });

  it('rejects a contact object that claims another creator', async () => {
    const forged = { ...asClientJson(contact), CreatedBy: pointer('_User', signer.id) };

    const failure = await captureRejection(assertContactClaimsMatch([forged]));

    expect(failure.code).toBe(OPERATION_FORBIDDEN);
  });

  it('rejects a claim about a contact that does not exist', async () => {
    const ghost = { objectId: 'missingContact', UserId: pointer('_User', signer.id) };

    const failure = await captureRejection(assertContactClaimsMatch([ghost]));

    expect(failure.code).toBe(OPERATION_FORBIDDEN);
  });

  it('rejects a claimed account that the stored contact does not have', async () => {
    const accountless = await seedRow(CONTACT_CLASS, {
      Name: 'No account',
      Email: 'no-account@example.com',
      CreatedBy: pointer('_User', owner.account.id),
    });
    const claimed = { objectId: accountless.id, UserId: pointer('_User', signer.id) };

    const failure = await captureRejection(assertContactClaimsMatch([claimed]));

    expect(failure.code).toBe(OPERATION_FORBIDDEN);
  });

  it('does not query when no reference carries claims', async () => {
    const lookup = interceptQuery('find', CONTACT_CLASS, run => run());

    await assertContactClaimsMatch([pointer(CONTACT_CLASS, contact.id), { objectId: contact.id }]);
    await assertContactClaimsMatch([]);

    expect(lookup.hits()).toBe(0);
  });
});
