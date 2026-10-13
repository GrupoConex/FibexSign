import {
  captureRejection,
  createCaller,
  createPlainUser,
  pointer,
  purgeCreatedAccounts,
} from '../../../spec/utils/auth-fixtures.js';
import { ownerFields, seedContact, seedTemplate } from '../../../spec/utils/document-fixtures.js';
import { buildAuthorizedDocument } from './documentDraft.js';

const CONTACT_CLASS = 'contracts_Contactbook';
const OPERATION_FORBIDDEN = 119;
const INVALID_JSON = 107;
const TRUSTED_URL = `${process.env.SERVER_URL}/files/test/a.pdf`;
const UNTRUSTED_URL = 'https://attacker.example/files/test/a.pdf';

const contactPointer = objectId => pointer(CONTACT_CLASS, objectId);

describe('documentDraft buildAuthorizedDocument', () => {
  let owner;
  let signer;
  let ownContact;

  beforeEach(async () => {
    owner = await createCaller('contracts_Admin');
    signer = await createPlainUser();
    ownContact = await seedContact(owner, signer);
  });

  afterEach(async () => {
    await purgeCreatedAccounts();
  });

  it('attributes the unsaved document to the caller and its profile', async () => {
    const victim = await createCaller('contracts_Admin');

    const { document, profile } = await buildAuthorizedDocument({
      userId: owner.account.id,
      ip: '10.0.0.1',
      doc: { Name: 'Contract', URL: TRUSTED_URL, ...ownerFields(victim) },
    });

    expect(document.isNew()).toBeTrue();
    expect(profile.id).toBe(owner.extUser.id);
    expect(document.get('CreatedBy').objectId).toBe(owner.account.id);
    expect(document.get('ExtUserPtr').objectId).toBe(owner.extUser.id);
    expect(document.get('OriginIp')).toBe('10.0.0.1');
    expect(document.get('URL')).toBe(TRUSTED_URL);
  });

  it('rejects a document or signed url outside the trusted storage', async () => {
    const build = doc =>
      captureRejection(buildAuthorizedDocument({ userId: owner.account.id, doc }));

    const byUrl = await build({ Name: 'Contract', URL: UNTRUSTED_URL });
    const bySignedUrl = await build({
      Name: 'Contract',
      URL: TRUSTED_URL,
      SignedUrl: UNTRUSTED_URL,
    });

    expect(byUrl.code).toBe(INVALID_JSON);
    expect(bySignedUrl.code).toBe(INVALID_JSON);
  });

  it('resolves the profile and template through the supplied lookups', async () => {
    const template = await seedTemplate(owner);
    const resolveProfile = jasmine.createSpy('resolveProfile').and.resolveTo(owner.extUser);
    const findTemplate = jasmine.createSpy('findTemplate').and.resolveTo(template);

    const result = await buildAuthorizedDocument({
      userId: owner.account.id,
      doc: { Name: 'Contract', TemplateId: template.id, ...ownerFields(owner) },
      lookups: { resolveProfile, findTemplate },
    });

    expect(resolveProfile).toHaveBeenCalledOnceWith(owner.account.id, owner.extUser.id);
    expect(findTemplate).toHaveBeenCalledOnceWith(owner.account.id, template.id);
    expect(result.template.id).toBe(template.id);
  });

  it('grants access to the caller and the accounts behind the signers', async () => {
    const { document, signerUserIds } = await buildAuthorizedDocument({
      userId: owner.account.id,
      doc: { Name: 'Contract', Signers: [contactPointer(ownContact.id)] },
    });

    expect(signerUserIds).toEqual([signer.id]);
    expect(document.getACL().toJSON()).toEqual({
      [owner.account.id]: { read: true, write: true },
      [signer.id]: { read: true, write: true },
    });
    expect(document.get('OriginIp')).toBe('');
  });

  it('returns the accessible template and keeps its pointer', async () => {
    const template = await seedTemplate(owner);

    const result = await buildAuthorizedDocument({
      userId: owner.account.id,
      doc: { Name: 'Contract', TemplateId: template.id },
    });

    expect(result.template.id).toBe(template.id);
    expect(result.document.get('TemplateId').objectId).toBe(template.id);
  });

  it('drops a template the caller cannot access', async () => {
    const template = await seedTemplate(await createCaller('contracts_Admin'));

    const result = await buildAuthorizedDocument({
      userId: owner.account.id,
      doc: { Name: 'Contract', TemplateId: template.id },
    });

    expect(result.template).toBeUndefined();
    expect(result.document.get('TemplateId')).toBeUndefined();
  });

  it('merges extra fields resolved from the profile and template', async () => {
    const template = await seedTemplate(owner, { RequestSubject: 'Template subject' });
    const fields = jasmine.createSpy('fields').and.callFake(async context => ({
      RequestSubject: context.template.get('RequestSubject'),
      CreatedBy: pointer('_User', 'forgedUser'),
    }));

    const { document, profile } = await buildAuthorizedDocument({
      userId: owner.account.id,
      doc: { Name: 'Contract', TemplateId: template.id },
      fields,
    });

    expect(fields.calls.mostRecent().args[0].profile.id).toBe(profile.id);
    expect(document.get('RequestSubject')).toBe('Template subject');
    expect(document.get('CreatedBy').objectId).toBe(owner.account.id);
  });

  it('rejects a contact of another user', async () => {
    const victim = await createCaller('contracts_Admin');
    const victimContact = await seedContact(victim, await createPlainUser());

    const failure = await captureRejection(
      buildAuthorizedDocument({
        userId: owner.account.id,
        doc: { Name: 'Contract', Signers: [contactPointer(victimContact.id)] },
      })
    );

    expect(failure.code).toBe(OPERATION_FORBIDDEN);
  });
});
