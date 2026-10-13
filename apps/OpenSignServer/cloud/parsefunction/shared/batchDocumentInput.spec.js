import {
  MAX_BATCH_DOCUMENTS,
  MAX_COPY_RECIPIENTS,
  MAX_PARTICIPANTS,
  MAX_RECIPIENTS_PER_CALL,
  contactReferencesOf,
  parseBatchDocuments,
  toDraftInput,
} from './batchDocumentInput.js';

const INVALID_JSON = 107;
const URL = `${process.env.SERVER_URL}/files/test/a.pdf`;

const contactPointer = objectId => ({
  __type: 'Pointer',
  className: 'contracts_Contactbook',
  objectId,
});

const plainContact = (objectId, Email = `${objectId}@example.com`) => ({
  objectId,
  Email,
  UserId: { __type: 'Pointer', className: '_User', objectId: `user-${objectId}` },
});

const emailPlaceholders = count =>
  Array.from({ length: count }, (_, index) => ({
    Role: `Signer ${index}`,
    email: `s${index}@example.com`,
  }));

const copies = (prefix, count) =>
  Array.from({ length: count }, (_, index) => plainContact(`${prefix}${index}`));

const failureOf = run => {
  try {
    run();
    return null;
  } catch (error) {
    return error;
  }
};

describe('batchDocumentInput', () => {
  describe('parseBatchDocuments', () => {
    it('accepts a json string or an array of document objects', () => {
      expect(parseBatchDocuments(JSON.stringify([{ URL }]))).toEqual([{ URL }]);
      expect(parseBatchDocuments([{ URL }])).toEqual([{ URL }]);
    });

    it('rejects anything that is not 1 to 50 document objects with a trusted url', () => {
      const tooMany = Array.from({ length: MAX_BATCH_DOCUMENTS + 1 }, () => ({ URL }));
      const invalidInputs = [
        undefined,
        '{not json',
        '{}',
        '[]',
        '["text"]',
        [null],
        [[{ URL }]],
        [{ Name: 'No url' }],
        [{ URL: 42 }],
        [{ URL: 'https://attacker.example/files/test/a.pdf' }],
        tooMany,
      ];

      invalidInputs.forEach(input => {
        expect(failureOf(() => parseBatchDocuments(input))?.code)
          .withContext(JSON.stringify(input)?.slice(0, 40) ?? 'undefined')
          .toBe(INVALID_JSON);
      });
    });

    it('rejects an email placeholder without a valid email', () => {
      const failure = failureOf(() =>
        parseBatchDocuments([
          { URL, Placeholders: [{ Role: 'Signer 1', signerPtr: '', email: 'not an email' }] },
        ])
      );

      expect(failure?.code).toBe(INVALID_JSON);
    });

    it('caps the participants and copy recipients of a document', () => {
      const prefill = { Role: 'prefill', signerPtr: {} };
      const overCaps = [
        { URL, Placeholders: emailPlaceholders(MAX_PARTICIPANTS + 1) },
        { URL, Bcc: copies('b', MAX_COPY_RECIPIENTS + 1) },
        { URL, Cc: copies('c', MAX_COPY_RECIPIENTS + 1) },
      ];

      overCaps.forEach(item =>
        expect(failureOf(() => parseBatchDocuments([item]))?.code).toBe(INVALID_JSON)
      );
      const atCap = [{ URL, Placeholders: [prefill, ...emailPlaceholders(MAX_PARTICIPANTS)] }];
      expect(parseBatchDocuments(atCap).length).toBe(1);
    });

    it('caps the recipients of the whole call', () => {
      const perDocument = MAX_PARTICIPANTS + 2 * MAX_COPY_RECIPIENTS;
      const documentCount = Math.floor(MAX_RECIPIENTS_PER_CALL / perDocument) + 1;
      const fullDocument = {
        URL,
        Placeholders: emailPlaceholders(MAX_PARTICIPANTS),
        Bcc: copies('b', MAX_COPY_RECIPIENTS),
        Cc: copies('c', MAX_COPY_RECIPIENTS),
      };

      const failure = failureOf(() =>
        parseBatchDocuments(Array.from({ length: documentCount }, () => fullDocument))
      );

      expect(documentCount).toBeLessThanOrEqual(MAX_BATCH_DOCUMENTS);
      expect(failure?.code).toBe(INVALID_JSON);
    });

    it('accepts exactly the maximum number of documents', () => {
      const documents = Array.from({ length: MAX_BATCH_DOCUMENTS }, () => ({ URL }));

      expect(parseBatchDocuments(documents).length).toBe(MAX_BATCH_DOCUMENTS);
    });
  });

  describe('toDraftInput', () => {
    it('keeps only allowed fields and adds the batch fields', () => {
      const input = toDraftInput({
        URL,
        Name: 'Contract',
        Note: 'note',
        ACL: { '*': { read: true } },
        CreatedBy: { __type: 'Pointer', className: '_User', objectId: 'victim' },
        SenderMail: 'attacker@example.com',
        RequestBody: '<p>forged</p>',
        IsArchive: true,
      });

      expect(input).toEqual(
        jasmine.objectContaining({ URL, Name: 'Contract', Note: 'note', SignedUrl: URL })
      );
      expect(input.SentToOthers).toBeTrue();
      ['ACL', 'CreatedBy', 'SenderMail', 'RequestBody', 'IsArchive'].forEach(field =>
        expect(input[field]).withContext(field).toBeUndefined()
      );
    });

    it('takes the template from the object id and the profile as a bare pointer', () => {
      const input = toDraftInput({
        URL,
        objectId: 'template1',
        ExtUserPtr: { objectId: 'profile1', Email: 'x@example.com', TenantId: {} },
      });

      expect(input.TemplateId).toBe('template1');
      expect(input.ExtUserPtr).toEqual({
        __type: 'Pointer',
        className: 'contracts_Users',
        objectId: 'profile1',
      });
      expect(toDraftInput({ URL }).TemplateId).toBeUndefined();
    });

    it('sends in order unless explicitly disabled and coerces the other flags', () => {
      expect(toDraftInput({ URL, SendinOrder: true }).SendinOrder).toBeTrue();
      expect(toDraftInput({ URL, SendinOrder: false }).SendinOrder).toBeFalse();
      expect(toDraftInput({ URL, SendinOrder: 'no' }).SendinOrder).toBeTrue();
      expect(toDraftInput({ URL }).SendinOrder).toBeTrue();
      expect(toDraftInput({ URL, IsEnableOTP: 'yes' }).IsEnableOTP).toBeFalse();
      expect(toDraftInput({ URL, NotifyOnSignatures: true }).NotifyOnSignatures).toBeTrue();
    });

    it('defaults reminder and completion days unless they are positive integers', () => {
      expect(toDraftInput({ URL })).toEqual(
        jasmine.objectContaining({ RemindOnceInEvery: 5, TimeToCompleteDays: 15 })
      );
      expect(toDraftInput({ URL, RemindOnceInEvery: '3', TimeToCompleteDays: 'x' })).toEqual(
        jasmine.objectContaining({ RemindOnceInEvery: 3, TimeToCompleteDays: 15 })
      );
      expect(toDraftInput({ URL, TimeToCompleteDays: -2 }).TimeToCompleteDays).toBe(15);
    });

    it('drops prefill roles and turns picked contacts into bare pointers', () => {
      const input = toDraftInput({
        URL,
        Placeholders: [
          { Role: 'prefill', signerPtr: {} },
          { Role: 'Signer 1', signerObjId: 'c1', signerPtr: plainContact('c1') },
          { Role: 'Signer 2', signerObjId: 'stale', signerPtr: '', email: ' Typed@Example.com ' },
        ],
      });

      expect(input.Placeholders).toEqual([
        { Role: 'Signer 1', signerObjId: 'c1', signerPtr: contactPointer('c1') },
        { Role: 'Signer 2', signerObjId: '', signerPtr: {}, email: 'typed@example.com' },
      ]);
    });

    it('takes the signer id from the contact pointer and drops the client email', () => {
      const input = toDraftInput({
        URL,
        Placeholders: [
          {
            Role: 'Signer 1',
            signerObjId: 'victimContact',
            signerPtr: plainContact('c1'),
            email: 'attacker@example.com',
          },
        ],
      });

      expect(input.Placeholders).toEqual([
        { Role: 'Signer 1', signerObjId: 'c1', signerPtr: contactPointer('c1') },
      ]);
    });

    it('keeps only the known placeholder keys', () => {
      const widgets = [{ pageNumber: 1, pos: [] }];
      const known = {
        Id: 7,
        Role: 'Signer 1',
        role: 'viewer',
        SignerRole: 'viewer',
        signer_role: 'viewer',
        blockColor: '#fff',
        placeHolder: widgets,
      };
      const input = toDraftInput({
        URL,
        Placeholders: [
          { ...known, email: 'typed@example.com', UserId: { objectId: 'victim' }, Extra: 'x' },
        ],
      });

      expect(input.Placeholders).toEqual([
        { ...known, signerObjId: '', signerPtr: {}, email: 'typed@example.com' },
      ]);
    });

    it('derives the signers from the placeholders in order', () => {
      const included = {
        ...plainContact('c2'),
        __type: 'Object',
        className: 'contracts_Contactbook',
      };
      const input = toDraftInput({
        URL,
        Signers: [plainContact('ignored')],
        Placeholders: [
          { Role: 'Signer 1', signerObjId: 'c2', signerPtr: included },
          { Role: 'Signer 2', signerObjId: 'c1', signerPtr: plainContact('c1') },
          { Role: 'Signer 3', signerObjId: 'c2', signerPtr: included },
        ],
      });

      expect(input.Signers).toEqual([contactPointer('c2'), contactPointer('c1')]);
    });

    it('drops empty copy recipients and converts picked ones', () => {
      const input = toDraftInput({ URL, Bcc: [{}, '', null, plainContact('c3')], Cc: 'x' });

      expect(input.Bcc).toEqual([contactPointer('c3')]);
      expect(input.Cc).toEqual([]);
    });

    it('keeps a malformed contact reference for the authorization step to reject', () => {
      const malformed = { Email: 'no-id@example.com' };

      const input = toDraftInput({
        URL,
        Placeholders: [{ Role: 'Signer 1', signerPtr: malformed }],
      });

      expect(input.Placeholders[0].signerPtr).toEqual(malformed);
      expect(input.Signers).toEqual([]);
    });
  });

  describe('contactReferencesOf', () => {
    it('lists every client supplied contact object', () => {
      const signer = plainContact('c1');
      const bcc = plainContact('c2');
      const placeholderContact = plainContact('c3');

      const references = contactReferencesOf({
        Signers: [signer, ''],
        Bcc: [bcc],
        Placeholders: [{ signerPtr: placeholderContact }, { signerPtr: '' }],
      });

      expect(references).toEqual([placeholderContact, signer, bcc]);
    });
  });
});
