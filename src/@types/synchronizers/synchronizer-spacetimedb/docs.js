/**
 * The synchronizer-spacetimedb module of the TinyBase project lets you
 * synchronize MergeableStore data to and from other MergeableStore instances
 * via a SpacetimeDB database, using the `spacetimedb` TypeScript SDK.
 *
 * This Synchronizer uses the database purely as a transport: an event table
 * broadcasts each synchronization message to every client subscribed to a
 * channel, and a reducer is how a client sends one. Nothing is stored, and
 * the MergeableStore objects at each end do the merging, so this gives you
 * the same peer-to-peer synchronization as the WsSynchronizer, without
 * running a WebSocket server of your own.
 *
 * Note that for most apps, the SpacetimeDbPersister is the better choice: it
 * stores the merged state in the database, so clients synchronize through it
 * whether or not they are online at the same time, and late joiners load it
 * directly. Use this Synchronizer when you specifically want nothing stored,
 * such as for ephemeral state that only matters while clients are present.
 * Both can share one connection.
 * @see Synchronization guide
 * @packageDocumentation
 * @module synchronizer-spacetimedb
 * @since v9.7.0
 */
/// synchronizer-spacetimedb
/**
 * The SpacetimeDbSynchronizer interface represents a Synchronizer that lets you
 * synchronize MergeableStore data to and from other MergeableStore instances
 * via a SpacetimeDB database.
 *
 * You should use the createSpacetimeDbSynchronizer function to create a
 * SpacetimeDbSynchronizer object.
 *
 * It is a minor extension to the Synchronizer interface and simply provides
 * an extra getChannelName method and getDbConnection method for accessing the
 * channel name and the SpacetimeDB connection being used.
 * @category Synchronizer
 * @since v9.7.0
 */
/// SpacetimeDbSynchronizer
{
  /**
   * The getChannelName method returns the name of the channel being used for
   * synchronization.
   * @returns The channel name.
   * @example
   * This example creates a SpacetimeDbSynchronizer object for a newly-created
   * MergeableStore and then gets the channel name back out again.
   *
   * ```js ignore
   * import {createMergeableStore} from 'tinybase';
   * import {createSpacetimeDbSynchronizer} from 'tinybase/synchronizers/synchronizer-spacetimedb';
   * import {DbConnection} from './module_bindings';
   *
   * const connection = DbConnection.builder()
   *   .withUri('ws://localhost:3000')
   *   .withDatabaseName('my-database')
   *   .build();
   * const store = createMergeableStore();
   * const synchronizer = createSpacetimeDbSynchronizer(
   *   store,
   *   connection,
   *   'channelA',
   * );
   *
   * console.log(synchronizer.getChannelName());
   * // -> 'channelA'
   *
   * await synchronizer.destroy();
   * ```
   * @category Getter
   * @since v9.7.0
   */
  /// SpacetimeDbSynchronizer.getChannelName
  /**
   * The getDbConnection method returns the SpacetimeDB connection being used
   * for synchronization.
   * @returns The SpacetimeDB `DbConnection` object.
   * @example
   * This example creates a SpacetimeDbSynchronizer object for a newly-created
   * MergeableStore and then gets the SpacetimeDB connection back out again.
   *
   * ```js ignore
   * import {createMergeableStore} from 'tinybase';
   * import {createSpacetimeDbSynchronizer} from 'tinybase/synchronizers/synchronizer-spacetimedb';
   * import {DbConnection} from './module_bindings';
   *
   * const connection = DbConnection.builder()
   *   .withUri('ws://localhost:3000')
   *   .withDatabaseName('my-database')
   *   .build();
   * const store = createMergeableStore();
   * const synchronizer = createSpacetimeDbSynchronizer(store, connection);
   *
   * console.log(synchronizer.getDbConnection() == connection);
   * // -> true
   *
   * await synchronizer.destroy();
   * ```
   * @category Getter
   * @since v9.7.0
   */
  /// SpacetimeDbSynchronizer.getDbConnection
}
/**
 * The SpacetimeDbSynchronizerConfig type describes the configuration of a
 * SpacetimeDbSynchronizer.
 *
 * All of its properties are optional, and the defaults match the module code
 * shown in the createSpacetimeDbSynchronizer function documentation. The
 * `channelName` is the one you are most likely to set, since it decides which
 * clients synchronize with each other: only clients on the same channel
 * exchange messages, so one database can carry any number of independent
 * Stores.
 * @example
 * When applied to a SpacetimeDbSynchronizer, this SpacetimeDbSynchronizerConfig
 * will synchronize over the `room1` channel, wait two seconds for responses,
 * and use a table and reducer with non-default names.
 *
 * ```js
 * export const spacetimeDbSynchronizerConfig = {
 *   channelName: 'room1',
 *   tableName: 'syncEvents',
 *   reducerName: 'publishSyncEvent',
 *   requestTimeoutSeconds: 2,
 * };
 * ```
 * @category Configuration
 * @since v9.7.0
 */
/// SpacetimeDbSynchronizerConfig
{
  /**
   * The name of the channel to synchronize over. Only clients using the same
   * channel name exchange messages. This defaults to `tinybase`.
   * @category Configuration
   * @since v9.7.0
   */
  /// SpacetimeDbSynchronizerConfig.channelName
  /**
   * The name of the event table that carries the messages, as it appears on
   * the connection's `db` object. This defaults to `tinybaseSync`.
   * @category Configuration
   * @since v9.7.0
   */
  /// SpacetimeDbSynchronizerConfig.tableName
  /**
   * The name of the reducer that inserts a message into that table, as it
   * appears on the connection's `reducers` object. This defaults to
   * `sendTinybaseSync`.
   * @category Configuration
   * @since v9.7.0
   */
  /// SpacetimeDbSynchronizerConfig.reducerName
  /**
   * The time in seconds that the Synchronizer will wait for responses to
   * request messages, defaulting to 1.
   * @category Configuration
   * @since v9.7.0
   */
  /// SpacetimeDbSynchronizerConfig.requestTimeoutSeconds
}
/**
 * The createSpacetimeDbSynchronizer function creates a SpacetimeDbSynchronizer
 * object that can synchronize MergeableStore data to and from other
 * MergeableStore instances via a SpacetimeDB database.
 *
 * As well as providing a reference to the MergeableStore to synchronize, you
 * must provide a `connection` parameter, which is the `DbConnection` object
 * that the SpacetimeDB SDK's generated module bindings create for you. The
 * Synchronizer does not connect or disconnect it, so you can share it with the
 * rest of your app, and with a SpacetimeDbPersister.
 *
 * The third argument is a SpacetimeDbSynchronizerConfig object, or simply a
 * string to set its `channelName` property. All the clients that should
 * synchronize together must use the same channel name.
 *
 * Every message travels through a SpacetimeDB event table, which broadcasts
 * each inserted row to every subscribed client without storing it, and is
 * sent by calling a reducer that inserts into it. Your module needs both, with
 * the four string columns shown here:
 *
 * ```ts ignore
 * import {schema, t, table} from 'spacetimedb/server';
 *
 * const syncColumns = {
 *   channel: t.string(),
 *   fromClientId: t.string(),
 *   toClientId: t.string(),
 *   payload: t.string(),
 * };
 * const spacetimedb = schema({
 *   tinybaseSync: table({public: true, event: true}, syncColumns),
 * });
 * export default spacetimedb;
 *
 * export const sendTinybaseSync = spacetimedb.reducer(
 *   syncColumns,
 *   (ctx, row) => {
 *     ctx.db.tinybaseSync.insert(row);
 *   },
 * );
 * ```
 *
 * The reducer is where you decide who may take part: it runs with the caller's
 * identity available as `ctx.sender`, so a check there is enforced for every
 * client, and it could also validate or restrict the `channel` argument.
 *
 * The Synchronizer subscribes to just the rows of the table that are on its
 * channel, from other clients, and either broadcast or addressed to it, so a
 * client receives nothing from other channels, none of the replies meant for
 * other clients, and not even its own broadcasts. All of these filters are
 * applied by SpacetimeDB itself, before the rows are sent. The
 * createSpacetimeDbSynchronizer function throws if the table is not on the
 * connection's `db` object, and otherwise opens the subscription as soon as
 * the Synchronizer is created. If that fails, the error is reported to the
 * `onIgnoredError` handler and the next message sent tries to open it again;
 * once the connection is lost, sending fails until a new Synchronizer is
 * created for a new connection.
 *
 * Since the SDK keeps one cache per table per connection, a Synchronizer sees
 * every row of the table that any subscription on its connection brings in.
 * It ignores the rows that its own filter would not have matched, but a row
 * matched by two subscriptions (two Synchronizers on the same channel and
 * connection, say, or your own subscription to the table) is received twice,
 * so use one Synchronizer per channel per connection, and leave the table to
 * it.
 *
 * Since SpacetimeDB is only the transport here, nothing is stored in the
 * database, and two clients that are never online at the same time will not
 * see each other's changes. If you want the database to hold the merged
 * state, so that clients synchronize through it at any time and late joiners
 * load it directly, use the createSpacetimeDbPersister function instead of,
 * or as well as, this Synchronizer.
 * @param store The MergeableStore to synchronize.
 * @param connection The SpacetimeDB `DbConnection` object to synchronize over.
 * @param configOrChannelName A SpacetimeDbSynchronizerConfig object to
 * configure the channel, table, and reducer names, and the request timeout
 * (or a string to set the `channelName` property).
 * @param onSend An optional handler for the messages that this Synchronizer
 * sends. This is suitable for debugging synchronization issues in a development
 * environment.
 * @param onReceive An optional handler for the messages that this Synchronizer
 * receives. This is suitable for debugging synchronization issues in a
 * development environment.
 * @param onIgnoredError An optional handler for the errors that the
 * Synchronizer would otherwise ignore when trying to synchronize data. This is
 * suitable for debugging synchronization issues in a development environment.
 * @returns A reference to the new SpacetimeDbSynchronizer object.
 * @example
 * This example creates two SpacetimeDbSynchronizer objects, as if in two
 * different clients, to synchronize one MergeableStore to another over the
 * same SpacetimeDB database.
 *
 * ```js ignore
 * import {createMergeableStore} from 'tinybase';
 * import {createSpacetimeDbSynchronizer} from 'tinybase/synchronizers/synchronizer-spacetimedb';
 * import {DbConnection} from './module_bindings';
 *
 * const connect = () =>
 *   DbConnection.builder()
 *     .withUri('ws://localhost:3000')
 *     .withDatabaseName('my-database')
 *     .build();
 *
 * const store1 = createMergeableStore();
 * const store2 = createMergeableStore();
 *
 * const synchronizer1 = createSpacetimeDbSynchronizer(store1, connect());
 * const synchronizer2 = createSpacetimeDbSynchronizer(store2, connect());
 *
 * await synchronizer1.startSync();
 * await synchronizer2.startSync();
 *
 * store1.setTables({pets: {fido: {species: 'dog'}}});
 * store2.setTables({pets: {felix: {species: 'cat'}}});
 *
 * // ...
 * console.log(store1.getTables());
 * // -> {pets: {fido: {species: 'dog'}, felix: {species: 'cat'}}}
 * console.log(store2.getTables());
 * // -> {pets: {fido: {species: 'dog'}, felix: {species: 'cat'}}}
 *
 * await synchronizer1.destroy();
 * await synchronizer2.destroy();
 * ```
 * @category Creation
 * @since v9.7.0
 */
/// createSpacetimeDbSynchronizer
