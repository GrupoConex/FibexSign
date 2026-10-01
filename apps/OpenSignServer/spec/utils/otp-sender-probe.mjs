import { pathToFileURL } from 'node:url';
import path from 'node:path';

const sentEmails = [];
let storedRow;

globalThis.Parse = {
  Query: class {
    equalTo() {}
    ascending() {}
    addAscending() {}
    include() {}
    notEqualTo() {}
    async first() {
      return storedRow;
    }
  },
  Object: {
    extend: () =>
      class {
        attributes = {};
        set(key, value) {
          this.attributes[key] = value;
        }
        unset(key) {
          delete this.attributes[key];
        }
        increment(key, amount = 1) {
          this.attributes[key] = (this.attributes[key] || 0) + amount;
        }
        get(key) {
          return this.attributes[key];
        }
        async save() {
          storedRow = this;
          return this;
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
