import { knownDefect } from './known-defect.js';

describe('knownDefect', () => {
  beforeEach(() => {
    spyOn(globalThis, 'pending');
    spyOn(globalThis, 'fail');
  });

  it('marks the spec pending with the defect id when the body reports a violation', async () => {
    const runSpec = knownDefect('SEC-99', 'description of the defect', async check => {
      check(false, 'contract violated');
    });

    await runSpec();

    expect(globalThis.pending).toHaveBeenCalledOnceWith(
      'KNOWN DEFECT SEC-99: description of the defect'
    );
    expect(globalThis.fail).not.toHaveBeenCalled();
  });

  it('marks the spec pending when only some checks are violated', async () => {
    const runSpec = knownDefect('SEC-98', 'partial', async check => {
      check(true, 'holds');
      check(false, 'does not hold');
    });

    await runSpec();

    expect(globalThis.pending).toHaveBeenCalledTimes(1);
    expect(globalThis.fail).not.toHaveBeenCalled();
  });

  it('fails the spec when every check holds because the defect appears fixed', async () => {
    const runSpec = knownDefect('SEC-97', 'already fixed', async check => {
      check(true, 'holds');
    });

    await runSpec();

    expect(globalThis.fail).toHaveBeenCalledOnceWith(
      'Known defect SEC-97 appears fixed; remove the marker'
    );
    expect(globalThis.pending).not.toHaveBeenCalled();
  });

  it('fails the spec when the body performs no checks at all', async () => {
    const runSpec = knownDefect('SEC-96', 'no checks', async () => {});

    await runSpec();

    expect(globalThis.fail).toHaveBeenCalledOnceWith('Known defect SEC-96 performed no checks');
    expect(globalThis.pending).not.toHaveBeenCalled();
  });

  it('propagates errors thrown by the body as real failures', async () => {
    const runSpec = knownDefect('SEC-95', 'setup broken', async () => {
      throw new Error('setup exploded');
    });

    await expectAsync(runSpec()).toBeRejectedWithError('setup exploded');
    expect(globalThis.pending).not.toHaveBeenCalled();
    expect(globalThis.fail).not.toHaveBeenCalled();
  });
});
