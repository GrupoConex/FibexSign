import axios from 'axios';
import {
  captureRejection,
  createCaller,
  createPlainUser,
  pointer,
  purgeCreatedAccounts,
  silenceConsole,
  waitUntil,
} from '../utils/auth-fixtures.js';
import {
  contactPlaceholder,
  countDocumentsOf,
  documentsCreatedBy,
  emailPlaceholder,
  pickedContact,
  plainDocument,
  sendBatch,
  templateItem,
} from '../utils/batch-fixtures.js';
import { useCommsMailCapture } from '../utils/delete-account-fixtures.js';
import {
  aclOf,
  documentCountOf,
  readWriteFor,
  reload,
  seedContact,
  seedTemplate,
  trustedFileUrl,
} from '../utils/document-fixtures.js';

const DOCUMENT_CLASS = 'contracts_Document';
const OPERATION_FORBIDDEN = 119;

const contactPointer = objectId => pointer('contracts_Contactbook', objectId);

const teamAncestorsOf = async team =>
  (await reload('contracts_Teams', team.id)).get('Ancestors') ?? [];

describe('batchdocuments authorization', () => {
  const mail = useCommsMailCapture();
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

  const ownDocument = (fields = {}) =>
    plainDocument({
      Placeholders: [contactPlaceholder('Signer 1', pickedContact(ownContact))],
      ...fields,
    });

  describe('ownership', () => {
    let victim;

    beforeEach(async () => {
      victim = await createCaller('contracts_Admin');
    });

    it('ignores a forged creator and profile and charges the caller', async () => {
      const forged = ownDocument({
        CreatedBy: pointer('_User', victim.account.id),
        ExtUserPtr: pointer('contracts_Users', victim.extUser.id),
      });

      await sendBatch([forged], owner.account);

      const [created] = await documentsCreatedBy(owner.account);
      expect(created.get('ExtUserPtr').id).toBe(owner.extUser.id);
      expect(await countDocumentsOf(victim.account)).toBe(0);
      expect(await documentCountOf(victim.extUser)).toBe(0);
      expect(await documentCountOf(owner.extUser)).toBe(1);
    });

    it('rejects a foreign signer without an accessible template and saves nothing', async () => {
      const victimContact = await seedContact(victim, await createPlainUser());
      const victimTemplate = await seedTemplate(victim);

      const failure = await captureRejection(
        sendBatch(
          [
            ownDocument({
              objectId: victimTemplate.id,
              Placeholders: [contactPlaceholder('Signer 1', pickedContact(victimContact))],
            }),
          ],
          owner.account
        )
      );

      expect(failure.code).toBe(OPERATION_FORBIDDEN);
      expect(await countDocumentsOf(owner.account)).toBe(0);
      expect(mail.sent).toEqual([]);
    });

    it('rejects the whole batch when one item names a foreign signer', async () => {
      const victimContact = await seedContact(victim, await createPlainUser());
      const foreign = ownDocument({
        Placeholders: [contactPlaceholder('Signer 1', pickedContact(victimContact))],
      });

      const failure = await captureRejection(sendBatch([ownDocument(), foreign], owner.account));

      expect(failure.code).toBe(OPERATION_FORBIDDEN);
      expect(await countDocumentsOf(owner.account)).toBe(0);
    });

    it('rejects a plain contact object that claims a foreign account', async () => {
      const forgedContact = {
        ...pickedContact(ownContact),
        UserId: pointer('_User', victim.account.id),
      };

      const failure = await captureRejection(
        sendBatch(
          [ownDocument({ Placeholders: [contactPlaceholder('Signer 1', forgedContact)] })],
          owner.account
        )
      );

      expect(failure.code).toBe(OPERATION_FORBIDDEN);
      expect(await countDocumentsOf(owner.account)).toBe(0);
    });

    it('does not store a template the caller cannot access', async () => {
      const victimTemplate = await seedTemplate(victim);

      await sendBatch([ownDocument({ objectId: victimTemplate.id })], owner.account);

      const [created] = await documentsCreatedBy(owner.account);
      expect(created.get('TemplateId')).toBeUndefined();
    });
  });

  describe('templates of another user', () => {
    let author;
    let authorSigner;
    let authorContact;

    beforeEach(async () => {
      author = await createCaller('contracts_Admin');
      authorSigner = await createPlainUser();
      authorContact = await seedContact(author, authorSigner);
    });

    const seedAuthorTemplate = fields =>
      seedTemplate(author, {
        Signers: [contactPointer(authorContact.id)],
        Placeholders: [
          {
            Id: 1,
            Role: 'Signer 1',
            signerObjId: authorContact.id,
            signerPtr: contactPointer(authorContact.id),
          },
        ],
        ...fields,
      });

    const sendFromTemplate = async template => {
      const item = await templateItem(template);
      return sendBatch([{ ...item, URL: trustedFileUrl('template.pdf') }], owner.account);
    };

    it('allows the contacts of a template shared with the caller profile', async () => {
      const template = await seedAuthorTemplate({
        SharedWithUsers: [pointer('contracts_Users', owner.extUser.id)],
      });

      await sendFromTemplate(template);

      const [created] = await documentsCreatedBy(owner.account);
      expect(created.get('TemplateId').id).toBe(template.id);
      expect(created.get('CreatedBy').id).toBe(owner.account.id);
      expect(created.get('ExtUserPtr').id).toBe(owner.extUser.id);
      expect(await aclOf(DOCUMENT_CLASS, created.id)).toEqual(
        readWriteFor(owner.account.id, authorSigner.id)
      );
    });

    it('allows the contacts of a template shared with the caller team', async () => {
      await waitUntil(async () => (await teamAncestorsOf(owner.team)).length > 0);
      const template = await seedAuthorTemplate({
        SharedWith: [pointer('contracts_Teams', owner.team.id)],
      });

      await sendFromTemplate(template);

      const [created] = await documentsCreatedBy(owner.account);
      expect(created.get('TemplateId').id).toBe(template.id);
      expect(await documentCountOf(author.extUser)).toBe(0);
    });

    it('rejects the contacts of a template that is not shared', async () => {
      const template = await seedAuthorTemplate();

      const failure = await captureRejection(sendFromTemplate(template));

      expect(failure.code).toBe(OPERATION_FORBIDDEN);
      expect(await countDocumentsOf(owner.account)).toBe(0);
    });
  });

  describe('stored documents', () => {
    it('grants access to the caller and the signer accounts only', async () => {
      const secondSigner = await createPlainUser();
      const secondContact = await seedContact(owner, secondSigner);
      const document = ownDocument({
        Placeholders: [
          contactPlaceholder('Signer 1', pickedContact(ownContact), 1),
          contactPlaceholder('Signer 2', pickedContact(secondContact), 2),
        ],
      });

      await sendBatch([document], owner.account);

      const [created] = await documentsCreatedBy(owner.account);
      expect(await aclOf(DOCUMENT_CLASS, created.id)).toEqual(
        readWriteFor(owner.account.id, signer.id, secondSigner.id)
      );
      expect(created.get('Signers').map(row => row.id)).toEqual([ownContact.id, secondContact.id]);
    });

    it('creates every requested document and charges each of them', async () => {
      const documents = [1, 2, 3].map(index =>
        plainDocument({
          Name: `Contract ${index}`,
          Placeholders: [emailPlaceholder('Signer 1', `signer${index}@example.com`)],
        })
      );

      const result = await sendBatch(documents, owner.account);

      const created = await documentsCreatedBy(owner.account);
      expect(created.map(row => row.get('Name')).sort()).toEqual([
        'Contract 1',
        'Contract 2',
        'Contract 3',
      ]);
      expect(result).toEqual({ total: 3, created: 3, failed: 0 });
      expect(await documentCountOf(owner.extUser)).toBe(3);
    });

    it('honors a disabled send in order and the batch fields', async () => {
      await sendBatch([ownDocument({ SendinOrder: false })], owner.account);

      const [created] = await documentsCreatedBy(owner.account);
      expect(created.get('SendinOrder')).toBeFalse();
      expect(created.get('SentToOthers')).toBeTrue();
      expect(created.get('SignedUrl')).toBe(created.get('URL'));
      expect(created.get('DocSentAt')).toEqual(jasmine.any(Date));
    });

    it('keeps send in order when requested', async () => {
      await sendBatch([ownDocument({ SendinOrder: true })], owner.account);

      const [created] = await documentsCreatedBy(owner.account);
      expect(created.get('SendinOrder')).toBeTrue();
    });

    it('creates the documents in process without a REST batch or a sessiontoken header', async () => {
      const post = spyOn(axios, 'post').and.callThrough();

      await sendBatch([ownDocument()], owner.account);

      const batchCalls = post.calls.allArgs().filter(([url]) => /\/batch$/.test(String(url)));
      expect(batchCalls).toEqual([]);
      expect(await countDocumentsOf(owner.account)).toBe(1);
    });
  });

  describe('bulk send payload from the frontend', () => {
    it('works for the template owner with picked own contacts', async () => {
      const preset = await seedContact(owner, await createPlainUser());
      const template = await seedTemplate(owner, {
        Signers: [contactPointer(preset.id)],
        Placeholders: [
          { Id: 1, Role: 'Signer 1', signerObjId: preset.id, signerPtr: contactPointer(preset.id) },
          { Id: 2, Role: 'Signer 2', signerObjId: '', signerPtr: {}, email: '' },
        ],
      });
      const item = await templateItem(template);
      const picked = pickedContact(ownContact);

      await sendBatch(
        [
          {
            ...item,
            URL: trustedFileUrl('template.pdf'),
            Placeholders: [item.Placeholders[0], contactPlaceholder('Signer 2', picked, 2)],
            Signers: [...item.Signers, picked],
          },
        ],
        owner.account
      );

      const [created] = await documentsCreatedBy(owner.account);
      expect(created.get('TemplateId').id).toBe(template.id);
      expect(created.get('Signers').map(row => row.id)).toEqual([preset.id, ownContact.id]);
    });
  });
});
