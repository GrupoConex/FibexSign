import {
  createCaller,
  createPlainUser,
  pointer,
  purgeCreatedAccounts,
  silenceConsole,
} from '../utils/auth-fixtures.js';
import { reload, runFunctionOverRest, seedContact } from '../utils/document-fixtures.js';

const OBJECT_NOT_FOUND = 101;
const EXPOSED_KEYS = [
  '__type',
  'className',
  'objectId',
  'Name',
  'Email',
  'JobTitle',
  'Company',
  'TourStatus',
  'UserId',
];
const INTERNAL_KEYS = [
  'ACL',
  'CreatedBy',
  'TenantId',
  'UserRole',
  'IsDeleted',
  'Phone',
  'ExtUserPtr',
  'createdAt',
  'updatedAt',
];

describe('contact tour cloud functions', () => {
  let owner;
  let signerAccount;
  let contact;

  const seedFullContact = () =>
    seedContact(owner, signerAccount, {
      Phone: '+5800000000',
      JobTitle: 'CTO',
      Company: 'Acme',
      TenantId: pointer('partners_Tenant', owner.tenant.id),
      UserRole: 'contracts_Guest',
      IsDeleted: false,
      ExtUserPtr: pointer('contracts_Users', owner.extUser.id),
      TourStatus: [{ requestSign: false }],
    });

  beforeEach(async () => {
    silenceConsole();
    owner = await createCaller('contracts_Admin');
    signerAccount = await createPlainUser();
    contact = await seedFullContact();
  });

  afterEach(async () => {
    await purgeCreatedAccounts();
  });

  describe('getcontact', () => {
    it('returns only the public contact fields to an anonymous caller', async () => {
      const { result } = await runFunctionOverRest('getcontact', { contactId: contact.id });

      expect(Object.keys(result).filter(key => !EXPOSED_KEYS.includes(key))).toEqual([]);
      INTERNAL_KEYS.forEach(key => expect(result[key]).toBeUndefined());
    });

    it('keeps what the signing page reads', async () => {
      const { result } = await runFunctionOverRest('getcontact', { contactId: contact.id });

      expect(result.objectId).toBe(contact.id);
      expect(result.Name).toBe('Signer');
      expect(result.Email).toBe(signerAccount.email);
      expect(result.JobTitle).toBe('CTO');
      expect(result.Company).toBe('Acme');
      expect(result.TourStatus).toEqual([{ requestSign: false }]);
      expect(result.UserId).toEqual(pointer('_User', signerAccount.id));
    });

    it('rejects an unknown contact', async () => {
      const body = await runFunctionOverRest('getcontact', { contactId: 'missingContact' });

      expect(body.code).toBe(OBJECT_NOT_FOUND);
    });
  });

  describe('updatecontacttour', () => {
    it('marks the request sign tour as seen and returns only the public contact fields', async () => {
      const { result } = await runFunctionOverRest('updatecontacttour', { contactId: contact.id });

      expect(result.TourStatus).toEqual([{ requestSign: true }]);
      expect(Object.keys(result).filter(key => !EXPOSED_KEYS.includes(key))).toEqual([]);
      INTERNAL_KEYS.forEach(key => expect(result[key]).toBeUndefined());
    });

    it('persists the tour status on the stored contact', async () => {
      await runFunctionOverRest('updatecontacttour', { contactId: contact.id });

      const stored = await reload('contracts_Contactbook', contact.id);
      expect(stored.get('TourStatus')).toEqual([{ requestSign: true }]);
      expect(stored.get('Phone')).toBe('+5800000000');
    });

    it('rejects an unknown contact', async () => {
      const body = await runFunctionOverRest('updatecontacttour', { contactId: 'missingContact' });

      expect(body.code).toBe(OBJECT_NOT_FOUND);
    });
  });
});
