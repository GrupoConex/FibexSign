import axios from 'axios';
import {
  createCaller,
  createPlainUser,
  purgeCreatedAccounts,
  silenceConsole,
} from './auth-fixtures.js';
import {
  aclOf,
  answerSessionLookupWith,
  canReadRow,
  countRows,
  documentCountOf,
  fileUrl,
  readWriteFor,
  reload,
  routeSessionLookupWithJavascriptKey,
  runFunctionOverRest,
  seedContact,
  seedDocument,
  seedTemplate,
  waitForAcl,
  waitForDocumentCount,
} from './document-fixtures.js';

const MASTER = { useMasterKey: true };

describe('document fixtures', () => {
  let owner;

  beforeEach(async () => {
    silenceConsole();
    owner = await createCaller('contracts_Admin');
  });

  afterEach(async () => {
    await purgeCreatedAccounts();
  });

  it('builds file urls on the test file host', () => {
    expect(fileUrl('a.pdf')).toBe('https://files.test/a.pdf');
  });

  it('maps every user id to read and write access', () => {
    expect(readWriteFor('a', 'b')).toEqual({
      a: { read: true, write: true },
      b: { read: true, write: true },
    });
  });

  it('seeds a document owned by the caller with overridable fields', async () => {
    const doc = await seedDocument(owner, { Name: 'Custom' });

    const stored = await reload('contracts_Document', doc.id);
    expect(stored.get('Name')).toBe('Custom');
    expect(stored.get('CreatedBy').id).toBe(owner.account.id);
    expect(stored.get('ExtUserPtr').id).toBe(owner.extUser.id);
  });

  it('seeds a template owned by the caller', async () => {
    const template = await seedTemplate(owner);

    const stored = await reload('contracts_Template', template.id);
    expect(stored.get('CreatedBy').id).toBe(owner.account.id);
  });

  it('seeds a contact of the owner that points at the signer account', async () => {
    const signer = await createPlainUser();

    const contact = await seedContact(owner, signer);

    expect(contact.get('UserId').objectId).toBe(signer.id);
    expect(await countRows('contracts_Contactbook', 'Email', signer.email)).toBe(1);
  });

  it('reports a missing acl as null and waits until one is assigned', async () => {
    const doc = await seedDocument(owner);
    expect(await aclOf('contracts_Document', doc.id)).toBeNull();

    const stored = await reload('contracts_Document', doc.id);
    stored.setACL(new Parse.ACL({ [owner.account.id]: { read: true, write: true } }));
    await stored.save(null, MASTER);

    expect(await waitForAcl('contracts_Document', doc.id)).toBeTrue();
    expect(await aclOf('contracts_Document', doc.id)).toEqual(readWriteFor(owner.account.id));
  });

  it('tells whether a session can read a row over rest', async () => {
    const doc = await seedDocument(owner);
    const stored = await reload('contracts_Document', doc.id);
    stored.setACL(new Parse.ACL({ [owner.account.id]: { read: true } }));
    await stored.save(null, MASTER);
    const stranger = await createPlainUser();

    expect(await canReadRow(owner.account.sessionToken, 'contracts_Document', doc.id)).toBeTrue();
    expect(await canReadRow(stranger.sessionToken, 'contracts_Document', doc.id)).toBeFalse();
  });

  it('reads the document count of an extended user and waits for a value', async () => {
    expect(await documentCountOf(owner.extUser)).toBe(0);

    owner.extUser.set('DocumentCount', 3);
    await owner.extUser.save(null, MASTER);

    expect(await waitForDocumentCount(owner.extUser, 3)).toBeTrue();
  });

  it('runs a cloud function over rest with custom headers', async () => {
    const body = await runFunctionOverRest('getsigners', {}, { 'X-Parse-Session-Token': 'r:no' });

    expect(body.code).toBe(Parse.Error.INVALID_SESSION_TOKEN);
  });

  it('adds the javascript key to session lookups only', async () => {
    const spy = routeSessionLookupWithJavascriptKey();

    const response = await axios.get(`${process.env.SERVER_URL}/users/me`, {
      headers: {
        'X-Parse-Application-Id': process.env.APP_ID,
        'X-Parse-Session-Token': owner.account.sessionToken,
      },
    });
    const health = await axios.get(`${process.env.SERVER_URL}/health`);

    expect(response.data.objectId).toBe(owner.account.id);
    expect(health.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('answers session lookups with the given responder only', async () => {
    answerSessionLookupWith(async () => ({ data: { objectId: 'fake' } }));

    const response = await axios.get(`${process.env.SERVER_URL}/users/me`);
    const health = await axios.get(`${process.env.SERVER_URL}/health`);

    expect(response.data.objectId).toBe('fake');
    expect(health.status).toBe(200);
  });
});
