import {
  createCaller,
  createPlainUser,
  pointer,
  purgeCreatedAccounts,
} from '../../../spec/utils/auth-fixtures.js';
import { seedRow, seedTemplate } from '../../../spec/utils/document-fixtures.js';
import { buildAccessibleTemplateQuery, templateContactIds } from './templateAccess.js';

const MASTER = { useMasterKey: true };
const TEMPLATE_CLASS = 'contracts_Template';

const accessOf = (caller, teamAncestorIds = []) => ({
  extUserId: caller.extUser.id,
  teamAncestorIds,
});

const findAccessible = async criteria => buildAccessibleTemplateQuery(criteria).first(MASTER);

const contactPointer = objectId => pointer('contracts_Contactbook', objectId);

describe('templateAccess', () => {
  describe('buildAccessibleTemplateQuery', () => {
    let owner;
    let caller;

    beforeEach(async () => {
      owner = await createCaller('contracts_Admin');
      caller = await createCaller('contracts_Admin');
    });

    afterEach(async () => {
      await purgeCreatedAccounts();
    });

    it('finds a template created by the caller account without a profile', async () => {
      const account = await createPlainUser();
      const template = await seedRow(TEMPLATE_CLASS, {
        Name: 'Own',
        CreatedBy: pointer('_User', account.id),
      });

      const found = await findAccessible({ userId: account.id, templateId: template.id });

      expect(found.id).toBe(template.id);
    });

    it('hides a foreign template from a caller without a profile', async () => {
      const account = await createPlainUser();
      const template = await seedTemplate(owner);

      expect(await findAccessible({ userId: account.id, templateId: template.id })).toBeUndefined();
    });

    it('finds a template owned by the caller profile', async () => {
      const template = await seedTemplate(owner, {
        ExtUserPtr: pointer('contracts_Users', caller.extUser.id),
      });

      const found = await findAccessible({
        userId: caller.account.id,
        access: accessOf(caller),
        templateId: template.id,
      });

      expect(found.id).toBe(template.id);
    });

    it('finds a template shared with the caller profile', async () => {
      const template = await seedTemplate(owner, {
        SharedWithUsers: [pointer('contracts_Users', caller.extUser.id)],
      });

      const found = await findAccessible({
        userId: caller.account.id,
        access: accessOf(caller),
        templateId: template.id,
      });

      expect(found.id).toBe(template.id);
    });

    it('finds a template shared with a team of the caller', async () => {
      const template = await seedTemplate(owner, {
        SharedWith: [pointer('contracts_Teams', caller.team.id)],
      });

      const found = await findAccessible({
        userId: caller.account.id,
        access: accessOf(caller, [caller.team.id]),
        templateId: template.id,
      });

      expect(found.id).toBe(template.id);
    });

    it('ignores team sharing for a caller without teams', async () => {
      const template = await seedTemplate(owner, {
        SharedWith: [pointer('contracts_Teams', caller.team.id)],
      });

      const found = await findAccessible({
        userId: caller.account.id,
        access: accessOf(caller),
        templateId: template.id,
      });

      expect(found).toBeUndefined();
    });

    it('hides a foreign template that is not shared with the caller', async () => {
      const template = await seedTemplate(owner);

      const found = await findAccessible({
        userId: caller.account.id,
        access: accessOf(caller, [caller.team.id]),
        templateId: template.id,
      });

      expect(found).toBeUndefined();
    });

    it('hides an archived own template', async () => {
      const template = await seedTemplate(caller, { IsArchive: true });

      const found = await findAccessible({
        userId: caller.account.id,
        access: accessOf(caller),
        templateId: template.id,
      });

      expect(found).toBeUndefined();
    });

    it('returns only the requested template', async () => {
      await seedTemplate(caller);
      const requested = await seedTemplate(caller);

      const found = await findAccessible({
        userId: caller.account.id,
        access: accessOf(caller),
        templateId: requested.id,
      });

      expect(found.id).toBe(requested.id);
    });

    it('includes the owner profile and its tenant', async () => {
      const template = await seedTemplate(caller);

      const found = await findAccessible({
        userId: caller.account.id,
        access: accessOf(caller),
        templateId: template.id,
      });

      expect(found.get('ExtUserPtr').get('Email')).toBe(caller.account.email);
      expect(found.get('ExtUserPtr').get('TenantId').get('TenantName')).toBeDefined();
    });

    [undefined, '', 42, { $ne: null }].forEach(templateId => {
      it(`rejects the template id ${JSON.stringify(templateId)}`, () => {
        expect(() => buildAccessibleTemplateQuery({ userId: 'user1', templateId })).toThrowError(
          Parse.Error
        );
      });
    });

    it('rejects a missing caller id', () => {
      expect(() =>
        buildAccessibleTemplateQuery({ userId: '', templateId: 'template1' })
      ).toThrowError(Parse.Error);
    });
  });

  describe('templateContactIds', () => {
    const templateWith = fields => new Parse.Object(TEMPLATE_CLASS, fields);

    it('collects the signer, bcc, cc and placeholder contacts once', () => {
      const template = templateWith({
        Signers: [contactPointer('signer1'), contactPointer('shared1')],
        Bcc: [contactPointer('bcc1')],
        Cc: [contactPointer('cc1'), contactPointer('shared1')],
        Placeholders: [
          { signerObjId: 'holder1', signerPtr: contactPointer('holder1') },
          { signerObjId: '', signerPtr: {} },
          { signerPtr: { objectId: 'holder2' } },
        ],
      });

      expect(templateContactIds(template).sort()).toEqual(
        ['bcc1', 'cc1', 'holder1', 'holder2', 'shared1', 'signer1'].sort()
      );
    });

    it('returns no contact for a template without recipients', () => {
      expect(templateContactIds(templateWith({ Placeholders: 'none' }))).toEqual([]);
    });
  });
});
