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
    ]);
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
