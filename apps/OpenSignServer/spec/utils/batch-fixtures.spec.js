import { createCaller, createPlainUser, pointer, purgeCreatedAccounts } from './auth-fixtures.js';
import {
  contactPlaceholder,
  emailPlaceholder,
  pickedContact,
  sendBatchRaw,
  templateItem,
} from './batch-fixtures.js';
import { seedContact, seedTemplate } from './document-fixtures.js';

const INVALID_SESSION_TOKEN = 209;

describe('batch fixtures', () => {
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

  it('serializes a template like getTemplate with included contacts', async () => {
    const template = await seedTemplate(owner, {
      Signers: [pointer('contracts_Contactbook', contact.id)],
    });

    const item = await templateItem(template);

    expect(item.objectId).toBe(template.id);
    expect(item.Signers[0].__type).toBe('Object');
    expect(item.Signers[0].Email).toBe(signer.email);
    expect(item.ExtUserPtr.objectId).toBe(owner.extUser.id);
  });

  it('serializes a picked contact like getsigners without a type marker', () => {
    const picked = pickedContact(contact);

    expect(picked.__type).toBeUndefined();
    expect(picked.objectId).toBe(contact.id);
    expect(picked.UserId.objectId).toBe(signer.id);
  });

  it('builds contact and email placeholders', () => {
    const picked = pickedContact(contact);

    expect(contactPlaceholder('Signer 1', picked).signerObjId).toBe(contact.id);
    expect(emailPlaceholder('Signer 2', 'x@example.com').signerPtr).toBe('');
  });

  it('calls the batch function anonymously when no account is given', async () => {
    const body = await sendBatchRaw('[]');

    expect(body.code).toBe(INVALID_SESSION_TOKEN);
  });
});
