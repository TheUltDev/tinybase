/**
 * The persister-spacetimedb module of the TinyBase project lets you save and
 * load MergeableStore data to and from a SpacetimeDB database, via the
 * `spacetimedb` TypeScript SDK.
 *
 * SpacetimeDB is a database that clients talk to over a WebSocket. Rather than
 * running queries, a client subscribes to the tables it cares about and is kept
 * up to date as they change, and it makes changes by calling reducers, which
 * are functions that run inside the database. This Persister follows that
 * model: it reads the MergeableStore from subscriptions to tables (so that
 * changes made by other clients arrive as they happen), and saves it by
 * calling reducers that you write in your SpacetimeDB module.
 *
 * Each Store Table maps to a SpacetimeDB table with a row per Row and a
 * column per Cell, so the data can be browsed and used by the rest of your
 * module, and beside each Cell column sits a column holding the Cell's clock.
 * The reducer that saves rows keeps whichever version of each Cell has the
 * later clock, which is the same rule a MergeableStore uses to merge, so the
 * database holds the merged state of every client, and every client's
 * subscription delivers everyone else's changes as they are merged. Offline
 * changes merge when a client reconnects, in both directions, loading merges
 * into the Store rather than replacing it, and no Synchronizer is needed.
 *
 * Because a SpacetimeDB module's tables and reducers are declared in the
 * module's code, this Persister will not create them for you. The
 * createSpacetimeDbPersister function documentation shows the module code
 * you need. This module works with version 2.9 or later of the `spacetimedb`
 * package.
 * @see Persistence guides
 * @packageDocumentation
 * @module persister-spacetimedb
 * @since v9.7.0
 */
/// persister-spacetimedb
/**
 * The SpacetimeDbConnection type describes the parts of a SpacetimeDB
 * `DbConnection` object that a SpacetimeDbPersister uses.
 *
 * You do not need to construct one of these yourself: the `DbConnection` class
 * in the module bindings that the SpacetimeDB CLI generates for you satisfies
 * this type, and you should pass an instance of it to the
 * createSpacetimeDbPersister function. The type is described structurally
 * here, rather than imported from the `spacetimedb` package, so that TinyBase
 * does not need that package's types to be resolvable in your project.
 * @category Connection
 * @since v9.7.0
 */
/// SpacetimeDbConnection
{
  /**
   * The client cache of subscribed tables, keyed by table accessor name. The
   * Persister reads the Store from these, and listens to them for changes.
   * @category Connection
   * @since v9.7.0
   */
  /// SpacetimeDbConnection.db
  /**
   * The reducers of the module, keyed by accessor name, each of which is an
   * asynchronous function taking a single object of named arguments. The
   * Persister calls these to save the Store.
   * @category Connection
   * @since v9.7.0
   */
  /// SpacetimeDbConnection.reducers
  /**
   * The method that creates a subscription builder, which the Persister uses
   * to subscribe to the tables that hold the Store.
   * @category Connection
   * @since v9.7.0
   */
  /// SpacetimeDbConnection.subscriptionBuilder
  /**
   * The optional method that registers a callback for when the connection
   * is lost. The Persister uses it to fail, rather than wait forever for, a
   * load or save that the connection can no longer complete.
   * @category Connection
   * @since v9.7.0
   */
  /// SpacetimeDbConnection.onDisconnect
  /**
   * The optional method that registers a callback for when the connection
   * could not be made. The Persister uses it in the same way as the
   * `onDisconnect` method.
   * @category Connection
   * @since v9.7.0
   */
  /// SpacetimeDbConnection.onConnectError
  /**
   * The optional method that removes a callback registered with the
   * `onDisconnect` method, which the Persister calls when destroyed.
   * @category Connection
   * @since v9.7.0
   */
  /// SpacetimeDbConnection.removeOnDisconnect
  /**
   * The optional method that removes a callback registered with the
   * `onConnectError` method, which the Persister calls when destroyed.
   * @category Connection
   * @since v9.7.0
   */
  /// SpacetimeDbConnection.removeOnConnectError
}
/**
 * The SpacetimeDbPersister interface represents a Persister that lets you save
 * and load MergeableStore data to and from a SpacetimeDB database.
 *
 * You should use the createSpacetimeDbPersister function to create a
 * SpacetimeDbPersister object.
 *
 * It is a minor extension to the Persister interface and simply provides an
 * extra getDbConnection method for accessing the SpacetimeDB connection the
 * Store is being persisted over.
 * @category Persister
 * @since v9.7.0
 */
/// SpacetimeDbPersister
{
  /**
   * The getDbConnection method returns the SpacetimeDB connection the Store is
   * being persisted over.
   * @returns The SpacetimeDB `DbConnection` object.
   * @example
   * This example creates a Persister object against a newly-created
   * MergeableStore and then gets the SpacetimeDB connection back out again.
   *
   * ```js ignore
   * import {createMergeableStore} from 'tinybase';
   * import {createSpacetimeDbPersister} from 'tinybase/persisters/persister-spacetimedb';
   * import {DbConnection} from './module_bindings';
   *
   * const connection = DbConnection.builder()
   *   .withUri('ws://localhost:3000')
   *   .withDatabaseName('my-database')
   *   .build();
   * const store = createMergeableStore();
   * const persister = createSpacetimeDbPersister(store, connection, {
   *   tables: {pets: 'pets'},
   * });
   *
   * console.log(persister.getDbConnection() == connection);
   * // -> true
   *
   * await persister.destroy();
   * ```
   * @category Getter
   * @since v9.7.0
   */
  /// SpacetimeDbPersister.getDbConnection
}
/**
 * The SpacetimeDbPersisterConfig type describes the configuration of a
 * SpacetimeDB Persister: which Store Tables map to which SpacetimeDB tables,
 * whether and where the Store Values are kept, and how the clock columns are
 * named.
 *
 * Only the Tables listed in `tables` are persisted, and the Values only if
 * `values` is set, since each needs a table and a reducer in your module.
 *
 * Note that the table and reducer names here are the ones your generated
 * module bindings use on the client, which is to say the properties of the
 * connection's `db` and `reducers` objects, rather than the names SpacetimeDB
 * uses in SQL. For a table called `pet_owners` in a Rust module, for example,
 * the bindings expose `connection.db.petOwners`, and so `petOwners` is the
 * name to use. Column names are likewise the property names of the rows in
 * the client cache, which are `camelCase` in the bindings whatever the module
 * language.
 * @example
 * When applied to a SpacetimeDB Persister, this SpacetimeDbPersisterConfig
 * will merge the `pets` Table with the `pets` SpacetimeDB table, and the Store
 * Values with the `tinybaseValues` table.
 *
 * ```js
 * export const spacetimeDbPersisterConfig = {
 *   tables: {pets: 'pets'},
 *   values: true,
 * };
 * ```
 * @category Configuration
 * @since v9.7.0
 */
/// SpacetimeDbPersisterConfig
{
  /**
   * The Store Tables to persist, and the SpacetimeDB tables to persist them
   * in, as a SpacetimeDbPersisterTables object. Tables not listed here are not
   * persisted.
   * @category Configuration
   * @since v9.7.0
   */
  /// SpacetimeDbPersisterConfig.tables
  /**
   * Whether to persist the Store Values, defaulting to false. Set this to
   * `true` to use the default table and reducer names, or to a
   * SpacetimeDbPersisterValues object to configure them.
   * @category Configuration
   * @since v9.7.0
   */
  /// SpacetimeDbPersisterConfig.values
  /**
   * The suffix that names the column holding a Cell's clock, after the Cell's
   * own column name, defaulting to `Hlc`. So the clock of a `species` Cell is
   * in a `speciesHlc` column. A Cell Id must not itself end with this suffix,
   * and nor must the Row Id column. It can be overridden for an individual
   * table with the `hlcColumnSuffix` property of its
   * SpacetimeDbPersisterTableConfig object.
   * @category Configuration
   * @since v9.7.0
   */
  /// SpacetimeDbPersisterConfig.hlcColumnSuffix
}
/**
 * The SpacetimeDbPersisterTables type describes which Store Tables a
 * SpacetimeDB Persister persists, and in which SpacetimeDB tables.
 *
 * It is an object where each key is an Id of a Store Table, and the value is
 * either a SpacetimeDbPersisterTableConfig object describing how that Table
 * maps to SpacetimeDB, or simply the name of the SpacetimeDB table, in which
 * case the defaults of that object apply.
 * @example
 * When applied to a SpacetimeDB Persister, this SpacetimeDbPersisterTables
 * will persist the `pets` Table in the `pets` SpacetimeDB table, and the
 * `owners` Table in the `petOwners` table, using its `name` column for the
 * Row Ids and a reducer called `mergePetOwners`.
 *
 * ```js
 * export const spacetimeDbPersisterTables = {
 *   pets: 'pets',
 *   owners: {tableName: 'petOwners', rowIdColumnName: 'name'},
 * };
 * ```
 * @category Configuration
 * @since v9.7.0
 */
/// SpacetimeDbPersisterTables
/**
 * The SpacetimeDbPersisterTableConfig type describes how one Store Table maps
 * to a SpacetimeDB table.
 *
 * Its properties are:
 *
 * ||Type|Description|
 * |-|-|-|
 * |`tableName`|string|The SpacetimeDB table that holds the Store Table.|
 * |`rowIdColumnName?`|string|The column holding Row Ids, defaulting to `id`.|
 * |`reducerName?`|string|The reducer that merges rows, default `merge<Table>`.|
 * |`hlcColumnSuffix?`|string|The clock column suffix for this table only.|
 * |`columns?`|object|Column names for Cells whose Ids differ from them.|
 * |`fixedColumns?`|object|Columns to set on every row saved.|
 * |`condition?`|function|A filter on the rows subscribed to and loaded.|
 *
 * Every row of the SpacetimeDB table whose Row Id column is a string becomes
 * a Row, with every column that has a clock column beside it as a Cell.
 * Columns without a clock column, such as the Row Id column and any fixed
 * columns, are not Cells. Columns that are not strings, numbers, or booleans
 * are skipped (as are `NaN` and infinite `f64` values), except that 64-bit
 * integer columns, which the SDK provides as `bigint` values, are converted
 * to numbers, and a column with a clock but no value is a deleted Cell. A
 * column whose clock is not a valid one, or is more than a few minutes in the
 * future, is skipped and reported to the `onIgnoredError` handler, since a
 * MergeableStore would otherwise reject the whole merge.
 *
 * The `fixedColumns` and `condition` properties are for keeping the Tables of
 * several Stores in one SpacetimeDB table. If each Store's rows are saved with
 * a fixed `room` column, say, and each Store subscribes only to the rows with
 * its own `room`, then the Stores of different rooms are kept apart by the
 * database, and a client only ever receives the rows of its own room (and
 * loads only those, should its connection also be subscribed to others). The
 * condition is a function of the row object that the SpacetimeDB query
 * builder passes to its `where` method, so it can use that object's `eq`,
 * `and`, and other methods. Since the rows of every room are in one table,
 * your module's reducer will need a primary key that combines the fixed column
 * with the Row Id, as shown in the createSpacetimeDbPersister function
 * documentation.
 * @example
 * When applied to a SpacetimeDB Persister, this SpacetimeDbPersisterTableConfig
 * will persist a Store Table in the `petOwners` SpacetimeDB table, using its
 * `name` column for the Row Ids, its `pets` column for the `petCount` Cells,
 * and only the rows (and always the rows) of the `room1` room.
 *
 * ```js
 * export const spacetimeDbPersisterTableConfig = {
 *   tableName: 'petOwners',
 *   rowIdColumnName: 'name',
 *   columns: {petCount: 'pets'},
 *   fixedColumns: {room: 'room1'},
 *   condition: (row) => row.room.eq('room1'),
 * };
 * ```
 * @category Configuration
 * @since v9.7.0
 */
/// SpacetimeDbPersisterTableConfig
{
  /**
   * The name of the SpacetimeDB table that holds the Store Table, as it
   * appears on the connection's `db` object.
   * @category Configuration
   * @since v9.7.0
   */
  /// SpacetimeDbPersisterTableConfig.tableName
  /**
   * The optional name of the column in the SpacetimeDB table that holds the
   * Row Ids, defaulting to `id`. The default differs from the `_id` used by
   * the SQL-based Persisters to match the conventions of SpacetimeDB modules.
   * This column is not a Cell, and its name must not end with the clock column
   * suffix.
   * @category Configuration
   * @since v9.7.0
   */
  /// SpacetimeDbPersisterTableConfig.rowIdColumnName
  /**
   * The optional name of the reducer that merges rows into the SpacetimeDB
   * table, as it appears on the connection's `reducers` object, defaulting to
   * `merge` followed by the capitalized table name, so `mergePets` for a table
   * called `pets`.
   * @category Configuration
   * @since v9.7.0
   */
  /// SpacetimeDbPersisterTableConfig.reducerName
  /**
   * The optional suffix that names the clock columns of this table, overriding
   * the `hlcColumnSuffix` property of the SpacetimeDbPersisterConfig object.
   * @category Configuration
   * @since v9.7.0
   */
  /// SpacetimeDbPersisterTableConfig.hlcColumnSuffix
  /**
   * An optional object mapping Cell Ids to the names of the columns that hold
   * them, for the Cells whose Ids are not valid or desirable column names. A
   * Cell that is not listed is held in the column with the same name as its
   * Id. Each column's clock column is named from the column name, not the Cell
   * Id.
   * @category Configuration
   * @since v9.7.0
   */
  /// SpacetimeDbPersisterTableConfig.columns
  /**
   * An optional object of column names and the values to set them to on every
   * row that the Persister saves, such as a room or tenant identifier. Only
   * rows with these values are loaded, so that a connection can carry the
   * subscriptions of several Stores to one table. These columns have no clock
   * columns, so they are not Cells, and they should be string, `f64`, or
   * `bool` columns, whose values compare with those given here (a 64-bit
   * integer column is compared as a number).
   * @category Configuration
   * @since v9.7.0
   */
  /// SpacetimeDbPersisterTableConfig.fixedColumns
  /**
   * An optional function returning a condition on the rows to subscribe to,
   * so that only those rows are loaded and listened to. It is passed the row
   * object of the SpacetimeDB query builder, and should return the result of
   * that object's methods, such as `(row) => row.room.eq('room1')`. The
   * condition is applied by SpacetimeDB itself, before rows are sent to the
   * client.
   * @category Configuration
   * @since v9.7.0
   */
  /// SpacetimeDbPersisterTableConfig.condition
}
/**
 * The SpacetimeDbPersisterValues type describes where a SpacetimeDB Persister
 * persists the Store Values.
 *
 * The Values are held in a single row of a SpacetimeDB table, with a column
 * per Value and a clock column beside each, alongside a Row Id column that
 * always contains `_`. The properties are those of the
 * SpacetimeDbPersisterTableConfig type, but all are optional, so `true` can be
 * used in its place in the SpacetimeDbPersisterConfig type to accept the
 * defaults: the `tinybaseValues` table, its `id` column, and the
 * `mergeTinybaseValues` reducer.
 *
 * If you use fixed columns and a condition to keep the Values of several
 * Stores in one table, their rows all have the Row Id `_`, so the reducer will
 * need a primary key that combines the fixed column with it, as shown in the
 * createSpacetimeDbPersister function documentation.
 * @example
 * When applied to a SpacetimeDB Persister, this SpacetimeDbPersisterValues
 * will persist the Store Values in the `settings` table, calling the
 * `mergeSettings` reducer to do so.
 *
 * ```js
 * export const spacetimeDbPersisterValues = {tableName: 'settings'};
 * ```
 * @category Configuration
 * @since v9.7.0
 */
/// SpacetimeDbPersisterValues
/**
 * The createSpacetimeDbPersister function creates a SpacetimeDbPersister
 * object that can persist a MergeableStore to a SpacetimeDB database, with
 * the database merging the changes of every client.
 *
 * As well as providing a reference to the MergeableStore to persist, you must
 * provide a `connection` parameter, which is the `DbConnection` object that
 * the SpacetimeDB SDK's generated module bindings create for you. The
 * Persister does not connect or disconnect it, so you can share it with the
 * rest of your app, and with other Persisters.
 *
 * The third argument is a SpacetimeDbPersisterConfig object that says which
 * Store Tables (and whether the Values) to persist, and names the tables and
 * reducers involved. Since a SpacetimeDB module's tables and reducers are
 * declared in its code, the Persister cannot create them for you, and you
 * need to add the relevant code to your module before the Persister will
 * work at all.
 *
 * ## The module
 *
 * Each Store Table needs a SpacetimeDB table with a string primary key column
 * for the Row Ids, a column for each Cell, and beside each of those a string
 * column for the Cell's clock, named with the `Hlc` suffix. Every Cell of a
 * MergeableStore carries a hybrid logical clock, and the rule for merging two
 * versions of the same Cell is simply that the later clock wins, so the table
 * needs a reducer that takes rows and applies that rule column by column. The
 * Values, if persisted, need the same for their single row. Since Rows in a
 * Store need not all have the same Cells, and deleted Cells are kept as a
 * missing value with a clock, declare every Cell column and clock column as
 * optional, and use `f64` rather than 64-bit integer types for numbers.
 *
 * A module that matches the defaults for a `pets` Table and the Values looks
 * like this in TypeScript:
 *
 * ```ts ignore
 * import {schema, t, table} from 'spacetimedb/server';
 *
 * const petColumns = {
 *   id: t.string(),
 *   species: t.option(t.string()),
 *   speciesHlc: t.option(t.string()),
 *   price: t.option(t.f64()),
 *   priceHlc: t.option(t.string()),
 * };
 * const valuesColumns = {
 *   id: t.string(),
 *   open: t.option(t.bool()),
 *   openHlc: t.option(t.string()),
 * };
 * const spacetimedb = schema({
 *   pets: table(
 *     {public: true},
 *     {...petColumns, id: t.string().primaryKey()},
 *   ),
 *   tinybaseValues: table(
 *     {public: true},
 *     {...valuesColumns, id: t.string().primaryKey()},
 *   ),
 * });
 * export default spacetimedb;
 *
 * // Merges an incoming row into an existing one: for each Cell whose clock
 * // column is set, the later clock wins.
 * const merge = (existing: any, row: any) => {
 *   const merged = {...existing};
 *   for (const column of Object.keys(row)) {
 *     if (
 *       column.endsWith('Hlc') &&
 *       row[column] !== undefined &&
 *       !(existing[column] >= row[column])
 *     ) {
 *       const cell = column.slice(0, -3);
 *       merged[cell] = row[cell];
 *       merged[column] = row[column];
 *     }
 *   }
 *   return merged;
 * };
 *
 * export const mergePets = spacetimedb.reducer(
 *   {rows: t.array(t.object('PetRow', petColumns))},
 *   (ctx, {rows}) => {
 *     for (const row of rows) {
 *       const existing = ctx.db.pets.id.find(row.id);
 *       if (existing) {
 *         ctx.db.pets.id.update(merge(existing, row));
 *       } else {
 *         ctx.db.pets.insert(row);
 *       }
 *     }
 *   },
 * );
 * export const mergeTinybaseValues = spacetimedb.reducer(
 *   {rows: t.array(t.object('ValuesRow', valuesColumns))},
 *   (ctx, {rows}) => {
 *     for (const row of rows) {
 *       const existing = ctx.db.tinybaseValues.id.find(row.id);
 *       if (existing) {
 *         ctx.db.tinybaseValues.id.update(merge(existing, row));
 *       } else {
 *         ctx.db.tinybaseValues.insert(row);
 *       }
 *     }
 *   },
 * );
 * ```
 *
 * Note that the row type of a reducer's `rows` parameter is built with the
 * plain column builders, not the `.primaryKey()` one used in the table, and
 * needs a name for the generated bindings. The Persister calls each reducer
 * with a `rows` array in which every row has the Row Id column and, for each
 * Cell to merge, its column and its clock column. Cells that are not being
 * merged are simply absent, and a deleted Cell arrives as a missing value with
 * a clock, so that the deletion also wins over older versions from other
 * clients, just as a MergeableStore keeps such tombstones itself.
 *
 * The clocks are strings that compare in time order, so a Rust or C# module
 * needs nothing more than the same string comparison, written out for each
 * pair of columns. In Rust, the reducer takes a `rows: Vec<PetRow>` argument
 * whose struct has `Option` fields for every Cell and clock column, the table
 * needs a `#[primary_key]` on the Row Id column for its `update` method, and
 * the `snake_case` names of the module become `camelCase` in the client
 * bindings, so a `species_hlc` column is `speciesHlc` to the Persister.
 *
 * ## Which Cells are persisted
 *
 * A Cell is saved to the column named by its Id (or by the `columns` mapping
 * of its SpacetimeDbPersisterTableConfig object). Since the SDK ignores
 * arguments that a reducer does not declare, a Cell whose column the module
 * lacks is silently not persisted, so declare a column for every Cell that
 * your Store can hold, of the type the Cell has (an object or array Cell
 * arrives as a JSON string, so needs a string column). A Cell cannot be
 * persisted, and is reported to the `onIgnoredError` handler, if its column
 * is the Row Id column, a fixed column, or the column of another Cell, or
 * ends with the clock suffix, or if the Cell is `null`, since a typed column
 * cannot hold it. Rows whose Id column is not a string, and columns holding
 * other than strings, numbers, and booleans, are skipped when loading, as
 * described in the SpacetimeDbPersisterTableConfig type.
 *
 * A missing table or reducer is reported to the `onIgnoredError` handler
 * (or thrown, if there is none) with an error naming it.
 *
 * ## Several Stores in one table
 *
 * To keep the Tables of several Stores in one SpacetimeDB table (one per
 * room, tenant, or document, say), save each Store's rows with a fixed column
 * that identifies it, and subscribe only to the rows with that column, using
 * the `fixedColumns` and `condition` properties. The rows then need a primary
 * key that is unique across Stores, which the reducer can derive:
 *
 * ```ts ignore
 * import {schema, t, table} from 'spacetimedb/server';
 * import {merge} from './merge'; // the merge function shown above
 *
 * const petColumns = {
 *   room: t.string(),
 *   id: t.string(),
 *   species: t.option(t.string()),
 *   speciesHlc: t.option(t.string()),
 * };
 * const spacetimedb = schema({
 *   pets: table(
 *     {
 *       public: true,
 *       indexes: [{accessor: 'room', algorithm: 'btree', columns: ['room']}],
 *     },
 *     {key: t.string().primaryKey(), ...petColumns},
 *   ),
 * });
 * export default spacetimedb;
 *
 * export const mergePets = spacetimedb.reducer(
 *   {rows: t.array(t.object('PetRow', petColumns))},
 *   (ctx, {rows}) => {
 *     for (const row of rows) {
 *       const key = row.room + ':' + row.id;
 *       const existing = ctx.db.pets.key.find(key);
 *       if (existing) {
 *         ctx.db.pets.key.update(merge(existing, row));
 *       } else {
 *         ctx.db.pets.insert({key, ...row});
 *       }
 *     }
 *   },
 * );
 * ```
 *
 * A client for `room1` is then configured with a fixed `room` column and a
 * condition on it:
 *
 * ```js ignore
 * import {createMergeableStore} from 'tinybase';
 * import {createSpacetimeDbPersister} from 'tinybase/persisters/persister-spacetimedb';
 * import {DbConnection} from './module_bindings';
 *
 * const connection = DbConnection.builder()
 *   .withUri('ws://localhost:3000')
 *   .withDatabaseName('my-database')
 *   .build();
 * const store = createMergeableStore();
 * const persister = createSpacetimeDbPersister(store, connection, {
 *   tables: {
 *     pets: {
 *       tableName: 'pets',
 *       fixedColumns: {room: 'room1'},
 *       condition: (row) => row.room.eq('room1'),
 *     },
 *   },
 * });
 * await persister.startAutoPersisting();
 * ```
 *
 * ## Permissions and bindings
 *
 * The reducers are where you decide who may save the Store: they run inside
 * the database with the caller's identity available as `ctx.sender`, so a
 * check there is enforced for every client. Likewise, making a table private
 * and exposing it through a view is the way to restrict who can load it, and
 * the reducer can insist on the fixed columns a caller is allowed to use.
 *
 * Note that the reducer above trusts the clocks it is sent, so a client that
 * stamped its changes with a far-future clock would win every conflict. If
 * your clients are not all trusted, have the reducer reject clocks that are
 * ahead of `ctx.timestamp` by more than a few minutes, as a MergeableStore
 * itself does. A clock is 16 characters from the alphabet `-0-9A-Z_a-z` (in
 * ASCII order, so that string comparison is time order), of which the first 7
 * are a 42-bit count of milliseconds since the Unix epoch, 6 bits per
 * character, most significant first, and the rest are a counter and a client
 * identifier.
 *
 * Once the module is published, generate the client bindings with the
 * SpacetimeDB CLI, and build a connection from them to pass to this function:
 *
 * ```sh ignore
 * spacetime generate --lang typescript --project-path server \
 *   --out-dir src/module_bindings
 * ```
 *
 * ## Behavior
 *
 * The first load or save subscribes to the tables, and the subscription stays
 * open until the destroy method is called. (If the subscription fails, the
 * error is reported to the `onIgnoredError` handler, and the next load or
 * save opens it again.) The load method then merges the
 * rows in the connection's client cache into the Store, and since the
 * subscription stays open, the startAutoLoad method simply listens to that
 * cache, so changes made by other clients are merged in as soon as SpacetimeDB
 * commits them, with no polling, and all the rows changed by one SpacetimeDB
 * transaction are merged as one Store transaction.
 *
 * The save method sends the changed Cells to the reducers, one call per Table,
 * and resolves once every call has settled. If any of them fail, the first
 * failure is reported to the `onIgnoredError` handler. A full
 * save (such as the one that starts auto-saving) only sends the Cells that the
 * database lacks or has older versions of, so it is cheap when little has
 * changed, and a client's own saves are not merged back into it when the
 * database echoes them.
 *
 * Because every client merges through the database, all the clients using a
 * table converge on the same content, a client that was offline merges its
 * changes when it reconnects (ranked by when they were made, not when they
 * arrived), and a client joining later loads the merged state without needing
 * any other client to be online.
 *
 * ## The connection
 *
 * A Persister is bound to the connection it was created with, and to the
 * subscription it opens on it. If the connection closes, the SDK does not
 * reopen it, so create a new `DbConnection` object and a new Persister for it,
 * having destroyed the old one. The Store keeps the changes made while
 * offline, and the new Persister's first full save sends them. A load or save
 * that is waiting on the connection when it is lost (or could not be made)
 * fails, and is reported to the `onIgnoredError` handler, rather than waiting
 * forever, and so does any that is attempted afterwards.
 *
 * Note that the SDK keeps one cache per table per connection, shared by every
 * subscription to that table, so two Persisters on one connection that use
 * the same table receive each other's rows. They only load the rows that
 * match their own fixed columns, so this is harmless, but a table used by
 * several Stores over one connection is best given fixed columns.
 *
 * ## Changing the schema
 *
 * A new Cell needs a new column and clock column in the table, both optional,
 * which a reducer written like the one above merges without changes. Renaming
 * a column is best avoided, since SpacetimeDB cannot migrate the data, but a
 * Cell Id can be changed on the client side with the `columns` mapping. Values
 * are just such columns in their own table, so adding a Value is the same.
 * @param store The MergeableStore to persist.
 * @param connection The SpacetimeDB `DbConnection` object to persist over.
 * @param config A SpacetimeDbPersisterConfig object to configure which Tables
 * and Values to persist, and the table, column, and reducer names.
 * @param onIgnoredError An optional handler for the errors that the Persister
 * would otherwise ignore when trying to save or load data. This is suitable for
 * debugging persistence issues in a development environment.
 * @returns A reference to the new SpacetimeDbPersister object.
 * @example
 * This example creates two SpacetimeDbPersister objects, as if in two
 * different clients, each with its own MergeableStore. Both merge through the
 * database and converge on the same content, and a third client joining later
 * loads that merged content.
 *
 * ```js ignore
 * import {createMergeableStore} from 'tinybase';
 * import {createSpacetimeDbPersister} from 'tinybase/persisters/persister-spacetimedb';
 * import {DbConnection} from './module_bindings';
 *
 * const connect = () =>
 *   DbConnection.builder()
 *     .withUri('ws://localhost:3000')
 *     .withDatabaseName('my-database')
 *     .build();
 * const config = {tables: {pets: 'pets'}, values: true};
 *
 * const store1 = createMergeableStore('client1');
 * const store2 = createMergeableStore('client2');
 * const persister1 = createSpacetimeDbPersister(store1, connect(), config);
 * const persister2 = createSpacetimeDbPersister(store2, connect(), config);
 *
 * await persister1.startAutoPersisting();
 * await persister2.startAutoPersisting();
 *
 * store1.setTables({pets: {fido: {species: 'dog'}}});
 * store2
 *   .setTables({pets: {felix: {species: 'cat'}}})
 *   .setValues({open: true});
 *
 * // ...
 * console.log(store1.getTables());
 * // -> {pets: {fido: {species: 'dog'}, felix: {species: 'cat'}}}
 * console.log(store1.getValues());
 * // -> {open: true}
 * console.log(store2.getTables());
 * // -> {pets: {fido: {species: 'dog'}, felix: {species: 'cat'}}}
 *
 * const store3 = createMergeableStore('client3');
 * const persister3 = createSpacetimeDbPersister(store3, connect(), config);
 * await persister3.load();
 * console.log(store3.getTables());
 * // -> {pets: {fido: {species: 'dog'}, felix: {species: 'cat'}}}
 *
 * await persister1.destroy();
 * await persister2.destroy();
 * await persister3.destroy();
 * ```
 * @category Creation
 * @since v9.7.0
 */
/// createSpacetimeDbPersister
