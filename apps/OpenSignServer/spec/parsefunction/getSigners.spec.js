import {
  captureRejection,
  cloudRunAs,
  createCaller,
  createPlainUser,
  purgeCreatedAccounts,
  silenceConsole,
} from '../utils/auth-fixtures.js';
import { seedContact } from '../utils/document-fixtures.js';
import { knownDefect } from '../utils/known-defect.js';

const INVALID_SESSION_TOKEN = 209;
const SCRIPT_FAILED = 141;

const searchSigners = (params, account) => cloudRunAs('getsigners', params, account?.sessionToken);

const namesOf = contacts => contacts.map(contact => contact.Name).sort();

describe('getsigners', () => {
  let owner;
  let stranger;

  beforeEach(async () => {
    silenceConsole();
    owner = await createCaller('contracts_Admin');
    stranger = await createCaller('contracts_Admin');
  });

  afterEach(async () => {
    await purgeCreatedAccounts();
  });

  it('rejects an anonymous caller', async () => {
    const failure = await captureRejection(searchSigners({ search: 'a' }));

    expect(failure.code).toBe(INVALID_SESSION_TOKEN);
  });

  it('lists every own contact when no search is sent', async () => {
    await seedContact(owner, await createPlainUser(), { Name: 'Alpha' });
    await seedContact(owner, await createPlainUser(), { Name: 'Beta' });

    const contacts = await searchSigners({}, owner.account);

    expect(namesOf(contacts)).toEqual(['Alpha', 'Beta']);
  });

  it('matches the search case insensitively against name or email', async () => {
    const byEmail = await createPlainUser();
    await seedContact(owner, await createPlainUser(), { Name: 'Maria Lopez' });
    await seedContact(owner, byEmail, { Name: 'Other', Email: `MARIA.${byEmail.email}` });
    await seedContact(owner, await createPlainUser(), { Name: 'Unrelated' });

    const contacts = await searchSigners({ search: 'maria' }, owner.account);

    expect(namesOf(contacts)).toEqual(['Maria Lopez', 'Other']);
  });

  it('never returns the contacts of another user', async () => {
    await seedContact(stranger, await createPlainUser(), { Name: 'Secret Contact' });

    const contacts = await searchSigners({ search: 'Secret' }, owner.account);

    expect(contacts).toEqual([]);
  });

  it('leaves out deleted contacts', async () => {
    await seedContact(owner, await createPlainUser(), { Name: 'Removed', IsDeleted: true });
    await seedContact(owner, await createPlainUser(), {
      Name: 'Removal pending',
      IsDeleted: false,
    });

    const contacts = await searchSigners({ search: 'Remov' }, owner.account);

    expect(namesOf(contacts)).toEqual(['Removal pending']);
  });

  it('treats regular expression characters in the search literally', async () => {
    await seedContact(owner, await createPlainUser(), { Name: 'Plain' });
    await seedContact(owner, await createPlainUser(), { Name: 'Wild.*Card' });

    const contacts = await searchSigners({ search: '.*' }, owner.account);

    expect(namesOf(contacts)).toEqual(['Wild.*Card']);
  });

  it(
    'KNOWN DEFECT DEF-L3-14 validates a search that is not a string',
    knownDefect(
      'DEF-L3-14',
      'getsigners calls string.replace on an unvalidated search param and fails with an internal script error for non strings',
      async check => {
        const failure = await captureRejection(searchSigners({ search: 42 }, owner.account));

        check(failure?.code !== SCRIPT_FAILED, 'no internal script failure');
        check(!/is not a function/.test(failure?.message ?? ''), 'no TypeError leaks');
      }
    )
  );
});
