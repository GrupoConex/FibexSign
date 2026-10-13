import {
  createCaller,
  createExtUser,
  createPlainUser,
  purgeCreatedAccounts,
} from '../../../spec/utils/auth-fixtures.js';
import { resolveCallerProfile } from './callerProfile.js';

const OPERATION_FORBIDDEN = 119;

const createLinkedProfile = (caller, extras = {}) =>
  createExtUser({
    account: caller.account,
    role: 'contracts_User',
    tenant: caller.tenant,
    extras: { IsLinkedAccount: true, ...extras },
  });

const captureFailure = async promise => {
  try {
    await promise;
    return null;
  } catch (error) {
    return error;
  }
};

describe('resolveCallerProfile', () => {
  let caller;

  beforeEach(async () => {
    caller = await createCaller('contracts_Admin');
  });

  afterEach(async () => {
    await purgeCreatedAccounts();
  });

  it('returns the own profile when no profile is requested', async () => {
    const profile = await resolveCallerProfile(caller.account.id);

    expect(profile.id).toBe(caller.extUser.id);
  });

  it('returns a requested linked profile of the caller', async () => {
    const linked = await createLinkedProfile(caller);

    const profile = await resolveCallerProfile(caller.account.id, linked.id);

    expect(profile.id).toBe(linked.id);
  });

  it('prefers the own profile over a linked one when none is requested', async () => {
    await createLinkedProfile(caller);

    const profile = await resolveCallerProfile(caller.account.id);

    expect(profile.id).toBe(caller.extUser.id);
  });

  it('falls back to the own profile when the requested one belongs to another user', async () => {
    const victim = await createCaller('contracts_Admin');

    const profile = await resolveCallerProfile(caller.account.id, victim.extUser.id);

    expect(profile.id).toBe(caller.extUser.id);
  });

  it('falls back to the own profile when the requested one is disabled', async () => {
    const linked = await createLinkedProfile(caller, { IsDisabled: true });

    const profile = await resolveCallerProfile(caller.account.id, linked.id);

    expect(profile.id).toBe(caller.extUser.id);
  });

  [{ $ne: null }, 42, '', 'missingProfile'].forEach(requested => {
    it(`falls back to the own profile for the request ${JSON.stringify(requested)}`, async () => {
      const profile = await resolveCallerProfile(caller.account.id, requested);

      expect(profile.id).toBe(caller.extUser.id);
    });
  });

  it('rejects a caller whose own profile is disabled', async () => {
    await caller.extUser.save({ IsDisabled: true }, { useMasterKey: true });

    const failure = await captureFailure(resolveCallerProfile(caller.account.id));

    expect(failure?.code).toBe(OPERATION_FORBIDDEN);
  });

  it('still returns an enabled linked profile when the own profile is disabled', async () => {
    await caller.extUser.save({ IsDisabled: true }, { useMasterKey: true });
    const linked = await createLinkedProfile(caller);

    const profile = await resolveCallerProfile(caller.account.id, linked.id);

    expect(profile.id).toBe(linked.id);
  });

  it('rejects a caller without any profile as forbidden', async () => {
    const account = await createPlainUser();

    const failure = await captureFailure(resolveCallerProfile(account.id));

    expect(failure).toEqual(jasmine.any(Parse.Error));
    expect(failure.code).toBe(OPERATION_FORBIDDEN);
  });
});
