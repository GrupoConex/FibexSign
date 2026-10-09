import createContactIndex from './createContactIndex.js';
import createDocumentIndex from './createDocumentIndex.js';
import createNormalizedEmailUnique from './createNormalizedEmailUnqiue.js';
import lockOtpClassClp from './lockOtpClassClp.js';
import { runOtpTableMigration } from '../scripts/migrate-otp-table.js';

export const DB_MIGRATION_STEPS = Object.freeze([
  { name: 'createContactIndex', run: createContactIndex },
  { name: 'createDocumentIndex', run: createDocumentIndex },
  { name: 'createNormalizedEmailUnique', run: createNormalizedEmailUnique },
  { name: 'runOtpTableMigration', run: () => runOtpTableMigration({ argv: ['--apply'] }) },
  { name: 'lockOtpClassClp', run: () => lockOtpClassClp(), fatal: true },
]);

export default async function runDbMigrations(steps = DB_MIGRATION_STEPS) {
  for (const step of steps) {
    try {
      await step.run();
    } catch (error) {
      console.error(`ERROR Running database migration ${step.name}:`, error);
      if (step.fatal) {
        throw error;
      }
    }
  }
}
