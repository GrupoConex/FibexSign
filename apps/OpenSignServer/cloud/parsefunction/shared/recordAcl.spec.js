import { buildPrivateAcl } from './recordAcl.js';

const readWrite = { read: true, write: true };

describe('buildPrivateAcl', () => {
  it('grants read and write to every listed user', () => {
    const acl = buildPrivateAcl(['owner1', 'signer1']);

    expect(acl.toJSON()).toEqual({ owner1: readWrite, signer1: readWrite });
  });

  it('returns a Parse ACL without public access', () => {
    const acl = buildPrivateAcl(['owner1']);

    expect(acl).toEqual(jasmine.any(Parse.ACL));
    expect(acl.getPublicReadAccess()).toBeFalse();
    expect(acl.getPublicWriteAccess()).toBeFalse();
  });

  it('lists a repeated user once', () => {
    expect(Object.keys(buildPrivateAcl(['owner1', 'owner1']).toJSON())).toEqual(['owner1']);
  });

  it('skips empty and non string ids', () => {
    const acl = buildPrivateAcl(['owner1', '', null, undefined, 42, {}]);

    expect(acl.toJSON()).toEqual({ owner1: readWrite });
  });

  it('locks the record to the master key when no user is listed', () => {
    expect(buildPrivateAcl([]).toJSON()).toEqual({});
    expect(buildPrivateAcl(undefined).toJSON()).toEqual({});
  });

  it('does not mutate the received ids', () => {
    const ids = Object.freeze(['owner1', 'owner1']);

    expect(() => buildPrivateAcl(ids)).not.toThrow();
    expect(ids).toEqual(['owner1', 'owner1']);
  });
});
