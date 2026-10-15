import {
  projectContact,
  projectCopyRecipient,
  projectOwnerSigner,
  projectSigner,
} from './contactProjection.js';

const stored = {
  __type: 'Object',
  className: 'contracts_Contactbook',
  objectId: 'c1',
  Name: 'Ana',
  Email: 'ana@example.com',
  Phone: '123',
  JobTitle: 'CTO',
  Company: 'Acme',
  TourStatus: [{ requestSign: true }],
  UserId: { __type: 'Object', className: '_User', objectId: 'u1', username: 'ana', email: 'x' },
  ACL: { '*': { read: true } },
  CreatedBy: { objectId: 'u2' },
  TenantId: { objectId: 't1' },
  UserRole: 'contracts_Guest',
  IsDeleted: false,
};

describe('contactProjection', () => {
  it('keeps the public fields and reduces UserId to a pointer', () => {
    expect(projectContact(stored)).toEqual({
      __type: 'Object',
      className: 'contracts_Contactbook',
      objectId: 'c1',
      Name: 'Ana',
      Email: 'ana@example.com',
      JobTitle: 'CTO',
      Company: 'Acme',
      TourStatus: [{ requestSign: true }],
      UserId: { __type: 'Pointer', className: '_User', objectId: 'u1' },
    });
  });

  it('keeps an unresolved UserId pointer', () => {
    const pointer = { __type: 'Pointer', className: '_User', objectId: 'u1' };

    expect(projectContact({ ...stored, UserId: pointer }).UserId).toEqual(pointer);
  });

  it('omits UserId when the contact has none', () => {
    expect('UserId' in projectContact({ ...stored, UserId: undefined })).toBeFalse();
  });

  it('keeps the tour status in the contact projection only', () => {
    expect(projectContact(stored).TourStatus).toEqual([{ requestSign: true }]);
    expect(projectSigner(stored).TourStatus).toBeUndefined();
    expect(projectOwnerSigner(stored).TourStatus).toBeUndefined();
  });

  it('keeps the signer public fields and reduces UserId to a pointer', () => {
    expect(projectSigner(stored)).toEqual({
      __type: 'Object',
      className: 'contracts_Contactbook',
      objectId: 'c1',
      Name: 'Ana',
      Email: 'ana@example.com',
      JobTitle: 'CTO',
      Company: 'Acme',
      UserId: { __type: 'Pointer', className: '_User', objectId: 'u1' },
    });
  });

  it('adds the phone only in the owner signer projection', () => {
    expect(projectSigner(stored).Phone).toBeUndefined();
    expect(projectContact(stored).Phone).toBeUndefined();
    expect(projectOwnerSigner(stored).Phone).toBe('123');
  });

  it('reduces a copy recipient to its id, name, email and phone', () => {
    expect(projectCopyRecipient(stored)).toEqual({
      __type: 'Object',
      className: 'contracts_Contactbook',
      objectId: 'c1',
      Name: 'Ana',
      Email: 'ana@example.com',
      Phone: '123',
    });
  });

  it('passes through copy recipients that are not objects', () => {
    expect(projectCopyRecipient(null)).toBeNull();
    expect(projectCopyRecipient('c1')).toBe('c1');
  });

  it('passes through entries that are not objects', () => {
    expect(projectContact(null)).toBeNull();
    expect(projectContact('c1')).toBe('c1');
  });

  it('does not mutate its input', () => {
    const snapshot = JSON.stringify(stored);

    projectContact(stored);

    expect(JSON.stringify(stored)).toBe(snapshot);
  });
});
