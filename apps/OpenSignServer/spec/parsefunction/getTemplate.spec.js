import {
  createCaller,
  createPlainUser,
  pointer,
  purgeCreatedAccounts,
  rejectFirstFor,
  silenceConsole,
} from '../utils/auth-fixtures.js';
import {
  TEMPLATE_GONE,
  answerSessionLookupWith,
  routeSessionLookupWithJavascriptKey,
  runFunctionOverRest,
  seedTemplate,
} from '../utils/document-fixtures.js';
import { knownDefect } from '../utils/known-defect.js';

const MASTER = { useMasterKey: true };
const INVALID_SESSION_TOKEN = 209;
const OBJECT_NOT_FOUND = 101;
const GONE = { error: TEMPLATE_GONE };
const INVALID_SESSION = { error: 'Invalid session token' };

const getTemplate = async (params, sessionToken) => {
  const body = await runFunctionOverRest(
    'getTemplate',
    params,
    sessionToken ? { sessiontoken: sessionToken } : {}
  );
  return body.result;
};

describe('getTemplate', () => {
  let owner;

  beforeEach(async () => {
    silenceConsole();
    owner = await createCaller('contracts_Admin');
  });

  afterEach(async () => {
    await purgeCreatedAccounts();
  });

  describe('session handling', () => {
    it('hides every template from a caller without a session token header', async () => {
      const template = await seedTemplate(owner);

      expect(await getTemplate({ templateId: template.id })).toEqual(GONE);
    });

    it('reports an invalid session token', async () => {
      routeSessionLookupWithJavascriptKey();
      const template = await seedTemplate(owner);

      expect(await getTemplate({ templateId: template.id }, 'r:invalid')).toEqual(INVALID_SESSION);
    });

    it('reports a session lookup that fails with the invalid session code', async () => {
      answerSessionLookupWith(() =>
        Promise.reject(new Parse.Error(INVALID_SESSION_TOKEN, 'expired'))
      );

      expect(await getTemplate({ templateId: 'anyTemplate' }, 'r:any')).toEqual(INVALID_SESSION);
    });

    it('hides the template when the session lookup fails for another reason', async () => {
      answerSessionLookupWith(() => Promise.reject(new Error('network down')));

      expect(await getTemplate({ templateId: 'anyTemplate' }, 'r:any')).toEqual(GONE);
    });

    it('hides the template when the session lookup answers without a user', async () => {
      answerSessionLookupWith(async () => ({ data: null }));
      const template = await seedTemplate(owner);

      expect(await getTemplate({ templateId: template.id }, 'r:any')).toEqual(GONE);
    });

    it('hides everything when no template id is sent', async () => {
      routeSessionLookupWithJavascriptKey();

      expect(await getTemplate({}, owner.account.sessionToken)).toEqual(GONE);
    });
  });

  describe('for a caller that belongs to a team', () => {
    beforeEach(() => {
      routeSessionLookupWithJavascriptKey();
    });

    it('returns the own template without the tenant secrets', async () => {
      await owner.tenant.save(
        { FileAdapters: 'sensitive-adapter-config', PfxFile: { name: 'c.pfx' } },
        MASTER
      );
      const template = await seedTemplate(owner);

      const result = await getTemplate({ templateId: template.id }, owner.account.sessionToken);

      expect(result.objectId).toBe(template.id);
      expect(result.ExtUserPtr.TenantId.objectId).toBe(owner.tenant.id);
      expect(result.ExtUserPtr.TenantId.FileAdapters).toBeUndefined();
      expect(result.ExtUserPtr.TenantId.PfxFile).toBeUndefined();
    });

    it('returns a template of another user shared with the caller team', async () => {
      const author = await createCaller('contracts_Admin');
      const template = await seedTemplate(author, {
        SharedWith: [pointer('contracts_Teams', owner.team.id)],
      });

      const result = await getTemplate({ templateId: template.id }, owner.account.sessionToken);

      expect(result.objectId).toBe(template.id);
    });

    it('returns a template of another user shared with the caller directly', async () => {
      const author = await createCaller('contracts_Admin');
      const template = await seedTemplate(author, {
        SharedWithUsers: [pointer('contracts_Users', owner.extUser.id)],
      });

      const result = await getTemplate({ templateId: template.id }, owner.account.sessionToken);

      expect(result.objectId).toBe(template.id);
    });

    it('hides a template of another user that is not shared with the caller', async () => {
      const template = await seedTemplate(await createCaller('contracts_Admin'));

      expect(await getTemplate({ templateId: template.id }, owner.account.sessionToken)).toEqual(
        GONE
      );
    });

    it('hides an archived own template', async () => {
      const template = await seedTemplate(owner, { IsArchive: true });

      expect(await getTemplate({ templateId: template.id }, owner.account.sessionToken)).toEqual(
        GONE
      );
    });

    it(
      'KNOWN DEFECT DEF-L3-11 reports a failing template lookup through the error envelope',
      knownDefect(
        'DEF-L3-11',
        'getDocument and getTemplate inner catch returns the raw error object as a successful result instead of the {error} envelope or a rejection',
        async check => {
          rejectFirstFor('contracts_Template', new Parse.Error(OBJECT_NOT_FOUND, 'lookup failed'));

          const result = await getTemplate(
            { templateId: 'anyTemplate' },
            owner.account.sessionToken
          );

          check(result?.objectId === undefined, 'no template is returned');
          check(result?.code === undefined, 'no raw error code leaks as a result');
          check(result === undefined || typeof result.error === 'string', 'error envelope used');
        }
      )
    );
  });

  it(
    'KNOWN DEFECT DEF-L3-09 hides foreign templates from callers without a team or profile',
    knownDefect(
      'DEF-L3-09',
      'getTemplate drops the ownership and sharing filter when the caller has no contracts_Users profile or no TeamIds',
      async check => {
        routeSessionLookupWithJavascriptKey();
        const template = await seedTemplate(owner);
        const teamless = await createCaller('contracts_Admin', { team: undefined });
        const profileless = await createPlainUser();

        const teamlessResult = await getTemplate(
          { templateId: template.id },
          teamless.account.sessionToken
        );
        const profilelessResult = await getTemplate(
          { templateId: template.id },
          profileless.sessionToken
        );

        check(
          teamlessResult.objectId === undefined,
          'caller without team cannot read the template'
        );
        check(
          profilelessResult.objectId === undefined,
          'caller without profile cannot read the template'
        );
      }
    )
  );
});
