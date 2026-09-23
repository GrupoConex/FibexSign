import { declineMailer } from '../cloud/parsefunction/declinedocument.js';

async function signupUser(email, password) {
  const user = new Parse.User();
  user.set('username', email);
  user.set('email', email);
  user.set('password', password);
  const savedUser = await user.signUp();
  await Parse.User.logOut();

  const tenant = new Parse.Object('partners_Tenant');
  tenant.set('UserId', { __type: 'Pointer', className: '_User', objectId: savedUser.id });
  tenant.set('TenantName', `Tenant-${Date.now()}`);
  tenant.set('EmailAddress', email);
  tenant.set('IsActive', true);
  tenant.set('CreatedBy', { __type: 'Pointer', className: '_User', objectId: savedUser.id });
  const savedTenant = await tenant.save(null, { useMasterKey: true });

  const contractsUser = new Parse.Object('contracts_Users');
  contractsUser.set('UserId', { __type: 'Pointer', className: '_User', objectId: savedUser.id });
  contractsUser.set('Email', email);
  contractsUser.set('Name', 'Test User');
  contractsUser.set('UserRole', 'contracts_Admin');
  contractsUser.set('TenantId', {
    __type: 'Pointer',
    className: 'partners_Tenant',
    objectId: savedTenant.id,
  });
  await contractsUser.save(null, { useMasterKey: true });

  return { email, password, objectId: savedUser.id };
}

async function loginAndGetSessionToken(email, password) {
  const loggedIn = await Parse.User.logIn(email, password);
  return loggedIn.getSessionToken();
}

describe('getUserDetails unauthenticated enumeration is closed', () => {
  Parse.User.enableUnsafeCurrentUser();

  it('returns only an existence flag, never an objectId, for an existing email with no session', async () => {
    const email = `enum-exists-${Date.now()}@example.com`;
    await signupUser(email, 'Str0ngPassw0rd!');

    const result = await Parse.Cloud.run('getUserDetails', { email });

    expect(result).toEqual({ exists: true });
    expect(Object.prototype.hasOwnProperty.call(result, 'objectId')).toBe(false);
  });

  it('returns exists:false for a made-up email with no session', async () => {
    const email = `enum-missing-${Date.now()}@example.com`;

    const result = await Parse.Cloud.run('getUserDetails', { email });

    expect(result).toEqual({ exists: false });
  });
});

describe('getUserId is no longer a public Cloud Function', () => {
  Parse.User.enableUnsafeCurrentUser();

  it('rejects Parse.Cloud.run("getUserId", ...) instead of returning an objectId', async () => {
    const email = `getuserid-oracle-${Date.now()}@example.com`;
    await signupUser(email, 'Str0ngPassw0rd!');

    let thrown = null;
    let result = null;
    try {
      result = await Parse.Cloud.run('getUserId', { email });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).not.toBeNull();
    expect(result).toBeNull();
  });
});

describe('getTenant IDOR is closed', () => {
  Parse.User.enableUnsafeCurrentUser();

  it('ignores a client-supplied userId belonging to another user and returns the caller own tenant', async () => {
    const emailA = `tenant-a-${Date.now()}@example.com`;
    const emailB = `tenant-b-${Date.now()}@example.com`;
    const userA = await signupUser(emailA, 'Str0ngPassw0rd!A');
    const userB = await signupUser(emailB, 'Str0ngPassw0rd!B');

    const sessionTokenA = await loginAndGetSessionToken(emailA, 'Str0ngPassw0rd!A');

    const ownIdResult = await Parse.Cloud.run(
      'gettenant',
      { userId: userA.objectId },
      { sessionToken: sessionTokenA }
    );
    const otherIdResult = await Parse.Cloud.run(
      'gettenant',
      { userId: userB.objectId },
      { sessionToken: sessionTokenA }
    );

    const ownIdEmail = ownIdResult?.get
      ? ownIdResult.get('EmailAddress')
      : ownIdResult?.EmailAddress;
    const otherIdEmail = otherIdResult?.get
      ? otherIdResult.get('EmailAddress')
      : otherIdResult?.EmailAddress;

    expect(ownIdEmail).toBe(emailA);
    expect(otherIdEmail).toBe(emailA);
    expect(otherIdEmail).not.toBe(emailB);
  });

  it('rejects an unauthenticated caller that supplies a userId', async () => {
    let thrown = null;
    try {
      await Parse.Cloud.run('gettenant', { userId: 'someObjectId' });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).not.toBeNull();
    expect(thrown.code).toBe(Parse.Error.INVALID_SESSION_TOKEN);
  });
});

describe('declinedocument IDOR is closed', () => {
  Parse.User.enableUnsafeCurrentUser();

  async function createDeclinableDocument(creatorId, isEnableOTP = true) {
    const doc = new Parse.Object('contracts_Document');
    doc.set('Name', `Decline Target ${Date.now()}`);
    doc.set('IsCompleted', false);
    doc.set('IsArchive', false);
    doc.set('IsEnableOTP', isEnableOTP);
    doc.set('CreatedBy', { __type: 'Pointer', className: '_User', objectId: creatorId });
    doc.set('Signers', []);
    doc.set('Placeholders', []);
    const saved = await doc.save(null, { useMasterKey: true });
    return saved.id;
  }

  it('attributes the decline to the authenticated caller, not a spoofed userId param', async () => {
    const emailA = `decline-a-${Date.now()}@example.com`;
    const emailB = `decline-b-${Date.now()}@example.com`;
    const userA = await signupUser(emailA, 'Str0ngPassw0rd!A');
    const userB = await signupUser(emailB, 'Str0ngPassw0rd!B');

    const docId = await createDeclinableDocument(userA.objectId);
    const sessionTokenA = await loginAndGetSessionToken(emailA, 'Str0ngPassw0rd!A');

    const result = await Parse.Cloud.run(
      'declinedoc',
      { docId, reason: 'testing idor', userId: userB.objectId },
      { sessionToken: sessionTokenA }
    );

    expect(result).toBe('document declined');

    const query = new Parse.Query('contracts_Document');
    const saved = await query.get(docId, { useMasterKey: true });
    const declineBy = saved.get('DeclineBy');

    expect(declineBy.id).toBe(userA.objectId);
    expect(declineBy.id).not.toBe(userB.objectId);
  });

  it('still allows the legitimate self-case (own id passed as userId)', async () => {
    const email = `decline-self-${Date.now()}@example.com`;
    const user = await signupUser(email, 'Str0ngPassw0rd!');
    const docId = await createDeclinableDocument(user.objectId);
    const sessionToken = await loginAndGetSessionToken(email, 'Str0ngPassw0rd!');

    const result = await Parse.Cloud.run(
      'declinedoc',
      { docId, reason: 'self decline', userId: user.objectId },
      { sessionToken }
    );

    expect(result).toBe('document declined');

    const query = new Parse.Query('contracts_Document');
    const saved = await query.get(docId, { useMasterKey: true });
    expect(saved.get('DeclineBy').id).toBe(user.objectId);
  });

  it('rejects an unauthenticated caller supplying an unrelated docId and an unrelated userId', async () => {
    const emailCreator = `decline-owner-${Date.now()}@example.com`;
    const emailStranger = `decline-stranger-${Date.now()}@example.com`;
    const creator = await signupUser(emailCreator, 'Str0ngPassw0rd!Owner');
    const stranger = await signupUser(emailStranger, 'Str0ngPassw0rd!Stranger');

    const docId = await createDeclinableDocument(creator.objectId, false);

    let thrown = null;
    try {
      await Parse.Cloud.run('declinedoc', {
        docId,
        reason: 'idor attempt',
        userId: stranger.objectId,
      });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).not.toBeNull();
    expect(thrown.code).toBe(Parse.Error.OPERATION_FORBIDDEN);

    const query = new Parse.Query('contracts_Document');
    const saved = await query.get(docId, { useMasterKey: true });
    expect(saved.get('IsDeclined')).not.toBe(true);
  });

  it('rejects an authenticated caller with a real session who is not a signer or creator of the specific document', async () => {
    const emailCreator = `decline-owner2-${Date.now()}@example.com`;
    const emailOutsider = `decline-outsider-${Date.now()}@example.com`;
    const creator = await signupUser(emailCreator, 'Str0ngPassw0rd!Owner2');
    const outsider = await signupUser(emailOutsider, 'Str0ngPassw0rd!Outsider');

    const docId = await createDeclinableDocument(creator.objectId, true);
    const sessionTokenOutsider = await loginAndGetSessionToken(
      emailOutsider,
      'Str0ngPassw0rd!Outsider'
    );

    let thrown = null;
    try {
      await Parse.Cloud.run(
        'declinedoc',
        { docId, reason: 'idor attempt authenticated', userId: outsider.objectId },
        { sessionToken: sessionTokenOutsider }
      );
    } catch (err) {
      thrown = err;
    }

    expect(thrown).not.toBeNull();
    expect(thrown.code).toBe(Parse.Error.OPERATION_FORBIDDEN);

    const query = new Parse.Query('contracts_Document');
    const saved = await query.get(docId, { useMasterKey: true });
    expect(saved.get('IsDeclined')).not.toBe(true);
  });
});

describe('declinedocument is idempotent against repeated calls on an already-declined document', () => {
  Parse.User.enableUnsafeCurrentUser();

  it('does not re-mutate the document or re-send the decline notification email on a second decline call by the same signer', async () => {
    const emailCreator = `decline-idem-owner-${Date.now()}@example.com`;
    const emailSigner = `decline-idem-signer-${Date.now()}@example.com`;
    const creator = await signupUser(emailCreator, 'Str0ngPassw0rd!Owner');
    const signer = await signupUser(emailSigner, 'Str0ngPassw0rd!Signer');

    const doc = new Parse.Object('contracts_Document');
    doc.set('Name', `Decline Idempotency Target ${Date.now()}`);
    doc.set('IsCompleted', false);
    doc.set('IsArchive', false);
    doc.set('IsEnableOTP', false);
    doc.set('CreatedBy', { __type: 'Pointer', className: '_User', objectId: creator.objectId });
    doc.set('Signers', [
      { UserId: { __type: 'Pointer', className: '_User', objectId: signer.objectId } },
    ]);
    doc.set('Placeholders', []);
    const savedDoc = await doc.save(null, { useMasterKey: true });
    const docId = savedDoc.id;

    const sessionTokenSigner = await loginAndGetSessionToken(emailSigner, 'Str0ngPassw0rd!Signer');

    spyOn(declineMailer, 'send');

    const firstResult = await Parse.Cloud.run(
      'declinedoc',
      { docId, reason: 'first decline' },
      { sessionToken: sessionTokenSigner }
    );

    expect(firstResult).toBe('document declined');
    expect(declineMailer.send).toHaveBeenCalledTimes(1);

    const secondResult = await Parse.Cloud.run(
      'declinedoc',
      { docId, reason: 'second decline attempt' },
      { sessionToken: sessionTokenSigner }
    );

    expect(secondResult).not.toBe('document declined');
    expect(declineMailer.send).toHaveBeenCalledTimes(1);

    const query = new Parse.Query('contracts_Document');
    const saved = await query.get(docId, { useMasterKey: true });
    expect(saved.get('DeclineReason')).toBe('first decline');
  });
});
