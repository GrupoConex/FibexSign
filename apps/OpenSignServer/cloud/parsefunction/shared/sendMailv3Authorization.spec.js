import { authorizeSendMailv3, resetSendMailv3UserLimits } from './sendMailv3Authorization.js';

const OPERATION_FORBIDDEN = 119;
const REQUEST_LIMIT_EXCEEDED = 155;
const INVALID_QUERY = 102;
const MINUTE_MS = 60 * 1000;

const baseContext = {
  createdById: 'owner-user',
  ownerUserId: 'owner-user',
  extUserId: 'ext-owner',
  ownerEmail: 'Owner@x.com',
  tenantId: 'tenant-1',
  organizationId: 'org-1',
  sharedWithUserIds: [],
  sharedTeamIds: [],
  signerEmails: ['signer@x.com', 'Second@x.com', undefined, ''],
};

const buildClock = start => {
  let current = start;
  return {
    now: () => current,
    advance: ms => {
      current += ms;
    },
  };
};

const capture = async promise => {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  return undefined;
};

describe('authorizeSendMailv3', () => {
  let clock;
  let loadMailContext;
  let loadCallerAccess;
  const user = { id: 'owner-user' };

  const authorize = (params, overrides = {}) =>
    authorizeSendMailv3(
      { user, params: { docId: 'doc1', recipient: 'signer@x.com', ...params } },
      { now: clock.now, loadMailContext, loadCallerAccess, env: {}, ...overrides }
    );

  beforeEach(() => {
    resetSendMailv3UserLimits();
    clock = buildClock(1000);
    loadMailContext = jasmine.createSpy('loadMailContext').and.resolveTo(baseContext);
    loadCallerAccess = jasmine.createSpy('loadCallerAccess').and.resolveTo(null);
  });

  afterAll(() => {
    resetSendMailv3UserLimits();
  });

  describe('docId', () => {
    [undefined, null, '', '   ', 42, {}].forEach(docId => {
      it(`rejects ${JSON.stringify(docId)} without loading anything`, async () => {
        const thrown = await capture(authorize({ docId }));

        expect(thrown).toEqual(jasmine.any(Parse.Error));
        expect(thrown.code).toBe(INVALID_QUERY);
        expect(loadMailContext).not.toHaveBeenCalled();
      });
    });

    it('loads contracts_Document by default', async () => {
      await authorize({});

      expect(loadMailContext).toHaveBeenCalledWith('doc1', 'contracts_Document');
    });

    it('loads contracts_Template only when explicitly requested', async () => {
      await authorize({ docClass: 'contracts_Template' });

      expect(loadMailContext).toHaveBeenCalledWith('doc1', 'contracts_Template');
    });

    it('rejects unknown classes', async () => {
      const thrown = await capture(authorize({ docClass: '_User' }));

      expect(thrown.code).toBe(INVALID_QUERY);
      expect(loadMailContext).not.toHaveBeenCalled();
    });
  });

  describe('ownership', () => {
    it('allows the creator', async () => {
      loadMailContext.and.resolveTo({ ...baseContext, ownerUserId: 'someone-else' });

      await expectAsync(authorize({})).toBeResolved();
    });

    it('allows the user linked to the document ext user', async () => {
      loadMailContext.and.resolveTo({ ...baseContext, createdById: 'someone-else' });

      await expectAsync(authorize({})).toBeResolved();
    });

    it('forbids any other user', async () => {
      loadMailContext.and.resolveTo({
        ...baseContext,
        createdById: 'a',
        ownerUserId: 'b',
      });

      const thrown = await capture(authorize({}));

      expect(thrown.code).toBe(OPERATION_FORBIDDEN);
    });

    it('forbids when the document has no owner information', async () => {
      loadMailContext.and.resolveTo({ signerEmails: ['signer@x.com'] });

      const thrown = await capture(authorize({}));

      expect(thrown.code).toBe(OPERATION_FORBIDDEN);
    });

    it('forbids when the document cannot be loaded', async () => {
      loadMailContext.and.rejectWith(new Error('not found'));

      const thrown = await capture(authorize({}));

      expect(thrown.code).toBe(OPERATION_FORBIDDEN);
    });

    it('forbids a session without an id even when the document has no ids', async () => {
      loadMailContext.and.resolveTo({ signerEmails: ['signer@x.com'] });

      const thrown = await capture(
        authorizeSendMailv3(
          { user: {}, params: { docId: 'doc1', recipient: 'signer@x.com' } },
          { now: clock.now, loadMailContext, env: {} }
        )
      );

      expect(thrown.code).toBe(OPERATION_FORBIDDEN);
    });
  });

  describe('shared access', () => {
    const stranger = { id: 'member-user' };
    const strangerContext = { ...baseContext, createdById: 'a', ownerUserId: 'b' };
    const access = (overrides = {}) => ({
      extUserId: 'member-ext',
      role: 'contracts_User',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      teamAncestorIds: [],
      ...overrides,
    });

    const authorizeAsMember = (callerAccess, context = strangerContext, params = {}) => {
      loadMailContext.and.resolveTo(context);
      loadCallerAccess.and.resolveTo(callerAccess);
      return authorizeSendMailv3(
        { user: stranger, params: { docId: 'doc1', recipient: 'signer@x.com', ...params } },
        { now: clock.now, loadMailContext, loadCallerAccess, env: {} }
      );
    };

    it('does not look up the caller access for owners', async () => {
      await authorize({});

      expect(loadCallerAccess).not.toHaveBeenCalled();
    });

    it('allows a user the document is shared with', async () => {
      const result = await authorizeAsMember(access(), {
        ...strangerContext,
        sharedWithUserIds: ['other', 'member-ext'],
      });

      expect(result).toEqual({ extUserId: 'ext-owner' });
      expect(loadCallerAccess).toHaveBeenCalledWith('member-user');
    });

    it('allows a member whose team or ancestor team the document is shared with', async () => {
      await expectAsync(
        authorizeAsMember(access({ teamAncestorIds: ['root', 'child'] }), {
          ...strangerContext,
          sharedTeamIds: ['x', 'root'],
        })
      ).toBeResolved();
    });

    it('forbids a member whose teams do not intersect the shared teams', async () => {
      const thrown = await capture(
        authorizeAsMember(access({ teamAncestorIds: ['child'] }), {
          ...strangerContext,
          sharedTeamIds: ['root'],
        })
      );

      expect(thrown.code).toBe(OPERATION_FORBIDDEN);
    });

    it('allows a contracts_Admin of the document tenant', async () => {
      await expectAsync(authorizeAsMember(access({ role: 'contracts_Admin' }))).toBeResolved();
    });

    it('forbids a contracts_Admin of another tenant', async () => {
      const thrown = await capture(
        authorizeAsMember(access({ role: 'contracts_Admin', tenantId: 'tenant-2' }))
      );

      expect(thrown.code).toBe(OPERATION_FORBIDDEN);
    });

    it('allows a contracts_OrgAdmin of the same tenant and organization', async () => {
      await expectAsync(authorizeAsMember(access({ role: 'contracts_OrgAdmin' }))).toBeResolved();
    });

    it('forbids a contracts_OrgAdmin of another organization in the same tenant', async () => {
      const thrown = await capture(
        authorizeAsMember(access({ role: 'contracts_OrgAdmin', organizationId: 'org-2' }))
      );

      expect(thrown.code).toBe(OPERATION_FORBIDDEN);
    });

    it('forbids a contracts_OrgAdmin of the same organization id in another tenant', async () => {
      const thrown = await capture(
        authorizeAsMember(access({ role: 'contracts_OrgAdmin', tenantId: 'tenant-2' }))
      );

      expect(thrown.code).toBe(OPERATION_FORBIDDEN);
    });

    ['contracts_User', 'contracts_Editor', undefined].forEach(role => {
      it(`forbids the non admin role ${role} of the same tenant`, async () => {
        const thrown = await capture(authorizeAsMember(access({ role })));

        expect(thrown.code).toBe(OPERATION_FORBIDDEN);
      });
    });

    it('never matches admins when tenant ids are missing on both sides', async () => {
      const thrown = await capture(
        authorizeAsMember(access({ role: 'contracts_Admin', tenantId: undefined }), {
          ...strangerContext,
          tenantId: undefined,
        })
      );

      expect(thrown.code).toBe(OPERATION_FORBIDDEN);
    });

    it('forbids when the caller has no contracts_Users record', async () => {
      const thrown = await capture(authorizeAsMember(null));

      expect(thrown.code).toBe(OPERATION_FORBIDDEN);
    });

    it('forbids when the caller lookup fails', async () => {
      loadMailContext.and.resolveTo(strangerContext);
      loadCallerAccess.and.rejectWith(new Error('db down'));

      const thrown = await capture(
        authorizeSendMailv3(
          { user: stranger, params: { docId: 'doc1', recipient: 'signer@x.com' } },
          { now: clock.now, loadMailContext, loadCallerAccess, env: {} }
        )
      );

      expect(thrown.code).toBe(OPERATION_FORBIDDEN);
    });

    it('still enforces the recipient allowlist for shared access', async () => {
      const thrown = await capture(
        authorizeAsMember(access({ role: 'contracts_Admin' }), strangerContext, {
          recipient: 'evil@y.com',
        })
      );

      expect(thrown.code).toBe(OPERATION_FORBIDDEN);
    });
  });

  describe('recipients', () => {
    it('allows signer emails case-insensitively and trimmed', async () => {
      await expectAsync(authorize({ recipient: ' SIGNER@x.com ' })).toBeResolved();
    });

    it('allows placeholders shaped emails supplied by the loader', async () => {
      await expectAsync(authorize({ recipient: 'second@x.com' })).toBeResolved();
    });

    it('allows the owner email', async () => {
      await expectAsync(authorize({ recipient: 'owner@x.com' })).toBeResolved();
    });

    it('allows comma separated and array recipients across to, cc and bcc', async () => {
      await expectAsync(
        authorize({
          recipient: 'signer@x.com, owner@x.com',
          cc: ['second@x.com'],
          bcc: 'owner@x.com',
        })
      ).toBeResolved();
    });

    ['recipient', 'cc', 'bcc'].forEach(field => {
      it(`forbids a foreign address in ${field}`, async () => {
        const thrown = await capture(authorize({ [field]: 'evil@y.com' }));

        expect(thrown.code).toBe(OPERATION_FORBIDDEN);
      });

      it(`forbids a foreign address hidden in a list in ${field}`, async () => {
        const thrown = await capture(authorize({ [field]: ['signer@x.com', 'evil@y.com'] }));

        expect(thrown.code).toBe(OPERATION_FORBIDDEN);
      });
    });

    it('forbids semicolon separated addresses that hide a foreign one', async () => {
      const thrown = await capture(authorize({ recipient: 'signer@x.com;evil@y.com' }));

      expect(thrown.code).toBe(OPERATION_FORBIDDEN);
    });

    it('forbids quoted display names around an allowed address', async () => {
      const thrown = await capture(authorize({ recipient: '"Signer" <signer@x.com>' }));

      expect(thrown.code).toBe(OPERATION_FORBIDDEN);
    });

    it('accepts duplicates across fields and arrays', async () => {
      await expectAsync(
        authorize({
          recipient: ['signer@x.com', 'SIGNER@x.com', ' signer@x.com '],
          cc: 'signer@x.com',
          bcc: [' Signer@X.com'],
        })
      ).toBeResolved();
    });

    it('forbids display name formats that hide another address', async () => {
      const thrown = await capture(authorize({ recipient: 'Signer <evil@y.com>' }));

      expect(thrown.code).toBe(OPERATION_FORBIDDEN);
    });

    it('never treats blank loader emails as allowed recipients', async () => {
      const thrown = await capture(authorize({ recipient: ' ', cc: 'evil@y.com' }));

      expect(thrown.code).toBe(OPERATION_FORBIDDEN);
    });
  });

  describe('mail counting', () => {
    it('returns the document ext user id and ignores the client value', async () => {
      const result = await authorize({ extUserId: 'victim-ext' });

      expect(result).toEqual({ extUserId: 'ext-owner' });
    });

    it('returns an empty id when the document has no ext user', async () => {
      loadMailContext.and.resolveTo({ ...baseContext, extUserId: undefined });

      const result = await authorize({ extUserId: 'victim-ext' });

      expect(result).toEqual({ extUserId: '' });
    });
  });

  describe('per user limit', () => {
    it('defaults to 100 calls per 10 minutes and answers 155 afterwards', async () => {
      for (let index = 0; index < 100; index += 1) await authorize({});

      const thrown = await capture(authorize({}));

      expect(thrown.code).toBe(REQUEST_LIMIT_EXCEEDED);
    });

    it('allows calls again after the window', async () => {
      for (let index = 0; index < 100; index += 1) await authorize({});

      clock.advance(10 * MINUTE_MS);

      await expectAsync(authorize({})).toBeResolved();
    });

    it('honours SENDMAILV3_USER_LIMIT and SENDMAILV3_USER_WINDOW_MS', async () => {
      const env = { SENDMAILV3_USER_LIMIT: '2', SENDMAILV3_USER_WINDOW_MS: '5000' };
      await authorize({}, { env });
      await authorize({}, { env });

      const blocked = await capture(authorize({}, { env }));
      clock.advance(5000);

      expect(blocked.code).toBe(REQUEST_LIMIT_EXCEEDED);
      await expectAsync(authorize({}, { env })).toBeResolved();
    });

    ['0', '-1', 'abc', '2.5', ''].forEach(invalid => {
      it(`falls back to defaults for invalid values "${invalid}"`, async () => {
        const env = { SENDMAILV3_USER_LIMIT: invalid, SENDMAILV3_USER_WINDOW_MS: invalid };
        for (let index = 0; index < 100; index += 1) await authorize({}, { env });

        const thrown = await capture(authorize({}, { env }));

        expect(thrown.code).toBe(REQUEST_LIMIT_EXCEEDED);
      });
    });

    it('counts rejected authorizations and keeps users separate', async () => {
      const env = { SENDMAILV3_USER_LIMIT: '2' };
      await capture(authorize({ recipient: 'evil@y.com' }, { env }));
      await capture(authorize({ recipient: 'evil@y.com' }, { env }));

      const blocked = await capture(authorize({}, { env }));
      const otherUser = await capture(
        authorizeSendMailv3(
          { user: { id: 'other' }, params: { docId: 'doc1', recipient: 'signer@x.com' } },
          { now: clock.now, loadMailContext, env }
        )
      );

      expect(blocked.code).toBe(REQUEST_LIMIT_EXCEEDED);
      expect(otherUser.code).toBe(OPERATION_FORBIDDEN);
    });

    it('clamps SENDMAILV3_USER_LIMIT to 1000', async () => {
      const env = { SENDMAILV3_USER_LIMIT: '5000' };
      for (let index = 0; index < 1000; index += 1) await authorize({}, { env });

      const thrown = await capture(authorize({}, { env }));

      expect(thrown.code).toBe(REQUEST_LIMIT_EXCEEDED);
    });

    it('rate limits before loading the document', async () => {
      const env = { SENDMAILV3_USER_LIMIT: '1' };
      await authorize({}, { env });
      loadMailContext.calls.reset();

      await capture(authorize({}, { env }));

      expect(loadMailContext).not.toHaveBeenCalled();
    });
  });
});
