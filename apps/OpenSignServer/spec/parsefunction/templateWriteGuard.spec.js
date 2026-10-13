import axios from 'axios';
import {
  PASSWORD,
  createCaller,
  createOrganization,
  createTeam,
  createTenantMember,
  createTenantScope,
  pointer,
  resetAuthState,
  silenceConsole,
  uniqueEmail,
} from '../utils/auth-fixtures.js';
import { fileUrl, seedContact, seedTemplate, trustedFileUrl } from '../utils/document-fixtures.js';

const MASTER = { useMasterKey: true };

const rest = (method, path, sessionToken, data) =>
  axios({
    method,
    url: `${process.env.SERVER_URL}${path}`,
    data,
    headers: {
      'X-Parse-Application-Id': process.env.APP_ID,
      'X-Parse-Javascript-Key': 'test',
      'X-Parse-Session-Token': sessionToken,
    },
    validateStatus: () => true,
  });

const postTemplate = (sessionToken, data) =>
  rest('post', '/classes/contracts_Template', sessionToken, data);

const putTemplate = (templateId, sessionToken, data) =>
  rest('put', `/classes/contracts_Template/${templateId}`, sessionToken, data);

const reloadTemplate = templateId => new Parse.Query('contracts_Template').get(templateId, MASTER);

describe('contracts_Template write guard (templateWriteGuard)', () => {
  let restoreConsole;
  let scope;
  let owner;
  let otherUser;
  let ownTeam;
  let foreignTeam;

  beforeAll(async () => {
    restoreConsole = silenceConsole();
    await resetAuthState();
    scope = await createTenantScope();
    owner = await createTenantMember('contracts_Admin', scope, 'tmpl-owner');
    ownTeam = await createTeam(scope.organization, 'Own Org Team');

    const foreignScope = await createTenantScope();
    otherUser = await createTenantMember('contracts_Admin', foreignScope, 'tmpl-foreign-user');
    foreignTeam = await createTeam(foreignScope.organization, 'Foreign Org Team');
  });

  afterAll(async () => {
    await resetAuthState();
    restoreConsole();
  });

  describe('master key bypass', () => {
    it('allows saving and modifying templates with master key', async () => {
      const template = new Parse.Object('contracts_Template');
      template.set({
        Name: 'Master Created Template',
        URL: fileUrl('any-storage.pdf'),
        CreatedBy: pointer('_User', owner.account.id),
        ExtUserPtr: pointer('contracts_Users', owner.extUser.id),
      });
      const saved = await template.save(null, MASTER);
      expect(saved.id).toBeDefined();

      saved.set('Description', 'Updated by master');
      const updated = await saved.save(null, MASTER);
      expect(updated.get('Description')).toBe('Updated by master');
    });
  });

  describe('unauthenticated requests', () => {
    it('rejects unauthenticated template creation', async () => {
      const res = await postTemplate(undefined, {
        Name: 'Anonymous Template',
        URL: trustedFileUrl('tmpl.pdf'),
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.data.code).toBe(Parse.Error.OPERATION_FORBIDDEN);
    });

    it('rejects unauthenticated template update', async () => {
      const tmpl = await seedTemplate(owner);
      const res = await putTemplate(tmpl.id, undefined, {
        Name: 'Tampered Template Name',
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.data.code).toBe(Parse.Error.OPERATION_FORBIDDEN);
    });
  });

  describe('template creation by client', () => {
    it('forces CreatedBy and ExtUserPtr from caller session even if forged', async () => {
      const res = await postTemplate(owner.account.sessionToken, {
        Name: 'Client Template',
        URL: trustedFileUrl('client-tmpl.pdf'),
        CreatedBy: pointer('_User', otherUser.account.id),
        ExtUserPtr: pointer('contracts_Users', otherUser.extUser.id),
      });

      expect(res.status).toBe(201);
      const created = await reloadTemplate(res.data.objectId);
      expect(created.get('CreatedBy').id).toBe(owner.account.id);
      expect(created.get('ExtUserPtr').id).toBe(owner.extUser.id);
      expect(created.getACL().getReadAccess(owner.account.id)).toBe(true);
      expect(created.getACL().getWriteAccess(owner.account.id)).toBe(true);
    });

    it('rejects untrusted storage URLs on template creation', async () => {
      const res = await postTemplate(owner.account.sessionToken, {
        Name: 'Untrusted Template',
        URL: 'https://evil-storage.com/template.pdf',
      });

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.data.code).toBe(Parse.Error.INVALID_JSON);
    });

    it('rejects SharedWith pointing to a team from another organization', async () => {
      const res = await postTemplate(owner.account.sessionToken, {
        Name: 'Template with Foreign Team',
        URL: trustedFileUrl('legal-tmpl.pdf'),
        SharedWith: [pointer('contracts_Teams', foreignTeam.id)],
      });

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.data.code).toBe(Parse.Error.OPERATION_FORBIDDEN);
    });

    it('accepts SharedWith pointing to teams in own organization', async () => {
      const res = await postTemplate(owner.account.sessionToken, {
        Name: 'Template with Own Team',
        URL: trustedFileUrl('legal-tmpl.pdf'),
        SharedWith: [pointer('contracts_Teams', ownTeam.id)],
      });

      expect(res.status).toBe(201);
      const created = await reloadTemplate(res.data.objectId);
      expect(created.get('SharedWith').length).toBe(1);
      expect(created.get('SharedWith')[0].id || created.get('SharedWith')[0].objectId).toBe(
        ownTeam.id
      );
    });
  });

  describe('template update by non-owner (Decision D3)', () => {
    it('rejects any direct update by a user who is not the template owner', async () => {
      const tmpl = await seedTemplate(owner);
      // Even if otherUser sends a change:
      const res = await putTemplate(tmpl.id, otherUser.account.sessionToken, {
        Name: 'Hijacked Template Name',
      });

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.data.code).toBe(Parse.Error.OPERATION_FORBIDDEN);
    });
  });

  describe('template update by owner', () => {
    it('allows owner to update template Name, Description, Note', async () => {
      const tmpl = await seedTemplate(owner);
      const res = await putTemplate(tmpl.id, owner.account.sessionToken, {
        Name: 'Updated Template Name',
        Description: 'Standard NDA',
        Note: 'Requires HR approval',
      });

      expect(res.status).toBe(200);
      const updated = await reloadTemplate(tmpl.id);
      expect(updated.get('Name')).toBe('Updated Template Name');
      expect(updated.get('Description')).toBe('Standard NDA');
      expect(updated.get('Note')).toBe('Requires HR approval');
    });

    it('forbids owner from changing CreatedBy or ExtUserPtr', async () => {
      const tmpl = await seedTemplate(owner);
      const res = await putTemplate(tmpl.id, owner.account.sessionToken, {
        CreatedBy: pointer('_User', otherUser.account.id),
      });

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.data.code).toBe(Parse.Error.OPERATION_FORBIDDEN);
    });

    it('rejects untrusted storage URLs when updating URL', async () => {
      const tmpl = await seedTemplate(owner);
      const res = await putTemplate(tmpl.id, owner.account.sessionToken, {
        URL: 'https://attacker.site/new-template.pdf',
      });

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.data.code).toBe(Parse.Error.INVALID_JSON);
    });

    it('rejects owner sharing with a team from another organization', async () => {
      const tmpl = await seedTemplate(owner);
      const res = await putTemplate(tmpl.id, owner.account.sessionToken, {
        SharedWith: [pointer('contracts_Teams', foreignTeam.id)],
      });

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.data.code).toBe(Parse.Error.OPERATION_FORBIDDEN);
    });

    it('allows owner sharing with a team from their own organization', async () => {
      const tmpl = await seedTemplate(owner);
      const res = await putTemplate(tmpl.id, owner.account.sessionToken, {
        SharedWith: [pointer('contracts_Teams', ownTeam.id)],
      });

      expect(res.status).toBe(200);
      const updated = await reloadTemplate(tmpl.id);
      expect(updated.get('SharedWith').length).toBe(1);
      expect(updated.get('SharedWith')[0].id || updated.get('SharedWith')[0].objectId).toBe(
        ownTeam.id
      );
    });
  });
});
