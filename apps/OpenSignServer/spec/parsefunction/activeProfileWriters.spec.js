import {
  captureRejection,
  cloudRunAs,
  createCaller,
  createExtUser,
  createPlainUser,
  createTenantScope,
  resetAuthState,
  silenceConsole,
  uniqueEmail,
} from '../utils/auth-fixtures.js';

const MASTER = { useMasterKey: true };
const SIGNATURE_TYPES = [
  { name: 'draw', enabled: true },
  { name: 'typed', enabled: true },
];

const createRemovedLinkedRow = async account => {
  const scope = await createTenantScope();
  return createExtUser({
    account,
    role: 'contracts_User',
    ...scope,
    extras: { IsLinkedAccount: true, IsDisabled: true, RemovedFromOrgAt: new Date() },
  });
};

const createGuestWithRemovedRowFirst = async () => {
  const guest = await createPlainUser(uniqueEmail('guest-writer'));
  const removed = await createRemovedLinkedRow(guest);
  const home = await createTenantScope();
  const homeProfile = await createExtUser({ account: guest, role: 'contracts_Admin', ...home });
  return { guest, removed, homeProfile };
};

const reload = row => new Parse.Query('contracts_Users').get(row.id, MASTER);

const storeTenantSecrets = tenant =>
  tenant.save({ FileAdapters: 'storage-key', PfxFile: { name: 'cert.pfx' } }, MASTER);

describe('profile writers for a guest removed from another organization', () => {
  let scenario;

  beforeEach(async () => {
    silenceConsole();
    await resetAuthState();
    scenario = await createGuestWithRemovedRowFirst();
  });

  afterEach(async () => {
    await resetAuthState();
  });

  const runAsGuest = (name, params) => cloudRunAs(name, params, scenario.guest.sessionToken);

  it('stores the date widget preference on the home profile', async () => {
    await runAsGuest('setwidgetpreferences', { dateWidget: { format: 'dd-MM-yyyy' } });

    expect((await reload(scenario.homeProfile)).get('WidgetPreferences')[0].format).toBe(
      'dd-MM-yyyy'
    );
    expect((await reload(scenario.removed)).get('WidgetPreferences')).toBeUndefined();
  });

  it('stores general preferences on the home profile', async () => {
    await runAsGuest('updatepreferences', { Timezone: 'America/Caracas' });

    expect((await reload(scenario.homeProfile)).get('Timezone')).toBe('America/Caracas');
    expect((await reload(scenario.removed)).get('Timezone')).toBeUndefined();
  });

  it('stores signature types on the home profile', async () => {
    await runAsGuest('updatesignaturetype', { SignatureType: SIGNATURE_TYPES });

    expect((await reload(scenario.homeProfile)).get('SignatureType')).toEqual(SIGNATURE_TYPES);
    expect((await reload(scenario.removed)).get('SignatureType')).toBeUndefined();
  });

  it('stores email templates on the home profile', async () => {
    await runAsGuest('updateemailtemplates', {
      tenantId: 'ignored',
      details: { RequestSubject: 'Home subject' },
    });

    expect((await reload(scenario.homeProfile)).get('RequestSubject')).toBe('Home subject');
    expect((await reload(scenario.removed)).get('RequestSubject')).toBeUndefined();
  });

  it('finds no profile for file uploads of a guest whose only profile was removed', async () => {
    const orphan = await createPlainUser(uniqueEmail('guest-only-removed'));
    await createRemovedLinkedRow(orphan);

    const failure = await captureRejection(
      cloudRunAs('savefile', { fileBase64: 'AAAA', fileName: 'note.txt' }, orphan.sessionToken)
    );

    expect(failure.code).toBe(Parse.Error.OBJECT_NOT_FOUND);
    expect(failure.message).toBe('User not found.');
  });

  it('refuses preference writes to a guest whose only profile was removed', async () => {
    const orphan = await createPlainUser(uniqueEmail('guest-only-removed'));
    await createRemovedLinkedRow(orphan);

    const failure = await captureRejection(
      cloudRunAs('updatepreferences', { Timezone: 'UTC' }, orphan.sessionToken)
    );

    expect(failure.code).toBe(Parse.Error.OPERATION_FORBIDDEN);
  });
});

describe('updateemailtemplates response', () => {
  beforeEach(async () => {
    silenceConsole();
    await resetAuthState();
  });

  afterEach(async () => {
    await resetAuthState();
  });

  it('returns the saved mail templates without any tenant secret', async () => {
    const member = await createCaller('contracts_User');
    await storeTenantSecrets(member.tenant);

    const result = await cloudRunAs(
      'updateemailtemplates',
      {
        tenantId: member.tenant.id,
        details: { RequestSubject: 'Subject', CompletionBody: '<p>Done</p>' },
      },
      member.account.sessionToken
    );

    const raw = JSON.stringify(result);
    expect(raw).not.toContain('FileAdapters');
    expect(raw).not.toContain('PfxFile');
    expect(raw).not.toContain('storage-key');
    expect(result.objectId).toBe(member.extUser.id);
    expect(result.RequestSubject).toBe('Subject');
    expect(result.CompletionBody).toBe('<p>Done</p>');
  });

  it('keeps refusing a call without tenantId or details', async () => {
    const member = await createCaller('contracts_User');

    const failure = await captureRejection(
      cloudRunAs('updateemailtemplates', { details: {} }, member.account.sessionToken)
    );

    expect(failure.message).toBe('Missing tenantId or details.');
  });
});
