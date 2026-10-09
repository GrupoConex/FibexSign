import runDbMigrations, { DB_MIGRATION_STEPS } from '../../migrationdb/index.js';
import { captureConsoleError } from '../utils/auth-fixtures.js';

const buildStep = (name, calls, behavior = async () => undefined) => ({
  name,
  run: async () => {
    calls.push(name);
    return behavior();
  },
});

describe('runDbMigrations', () => {
  it('declares the contact, document, email and otp migrations in order', () => {
    expect(DB_MIGRATION_STEPS.map(step => step.name)).toEqual([
      'createContactIndex',
      'createDocumentIndex',
      'createNormalizedEmailUnique',
      'runOtpTableMigration',
      'lockOtpClassClp',
    ]);
  });

  it('rejects when the OTP class lock fails so the server never starts open', async () => {
    const consoleError = captureConsoleError();
    const failure = new Error('mongo unavailable');
    const lockStep = DB_MIGRATION_STEPS.find(step => step.name === 'lockOtpClassClp');
    const calls = [];
    const steps = [
      { ...lockStep, run: async () => Promise.reject(failure) },
      buildStep('after', calls),
    ];

    await expectAsync(runDbMigrations(steps)).toBeRejectedWith(failure);

    expect(calls).toEqual([]);
    expect(consoleError.calls.mostRecent().args[0]).toContain('lockOtpClassClp');
  });

  it('keeps index steps non fatal while only the OTP class lock is fatal', () => {
    const fatalNames = DB_MIGRATION_STEPS.filter(step => step.fatal).map(step => step.name);

    expect(fatalNames).toEqual(['lockOtpClassClp']);
  });

  it('runs every step one after another in the declared order', async () => {
    const calls = [];
    const steps = ['first', 'second', 'third'].map(name =>
      buildStep(name, calls, () => new Promise(resolve => setTimeout(resolve, 5)))
    );

    await runDbMigrations(steps);

    expect(calls).toEqual(['first', 'second', 'third']);
  });

  it('keeps going and logs the failing step instead of blocking startup', async () => {
    const consoleError = captureConsoleError();
    const calls = [];
    const failure = new Error('index build failed');
    const steps = [
      buildStep('first', calls),
      buildStep('second', calls, async () => {
        throw failure;
      }),
      buildStep('third', calls),
    ];

    await expectAsync(runDbMigrations(steps)).toBeResolved();

    expect(calls).toEqual(['first', 'second', 'third']);
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError.calls.mostRecent().args[0]).toContain('second');
    expect(consoleError.calls.mostRecent().args[1]).toBe(failure);
  });

  it('logs every failing step', async () => {
    const consoleError = captureConsoleError();
    const failing = name =>
      buildStep(name, [], async () => {
        throw new Error(`${name} failed`);
      });

    await runDbMigrations([failing('one'), failing('two')]);

    expect(consoleError).toHaveBeenCalledTimes(2);
  });
});
