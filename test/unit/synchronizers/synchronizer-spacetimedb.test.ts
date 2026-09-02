import {createMergeableStore} from 'tinybase';
import {Message} from 'tinybase/synchronizers';
import {createSpacetimeDbSynchronizer} from 'tinybase/synchronizers/synchronizer-spacetimedb';
import {expect, test, vi} from 'vitest';
import {pause} from '../common/other.ts';
import {createMockSyncServer} from '../common/spacetimedb.ts';

const CONTENT_HASHES = JSON.stringify([null, Message.ContentHashes, [1, 1]]);

// The server-side filter: this channel, from other clients, broadcast or
// addressed to this client.
const channelQuery = (channelName: string) => ({
  allOf: [
    {
      allOf: [
        {eq: ['channel', channelName]},
        {ne: ['fromClientId', expect.any(String)]},
      ],
    },
    {
      anyOf: [
        {eq: ['toClientId', '']},
        {eq: ['toClientId', expect.any(String)]},
      ],
    },
  ],
});

test('synchronizes two stores through the event table', async () => {
  const server = createMockSyncServer();
  const store1 = createMergeableStore();
  const store2 = createMergeableStore();
  const connection1 = server.createConnection();
  const connection2 = server.createConnection();
  const synchronizer1 = createSpacetimeDbSynchronizer(store1, connection1);
  const synchronizer2 = createSpacetimeDbSynchronizer(store2, connection2);

  await synchronizer1.startSync();
  await synchronizer2.startSync();
  store1.setTables({pets: {fido: {species: 'dog'}}});
  store2.setTables({pets: {felix: {species: 'cat'}}});
  await pause(50);

  expect(store1.getTables()).toEqual({
    pets: {fido: {species: 'dog'}, felix: {species: 'cat'}},
  });
  expect(store2.getTables()).toEqual(store1.getTables());
  expect(server.subscriptions).toHaveLength(2);
  expect(server.subscriptions[0].queries).toEqual([
    {table: 'tinybaseSync', where: channelQuery('tinybase')},
  ]);
  // Each client filters out its own Id.
  const ownIds = server.subscriptions.map(
    ({queries: [{where}]}) => where.allOf[0].allOf[1].ne[1],
  );
  expect(ownIds[0]).not.toBe(ownIds[1]);

  await synchronizer1.destroy();
  await synchronizer2.destroy();
  expect(connection1.db.tinybaseSync.callbacks.size).toBe(0);
  expect(connection2.db.tinybaseSync.callbacks.size).toBe(0);
  expect(server.subscriptions[0].unsubscribe).toHaveBeenCalledOnce();
  expect(server.subscriptions[1].unsubscribe).toHaveBeenCalledOnce();
});

test('honors configured channel, table and reducer names', async () => {
  const server = createMockSyncServer({
    tableName: 'syncEvents',
    reducerName: 'publishSyncEvent',
  });
  const connection = server.createConnection();
  const synchronizer = createSpacetimeDbSynchronizer(
    createMergeableStore(),
    connection,
    {
      channelName: 'room1',
      tableName: 'syncEvents',
      reducerName: 'publishSyncEvent',
      requestTimeoutSeconds: 0.01,
    },
  );

  expect(synchronizer.getChannelName()).toBe('room1');
  expect(synchronizer.getDbConnection()).toBe(connection);
  expect(server.subscriptions[0].queries).toEqual([
    {table: 'syncEvents', where: channelQuery('room1')},
  ]);

  await synchronizer.startSync();
  expect(connection.reducers.publishSyncEvent).toHaveBeenCalledWith({
    channel: 'room1',
    fromClientId: expect.any(String),
    toClientId: '',
    payload: expect.any(String),
  });
  const {payload} = connection.reducers.publishSyncEvent.mock.calls[0][0];
  expect(JSON.parse(payload)).toEqual([
    expect.any(String),
    Message.GetContentHashes,
    expect.anything(),
  ]);

  await synchronizer.destroy();
});

test('takes a channel name as a string', async () => {
  const server = createMockSyncServer();
  const synchronizer = createSpacetimeDbSynchronizer(
    createMergeableStore(),
    server.createConnection(),
    'room2',
  );

  expect(synchronizer.getChannelName()).toBe('room2');
  expect(server.subscriptions[0].queries).toEqual([
    {table: 'tinybaseSync', where: channelQuery('room2')},
  ]);

  await synchronizer.destroy();
});

test('validates messages', async () => {
  const errors: Error[] = [];
  const onReceive = vi.fn();
  const server = createMockSyncServer();
  const connection = server.createConnection();
  const synchronizer = createSpacetimeDbSynchronizer(
    createMergeableStore(),
    connection,
    undefined,
    undefined,
    onReceive,
    (error) => errors.push(error),
  );
  const event = (row: {[column: string]: any}) =>
    connection.db.tinybaseSync.insert({
      channel: 'tinybase',
      fromClientId: 'peer',
      toClientId: '',
      payload: CONTENT_HASHES,
      ...row,
    });

  event({payload: 'not json'});
  event({payload: '[1]'});
  event({payload: 42});
  event({payload: JSON.stringify([null, Message.GetTableDiff, null])});
  await pause();
  expect(errors.map(({message}) => message)).toEqual([
    'tinybase:14',
    'tinybase:14',
    'tinybase:14',
    'tinybase:14',
  ]);
  expect(onReceive).not.toHaveBeenCalled();

  await synchronizer.destroy();
});

test('ignores other channels, other recipients, and itself', async () => {
  const errors: Error[] = [];
  const onReceive = vi.fn();
  const server = createMockSyncServer();
  const connection = server.createConnection();
  const synchronizer = createSpacetimeDbSynchronizer(
    createMergeableStore(),
    connection,
    {requestTimeoutSeconds: 0.01},
    undefined,
    onReceive,
    (error) => errors.push(error),
  );
  const event = (row: {[column: string]: any}) =>
    connection.db.tinybaseSync.insert({
      channel: 'tinybase',
      fromClientId: 'peer',
      toClientId: '',
      payload: CONTENT_HASHES,
      ...row,
    });

  event({channel: 'other'});
  event({toClientId: 'someone-else'});
  event({fromClientId: 42});
  connection.db.tinybaseSync.insert(
    Object.defineProperty({}, 'channel', {
      get: () => {
        throw new Error('bad row');
      },
    }),
  );
  connection.db.tinybaseSync.other({
    channel: 'tinybase',
    fromClientId: 'peer',
    toClientId: '',
    payload: CONTENT_HASHES,
  });
  await pause();
  expect(onReceive).not.toHaveBeenCalled();

  // Its own messages come back through the event table and are ignored.
  await synchronizer.startSync();
  await pause(20);
  const {fromClientId} = connection.reducers.sendTinybaseSync.mock.calls[0][0];
  event({fromClientId});
  event({toClientId: fromClientId});
  await pause();
  expect(onReceive).toHaveBeenCalledTimes(1);
  expect(onReceive).toHaveBeenCalledWith(
    'peer',
    null,
    Message.ContentHashes,
    [1, 1],
  );
  // With no real peer, the only other errors are request timeouts.
  expect(errors.length).toBeGreaterThan(1);
  expect(errors[0].message).toBe('bad row');
  expect(
    errors.slice(1).every(({message}) => message.startsWith('tinybase:3')),
  ).toBe(true);

  await synchronizer.destroy();
});

test('reports reducer errors', async () => {
  const errors: Error[] = [];
  const reducerError = new Error('not allowed');
  const server = createMockSyncServer({reducerError});
  const synchronizer = createSpacetimeDbSynchronizer(
    createMergeableStore(),
    server.createConnection(),
    {requestTimeoutSeconds: 0.01},
    undefined,
    undefined,
    (error) => errors.push(error),
  );

  await synchronizer.startSync();
  expect(errors).toContain(reducerError);

  await synchronizer.destroy();
});

test('fails pending requests when the subscription errors', async () => {
  const errors: Error[] = [];
  const subscriptionError = new Error('no such table');
  const server = createMockSyncServer({errorOnSubscribe: subscriptionError});
  const synchronizer = createSpacetimeDbSynchronizer(
    createMergeableStore(),
    server.createConnection(),
    undefined,
    undefined,
    undefined,
    (error) => errors.push(error),
  );

  await synchronizer.startSync();
  await pause(20);
  expect(errors).toContain(subscriptionError);
  const failed = server.subscriptions.length;

  // The next send subscribes again.
  server.options.errorOnSubscribe = undefined;
  synchronizer.getStore().setCell('pets', 'fido', 'species', 'dog');
  await pause(20);
  expect(server.subscriptions).toHaveLength(failed + 1);

  await synchronizer.destroy();
  expect(server.subscriptions[failed].unsubscribe).toHaveBeenCalledOnce();
});

test('fails when the subscription cannot find the table', async () => {
  const errors: Error[] = [];
  const server = createMockSyncServer();
  const otherServer = createMockSyncServer({tableName: 'other'});
  const synchronizer = createSpacetimeDbSynchronizer(
    createMergeableStore(),
    {
      ...server.createConnection(),
      subscriptionBuilder: otherServer.createConnection().subscriptionBuilder,
    },
    undefined,
    undefined,
    undefined,
    (error) => errors.push(error),
  );

  await synchronizer.startSync();
  expect(errors.map(({message}) => message)).toContain(
    'tinybase:17:table:tinybaseSync',
  );

  await synchronizer.destroy();
});

test('throws on a missing table, and reports a missing reducer', async () => {
  const errors: Error[] = [];
  const server = createMockSyncServer();
  const connection = server.createConnection();

  expect(() =>
    createSpacetimeDbSynchronizer(createMergeableStore(), {
      ...connection,
      db: {},
    }),
  ).toThrow('tinybase:17:table:tinybaseSync');
  expect(server.subscriptions).toHaveLength(0);

  const synchronizer = createSpacetimeDbSynchronizer(
    createMergeableStore(),
    {...connection, reducers: {}},
    undefined,
    undefined,
    undefined,
    (error) => errors.push(error),
  );
  await synchronizer.startSync();
  expect(errors.map(({message}) => message)).toContain(
    'tinybase:17:reducer:sendTinybaseSync',
  );

  await synchronizer.destroy();
});

test('fails sends once the connection is lost', async () => {
  const errors: Error[] = [];
  const server = createMockSyncServer();
  const connection = server.createConnection();
  const store = createMergeableStore();
  const synchronizer = createSpacetimeDbSynchronizer(
    store,
    connection,
    {requestTimeoutSeconds: 0.01},
    undefined,
    undefined,
    (error) => errors.push(error),
  );
  await synchronizer.startSync();
  await pause();
  // With no peer, the only errors so far are request timeouts.
  const notTimeouts = () =>
    errors.filter(({message}) => !message.startsWith('tinybase:3'));
  expect(notTimeouts()).toEqual([]);

  connection.disconnect();
  store.setCell('pets', 'fido', 'species', 'dog');
  await pause();
  expect(notTimeouts()[0].message).toBe('tinybase:19');
  expect(server.subscriptions).toHaveLength(1);

  await synchronizer.destroy();
  expect(connection.lifecycleCallbacks.disconnects.size).toBe(0);
});
