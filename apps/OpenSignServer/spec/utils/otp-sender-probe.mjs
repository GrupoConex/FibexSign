import { pathToFileURL } from 'node:url';
import path from 'node:path';

const sentEmails = [];

globalThis.Parse = {
  Query: class {
    equalTo() {}
    include() {}
    notEqualTo() {}
    async first() {
      return undefined;
    }
  },
  Object: {
    extend: () =>
      class {
        set() {}
        async save() {
          return {};
        }
      },
  },
  Cloud: {
    sendEmail: async payload => {
      sentEmails.push(payload);
    },
  },
};

const moduleUrl = pathToFileURL(path.resolve('cloud/parsefunction/SendMailOTPv1.js')).href;
const { default: sendMailOTPv1 } = await import(moduleUrl);
const result = await sendMailOTPv1({ params: { email: 'probe@example.com' } });
process.stdout.write(`\nPROBE:${JSON.stringify({ result, sender: sentEmails[0]?.sender })}\n`);
