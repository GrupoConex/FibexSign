import http from 'http';
import { ParseServer } from 'parse-server';
import { MongoClient } from 'mongodb';
import { OTP_COLLECTION, migrateOtpTable } from '../../scripts/migrate-otp-table.js';
import { app, config } from '../../index.js';

export const dropDB = async () => {
  await Parse.User.logOut();
  return await Parse.Server.database.deleteEverything(true);
};
let parseServerState = {};

async function ensureOtpUniqueness(databaseURI) {
  const client = new MongoClient(databaseURI);
  await client.connect();
  try {
    await migrateOtpTable({ collection: client.db().collection(OTP_COLLECTION), apply: true });
  } finally {
    await client.close();
  }
}

/**
 * Starts the ParseServer instance
 * @param {Object} parseServerOptions Used for creating the `ParseServer`
 * @return {Promise} Runner state
 */
export async function startParseServer() {
  delete config.databaseAdapter;
  const parseServerOptions = Object.assign(config, {
    databaseURI: 'mongodb://localhost:27017/parse-test',
    masterKey: 'test',
    javascriptKey: 'test',
    appId: 'test',
    port: 30001,
    mountPath: '/test',
    serverURL: `http://localhost:30001/test`,
    logLevel: 'error',
    silent: true,
  });
  const parseServer = new ParseServer(parseServerOptions);
  await parseServer.start();
  await ensureOtpUniqueness(parseServerOptions.databaseURI);
  app.use(parseServerOptions.mountPath, parseServer.app);
  const httpServer = http.createServer(app);
  await new Promise(resolve => httpServer.listen(parseServerOptions.port, resolve));
  Object.assign(parseServerState, {
    parseServer,
    httpServer,
    parseServerOptions,
  });
  return parseServerOptions;
}

/**
 * Stops the ParseServer instance
 * @return {Promise}
 */
export async function stopParseServer() {
  await new Promise(resolve => parseServerState.httpServer.close(resolve));
  parseServerState = {};
}
