import {
  captureRejection,
  cloudRunAs,
  createCaller,
  createPlainUser,
  interceptQuery,
  pointer,
  purgeCreatedAccounts,
  silenceConsole,
  waitUntil,
} from '../utils/auth-fixtures.js';
import {
  aclOf,
  ownerFields,
  readWriteFor,
  reload,
  runFunctionOverRest,
  seedContact,
  seedTemplate,
} from '../utils/document-fixtures.js';

const CLASS_NAME = 'contracts_Document';
const CONTACT_CLASS = 'contracts_Contactbook';
const OPERATION_FORBIDDEN = 119;
const AFTER_SAVE_SETTLE_MS = 750;

const create = (document, account) =>
  cloudRunAs('createdocumentfromapp', { document }, account?.sessionToken);

const createOverRest = async (document, account) => {
  const body = await runFunctionOverRest(
    'createdocumentfromapp',
    { document },
    { 'X-Parse-Session-Token': account.sessionToken }
  );
  if (body.error) throw new Parse.Error(body.code, body.error);
  return Parse.Object.extend(CLASS_NAME).createWithoutData(body.result.objectId);
};

const contactPointer = objectId => pointer(CONTACT_CLASS, objectId);

const forgedContactRow = (contactId, victim) => ({
  __type: 'Object',
  className: CONTACT_CLASS,
  objectId: contactId,
  UserId: pointer('_User', victim.account.id),
  ExtUserPtr: pointer('contracts_Users', victim.extUser.id),
});

const settleAfterSave = () => new Promise(resolve => setTimeout(resolve, AFTER_SAVE_SETTLE_MS));

const teamAncestorsOf = async team =>
  (await reload('contracts_Teams', team.id)).get('Ancestors') ?? [];

const waitForTeamAncestors = team =>
  waitUntil(async () => (await teamAncestorsOf(team)).length > 0);

describe('createdocumentfromapp recipients', () => {
  let owner;
  let signer;
  let ownContact;

  beforeEach(async () => {
    silenceConsole();
    owner = await createCaller('contracts_Admin');
    signer = await createPlainUser();
    ownContact = await seedContact(owner, signer);
  });

  afterEach(async () => {
    await purgeCreatedAccounts();
  });

  describe('client supplied contact rows', () => {
    let victim;

    beforeEach(async () => {
      victim = await createCaller('contracts_Admin');
    });

    it('rejects a plain contact object that carries a foreign account', async () => {
      const failure = await captureRejection(
        createOverRest(
          {
            ...ownerFields(owner),
            Signers: [
              {
                className: CONTACT_CLASS,
                objectId: ownContact.id,
                UserId: pointer('_User', victim.account.id),
              },
            ],
          },
          owner.account
        )
      );

      expect(failure.code).toBe(OPERATION_FORBIDDEN);
    });

    it('stores forged contact rows as bare pointers and keeps the victim out', async () => {
      const forged = forgedContactRow(ownContact.id, victim);

      const created = await createOverRest(
        { ...ownerFields(owner), Signers: [forged], Bcc: [forged], Cc: [forged] },
        owner.account
      );
      await settleAfterSave();

      const stored = await reload(CLASS_NAME, created.id);
      ['Signers', 'Bcc', 'Cc'].forEach(field => {
        const [recipient] = stored.get(field);
        expect(recipient.id).withContext(field).toBe(ownContact.id);
        expect(recipient.get('UserId')).withContext(field).toBeUndefined();
      });
      expect(stored.get('ExtUserPtr').id).toBe(owner.extUser.id);
      expect(await aclOf(CLASS_NAME, created.id)).toEqual(
        readWriteFor(owner.account.id, signer.id)
      );
    });

    it('stores each signer once in the requested order', async () => {
      const second = await seedContact(owner, await createPlainUser());

      const created = await create(
        {
          ...ownerFields(owner),
          Signers: [
            contactPointer(second.id),
            contactPointer(ownContact.id),
            contactPointer(second.id),
          ],
        },
        owner.account
      );

      const stored = await reload(CLASS_NAME, created.id);
      expect(stored.get('Signers').map(row => row.id)).toEqual([second.id, ownContact.id]);
    });

    it('stores placeholder signers as bare pointers', async () => {
      const created = await createOverRest(
        {
          ...ownerFields(owner),
          Placeholders: [
            {
              Role: 'Role 1',
              signerObjId: ownContact.id,
              signerPtr: forgedContactRow(ownContact.id, victim),
            },
          ],
        },
        owner.account
      );

      const [placeholder] = (await reload(CLASS_NAME, created.id)).get('Placeholders');
      expect(placeholder.signerObjId).toBe(ownContact.id);
      expect(placeholder.signerPtr.id).toBe(ownContact.id);
      expect(placeholder.signerPtr.get('UserId')).toBeUndefined();
    });

    it('rejects placeholders that point to a contact of another user', async () => {
      const victimContact = await seedContact(victim, await createPlainUser());

      const bySignerId = await captureRejection(
        create(
          { ...ownerFields(owner), Placeholders: [{ signerObjId: victimContact.id }] },
          owner.account
        )
      );
      const bySignerPointer = await captureRejection(
        create(
          {
            ...ownerFields(owner),
            Placeholders: [{ signerPtr: contactPointer(victimContact.id) }],
          },
          owner.account
        )
      );

      expect(bySignerId.code).toBe(OPERATION_FORBIDDEN);
      expect(bySignerPointer.code).toBe(OPERATION_FORBIDDEN);
    });
  });

  describe('template reference', () => {
    it('stores an accessible template as a pointer', async () => {
      const template = await seedTemplate(owner);

      const created = await create(
        { ...ownerFields(owner), TemplateId: template.id },
        owner.account
      );

      expect((await reload(CLASS_NAME, created.id)).get('TemplateId').id).toBe(template.id);
    });

    it('does not store a template the caller cannot access', async () => {
      const template = await seedTemplate(await createCaller('contracts_Admin'));

      const created = await create(
        { ...ownerFields(owner), TemplateId: pointer('contracts_Template', template.id) },
        owner.account
      );

      expect((await reload(CLASS_NAME, created.id)).get('TemplateId')).toBeUndefined();
    });

    it('looks the template up exactly once', async () => {
      const template = await seedTemplate(owner);
      const lookup = interceptQuery('first', 'contracts_Template', run => run());

      await create(
        {
          ...ownerFields(owner),
          TemplateId: pointer('contracts_Template', template.id),
          Signers: [contactPointer(ownContact.id)],
          Bcc: [contactPointer(ownContact.id)],
        },
        owner.account
      );

      expect(lookup.hits()).toBe(1);
    });
  });

  describe('from a template of another user', () => {
    let author;
    let authorSigner;
    let authorContact;

    beforeEach(async () => {
      author = await createCaller('contracts_Admin');
      authorSigner = await createPlainUser();
      authorContact = await seedContact(author, authorSigner);
      await waitForTeamAncestors(owner.team);
    });

    const seedAuthorTemplate = fields =>
      seedTemplate(author, { Signers: [contactPointer(authorContact.id)], ...fields });

    const createFromTemplate = (templateId, contact) =>
      create(
        { ...ownerFields(owner), TemplateId: templateId, Signers: [contactPointer(contact.id)] },
        owner.account
      );

    it('lets a team member use the recipients of a template shared with the team', async () => {
      const template = await seedAuthorTemplate({
        SharedWith: [pointer('contracts_Teams', owner.team.id)],
        Bcc: [contactPointer(authorContact.id)],
      });

      const created = await create(
        {
          ...ownerFields(owner),
          TemplateId: pointer('contracts_Template', template.id),
          Signers: [contactPointer(authorContact.id)],
          Bcc: [contactPointer(authorContact.id)],
        },
        owner.account
      );

      expect(await aclOf(CLASS_NAME, created.id)).toEqual(
        readWriteFor(owner.account.id, authorSigner.id)
      );
      expect((await reload(CLASS_NAME, created.id)).get('TemplateId').id).toBe(template.id);
    });

    it('lets a team member keep the placeholder signers of a shared template', async () => {
      const template = await seedAuthorTemplate({
        SharedWith: [pointer('contracts_Teams', owner.team.id)],
        Placeholders: [{ Role: 'Role 1', signerObjId: authorContact.id }],
      });

      const created = await create(
        {
          ...ownerFields(owner),
          TemplateId: pointer('contracts_Template', template.id),
          Placeholders: [
            {
              Role: 'Role 1',
              signerObjId: authorContact.id,
              signerPtr: contactPointer(authorContact.id),
            },
          ],
        },
        owner.account
      );

      const [placeholder] = (await reload(CLASS_NAME, created.id)).get('Placeholders');
      expect(placeholder.signerPtr.id).toBe(authorContact.id);
    });

    it('accepts the template id sent as a plain string', async () => {
      const template = await seedAuthorTemplate({
        SharedWithUsers: [pointer('contracts_Users', owner.extUser.id)],
      });

      const created = await createFromTemplate(template.id, authorContact);

      expect((await reload(CLASS_NAME, created.id)).get('CreatedBy').id).toBe(owner.account.id);
    });

    it('rejects the signers of a template that is not shared with the caller', async () => {
      const template = await seedAuthorTemplate();

      const failure = await captureRejection(
        createFromTemplate(pointer('contracts_Template', template.id), authorContact)
      );

      expect(failure.code).toBe(OPERATION_FORBIDDEN);
    });

    it('rejects a contact of the author that the shared template does not name', async () => {
      const template = await seedAuthorTemplate({
        SharedWith: [pointer('contracts_Teams', owner.team.id)],
      });
      const otherContact = await seedContact(author, await createPlainUser());

      const failure = await captureRejection(
        createFromTemplate(pointer('contracts_Template', template.id), otherContact)
      );

      expect(failure.code).toBe(OPERATION_FORBIDDEN);
    });
  });
});
