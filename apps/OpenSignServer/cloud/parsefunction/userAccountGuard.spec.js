import { PROTECTED_USER_FIELDS, guardUserAccountSave } from './userAccountGuard.js';

const buildUser = (fields = {}) => ({ get: key => fields[key] });

const baseFields = () => ({
  email: 'member@example.com',
  username: 'member@example.com',
  normalizedEmail: 'member@example.com',
  name: 'Member',
});

const buildUpdate = (changes = {}, overrides = {}) => ({
  master: false,
  original: buildUser(baseFields()),
  object: buildUser({ ...baseFields(), ...changes }),
  ...overrides,
});

const captureRejection = async promise => {
  try {
    await promise;
    return null;
  } catch (error) {
    return error;
  }
};

describe('userAccountGuard', () => {
  it('protects the identity fields of an account', () => {
    expect([...PROTECTED_USER_FIELDS].sort()).toEqual([
      'credentialsSecuredAt',
      'email',
      'normalizedEmail',
      'username',
    ]);
  });

  it('never blocks the master key', async () => {
    const request = buildUpdate({ email: 'other@example.com' }, { master: true });

    expect(await captureRejection(guardUserAccountSave(request))).toBeNull();
  });

  it('allows the server to create an account with the master key', async () => {
    const request = { master: true, original: undefined, object: buildUser(baseFields()) };

    expect(await captureRejection(guardUserAccountSave(request))).toBeNull();
  });

  it('refuses the creation of an account that does not come from the master key', async () => {
    const request = { master: false, original: undefined, object: buildUser(baseFields()) };

    const error = await captureRejection(guardUserAccountSave(request));

    expect(error.code).toBe(Parse.Error.OPERATION_FORBIDDEN);
    expect(error.message).toBe('Accounts can only be created by the server.');
  });

  it('allows updates that leave the identity fields untouched', async () => {
    const request = buildUpdate({ name: 'Renamed', phone: '+5804141234567' });

    expect(await captureRejection(guardUserAccountSave(request))).toBeNull();
  });

  PROTECTED_USER_FIELDS.forEach(field => {
    it(`refuses an update that changes ${field}`, async () => {
      const request = buildUpdate({ [field]: 'changed@example.com' });

      const error = await captureRejection(guardUserAccountSave(request));

      expect(error.code).toBe(Parse.Error.OPERATION_FORBIDDEN);
      expect(error.message).toContain(field);
    });
  });

  it('refuses removing an identity field', async () => {
    const request = buildUpdate({ email: undefined });

    const error = await captureRejection(guardUserAccountSave(request));

    expect(error.message).toContain('email');
  });
});
