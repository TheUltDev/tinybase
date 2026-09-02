import type {MergeableStore} from 'tinybase';
import {createMergeableStore, createStore} from 'tinybase';
import {createSpacetimeDbPersister} from 'tinybase/persisters/persister-spacetimedb';
import {expect, test, vi} from 'vitest';
import {pause} from '../common/other.ts';
import {
  createMockLifecycle,
  createMockQueryBuilders,
  matchesQuery,
} from '../common/spacetimedb.ts';

type Row = {[column: string]: any};
type Callback = (context: unknown, ...rows: Row[]) => void;

// Just enough of the SpacetimeDB SDK's client cache to hold one table: rows
// keyed by their primary key (a column, or derived from the row), with the
// insert, update, and delete callbacks.
const createMockTable = (
  initialRows: Row[] = [],
  keyOf: string | ((row: Row) => string) = 'id',
) => {
  const getKey = typeof keyOf == 'string' ? (row: Row) => row[keyOf] : keyOf;
  const rows = new Map(initialRows.map((row) => [getKey(row), row]));
  const callbacks: {[event: string]: Set<Callback>} = {
    insert: new Set(),
    update: new Set(),
    delete: new Set(),
  };
  const emit = (event: string, ...args: Row[]) =>
    callbacks[event].forEach((callback) => callback({}, ...args));
  return {
    iter: () => rows.values(),
    onInsert: (callback: Callback) => callbacks.insert.add(callback),
    onUpdate: (callback: Callback) => callbacks.update.add(callback),
    onDelete: (callback: Callback) => callbacks.delete.add(callback),
    removeOnInsert: (callback: Callback) => callbacks.insert.delete(callback),
    removeOnUpdate: (callback: Callback) => callbacks.update.delete(callback),
    removeOnDelete: (callback: Callback) => callbacks.delete.delete(callback),
    get: (row: Row) => rows.get(getKey(row)),
    // What the server would do when a reducer commits, or another client
    // changes the row.
    set: (row: Row) => {
      const oldRow = rows.get(getKey(row));
      rows.set(getKey(row), row);
      if (oldRow) {
        emit('update', oldRow, row);
      } else {
        emit('insert', row);
      }
    },
    callbacks,
  };
};
type MockTable = ReturnType<typeof createMockTable>;

const capitalize = (name: string) =>
  name.charAt(0).toUpperCase() + name.slice(1);

// The merge rule of the module's reducers: for each Cell whose clock column
// is set, the later clock wins.
const merge = (existing: Row, row: Row, suffix: string) => {
  const merged = {...existing};
  Object.keys(row).forEach((column) => {
    if (
      column.endsWith(suffix) &&
      row[column] !== undefined &&
      !(existing[column] >= row[column])
    ) {
      const cell = column.slice(0, -suffix.length);
      merged[cell] = row[cell];
      merged[column] = row[column];
    }
  });
  return merged;
};

// Just enough of a DbConnection: a db view of tables, merge reducers that
// write to them, a subscription builder that applies (or errors, or never
// applies) on demand, and the connection lifecycle callbacks.
const createMockConnection = (
  tables: {[name: string]: MockTable},
  options: {
    errorOnSubscribe?: Error;
    neverApply?: boolean;
    reducerError?: Error;
    reducerHangs?: boolean;
    hlcColumnSuffix?: string;
  } = {},
) => {
  const subscriptions: {
    queries: any[];
    onApplied?: () => void;
    onError?: (context: any, error: Error) => void;
    unsubscribe: ReturnType<typeof vi.fn>;
  }[] = [];
  const reducers: {[name: string]: ReturnType<typeof vi.fn>} = {};
  Object.entries(tables).forEach(([name, table]) => {
    reducers['merge' + capitalize(name)] = vi.fn(async ({rows}: Row) => {
      if (options.reducerError) {
        throw options.reducerError;
      }
      if (options.reducerHangs) {
        await new Promise(() => {});
      }
      rows.forEach((row: Row) => {
        const existing = table.get(row);
        table.set(
          existing
            ? merge(existing, row, options.hlcColumnSuffix ?? 'Hlc')
            : row,
        );
      });
    });
  });
  const queryBuilders = createMockQueryBuilders(Object.keys(tables));
  const connection = {
    db: tables,
    reducers,
    subscriptionBuilder: () => {
      const subscription: (typeof subscriptions)[number] = {
        queries: [],
        unsubscribe: vi.fn(),
      };
      const builder = {
        onApplied: (onApplied: () => void) => {
          subscription.onApplied = onApplied;
          return builder;
        },
        onError: (onError: (context: any, error: Error) => void) => {
          subscription.onError = onError;
          return builder;
        },
        subscribe: (queryFn: (tables: any) => any) => {
          subscription.queries = queryFn(queryBuilders);
          subscriptions.push(subscription);
          setImmediate(() => {
            const {errorOnSubscribe, neverApply} = options;
            if (errorOnSubscribe) {
              subscription.onError?.(
                {event: errorOnSubscribe},
                errorOnSubscribe,
              );
            } else if (!neverApply) {
              // As the SDK does: applied, then an insert callback per row
              // that the subscription's queries brought into the cache.
              subscription.onApplied?.();
              subscription.queries.forEach((query) =>
                [...tables[query.table].iter()].forEach((row) => {
                  if (matchesQuery(query, row)) {
                    tables[query.table].callbacks.insert.forEach((callback) =>
                      callback({}, row),
                    );
                  }
                }),
              );
            }
          });
          return subscription;
        },
      };
      return builder;
    },
    ...createMockLifecycle(),
  };
  return {connection: connection as any, subscriptions, reducers, options};
};

const CONFIG = {tables: {pets: 'pets'}, values: true};
const createMockTables = () => ({
  pets: createMockTable(),
  tinybaseValues: createMockTable(),
});
const createServer = (options?: Parameters<typeof createMockConnection>[1]) => {
  const tables = createMockTables();
  return {tables, ...createMockConnection(tables, options)};
};
const anyHlc = expect.any(String);

// The rows that a MergeableStore's content would be saved as.
const toRows = (store: MergeableStore) => {
  const rows: {[tableName: string]: Row[]} = {pets: [], tinybaseValues: []};
  const [[tables], [values]] = store.getMergeableContent();
  Object.entries(tables).forEach(([tableId, [tableRows]]) =>
    Object.entries(tableRows).forEach(([rowId, [cells]]) => {
      const row: Row = {id: rowId};
      Object.entries(cells).forEach(([cellId, [cell, hlc]]) => {
        row[cellId] = cell;
        row[cellId + 'Hlc'] = hlc;
      });
      rows[tableId].push(row);
    }),
  );
  const valuesRow: Row = {id: '_'};
  Object.entries(values).forEach(([valueId, [value, hlc]]) => {
    valuesRow[valueId] = value;
    valuesRow[valueId + 'Hlc'] = hlc;
  });
  rows.tinybaseValues.push(valuesRow);
  return rows;
};

test('requires a MergeableStore', () => {
  const {connection} = createServer();
  expect(() =>
    createSpacetimeDbPersister(createStore() as any, connection, CONFIG),
  ).toThrow('tinybase:0');
});

test('saves rows with clocks, and loads them by merging', async () => {
  const server = createServer();
  const store = createMergeableStore()
    .setTables({pets: {fido: {species: 'dog', price: 5}}})
    .setValues({open: true});
  const persister = createSpacetimeDbPersister(
    store,
    server.connection,
    CONFIG,
  );

  await persister.save();
  expect(server.reducers.mergePets).toHaveBeenCalledExactlyOnceWith({
    rows: [
      {
        id: 'fido',
        species: 'dog',
        speciesHlc: anyHlc,
        price: 5,
        priceHlc: anyHlc,
      },
    ],
  });
  expect(server.reducers.mergeTinybaseValues).toHaveBeenCalledExactlyOnceWith({
    rows: [{id: '_', open: true, openHlc: anyHlc}],
  });
  expect(server.subscriptions[0].queries).toEqual([
    {table: 'pets'},
    {table: 'tinybaseValues'},
  ]);
  expect(persister.getDbConnection()).toBe(server.connection);

  // Loading merges into what the Store already has, rather than replacing.
  const store2 = createMergeableStore().setCell(
    'pets',
    'felix',
    'species',
    'cat',
  );
  const persister2 = createSpacetimeDbPersister(
    store2,
    server.connection,
    CONFIG,
  );
  await persister2.load();
  expect(store2.getContent()).toEqual([
    {pets: {fido: {species: 'dog', price: 5}, felix: {species: 'cat'}}},
    {open: true},
  ]);

  await persister.destroy();
  await persister2.destroy();
  expect(server.subscriptions[0].unsubscribe).toHaveBeenCalledOnce();
});

test('loads nothing when empty, and saves nothing when empty', async () => {
  const server = createServer();
  const store = createMergeableStore();
  const persister = createSpacetimeDbPersister(
    store,
    server.connection,
    CONFIG,
  );

  await persister.load();
  await persister.save();
  expect(store.getContent()).toEqual([{}, {}]);
  expect(server.reducers.mergePets).not.toHaveBeenCalled();
  expect(server.reducers.mergeTinybaseValues).not.toHaveBeenCalled();

  await persister.destroy();
});

test('persists only configured Tables, clocked Cells, string Ids', async () => {
  const server = createServer();
  server.tables.pets.set({id: 'fido', species: 'dog', price: 5});
  server.tables.pets.set({id: 42, species: 'goldfish', speciesHlc: 'x'});
  server.tables.pets.set({
    id: 'rex',
    species: 'dog',
    speciesHlc: 'Nn1JUF-----7JQY8',
    legs: 4n,
    legsHlc: 'Nn1JUF-----7JQY8',
    owner: {name: 'Alice'},
    ownerHlc: 'Nn1JUF-----7JQY8',
    price: NaN,
    priceHlc: 'Nn1JUF-----7JQY8',
    sold: null,
    soldHlc: 'Nn1JUF-----7JQY8',
  });
  const store = createMergeableStore().setTables({
    toys: {ball: {color: 'red'}},
    pets: {rex: {price: 1}},
  });
  const persister = createSpacetimeDbPersister(
    store,
    server.connection,
    CONFIG,
  );

  await persister.load();
  await persister.save();
  // Unsupported columns are skipped, but a null one is a deleted Cell.
  expect(store.getTables()).toEqual({
    toys: {ball: {color: 'red'}},
    pets: {rex: {species: 'dog', legs: 4, price: 1}},
  });
  expect(store.getMergeableContent()[0][0].pets[0].rex[0].sold).toEqual([
    undefined,
    'Nn1JUF-----7JQY8',
    expect.any(Number),
  ]);
  // Only the local Cell that the database lacks is saved.
  expect(server.reducers.mergePets).toHaveBeenCalledExactlyOnceWith({
    rows: [{id: 'rex', price: 1, priceHlc: anyHlc}],
  });

  await persister.destroy();
});

test('synchronizes two stores through the database', async () => {
  const server = createServer();
  const store1 = createMergeableStore('s1');
  const store2 = createMergeableStore('s2');
  const persister1 = createSpacetimeDbPersister(
    store1,
    server.connection,
    CONFIG,
  );
  const persister2 = createSpacetimeDbPersister(
    store2,
    server.connection,
    CONFIG,
  );
  await persister1.startAutoPersisting();
  await persister2.startAutoPersisting();

  store1.setCell('pets', 'fido', 'species', 'dog');
  await pause(10);
  expect(store2.getCell('pets', 'fido', 'species')).toBe('dog');

  store2.setCell('pets', 'fido', 'species', 'cat');
  await pause(10);
  expect(store1.getCell('pets', 'fido', 'species')).toBe('cat');

  store2.setValue('open', true);
  store1.delRow('pets', 'fido');
  await pause(10);
  expect(store1.getContent()).toEqual([{}, {open: true}]);
  expect(store2.getContent()).toEqual([{}, {open: true}]);

  // The deleted Cell is kept as a missing value with its clock.
  expect([...server.tables.pets.iter()]).toStrictEqual([
    {id: 'fido', species: undefined, speciesHlc: anyHlc},
  ]);
  expect([...server.tables.tinybaseValues.iter()]).toEqual([
    {id: '_', open: true, openHlc: anyHlc},
  ]);

  await persister1.destroy();
  await persister2.destroy();
});

test('resolves conflicts by clock, not by arrival order', async () => {
  const server = createServer();
  const store1 = createMergeableStore('s1');
  const store2 = createMergeableStore('s2');
  store1.setCell('pets', 'fido', 'species', 'dog'); // earlier, saved later
  await pause(5);
  store2.setCell('pets', 'fido', 'species', 'cat'); // later, saved first
  const persister2 = createSpacetimeDbPersister(
    store2,
    server.connection,
    CONFIG,
  );
  const persister1 = createSpacetimeDbPersister(
    store1,
    server.connection,
    CONFIG,
  );

  await persister2.save();
  await persister1.save();
  expect([...server.tables.pets.iter()][0].species).toBe('cat');

  await persister1.load();
  expect(store1.getCell('pets', 'fido', 'species')).toBe('cat');

  await persister1.destroy();
  await persister2.destroy();
});

test('a full save sends only what the database lacks', async () => {
  const server = createServer();
  const store1 = createMergeableStore('s1').setTables({
    pets: {fido: {species: 'dog', price: 5}},
  });
  const persister1 = createSpacetimeDbPersister(
    store1,
    server.connection,
    CONFIG,
  );
  await persister1.save();

  // A second client with the same data saves nothing...
  const store2 = createMergeableStore('s2');
  const persister2 = createSpacetimeDbPersister(
    store2,
    server.connection,
    CONFIG,
  );
  await persister2.load();
  await persister2.save();
  expect(server.reducers.mergePets).toHaveBeenCalledTimes(1);

  // ...and then only its newer Cells.
  store2.setCell('pets', 'fido', 'species', 'cat');
  await persister2.save();
  expect(server.reducers.mergePets).toHaveBeenCalledTimes(2);
  expect(server.reducers.mergePets).toHaveBeenLastCalledWith({
    rows: [{id: 'fido', species: 'cat', speciesHlc: anyHlc}],
  });

  await persister1.destroy();
  await persister2.destroy();
});

test('applies each batch of cache callbacks as one merge', async () => {
  const server = createServer();
  const store = createMergeableStore();
  let transactions = 0;
  store.addDidFinishTransactionListener(() => transactions++);
  const persister = createSpacetimeDbPersister(
    store,
    server.connection,
    CONFIG,
  );
  await persister.startAutoLoad();
  transactions = 0;

  // As the SDK does for one SpacetimeDB transaction: several callbacks in a
  // row, before any microtask can run.
  const other = createMergeableStore()
    .setTables({
      pets: {fido: {species: 'dog', price: 5}, felix: {species: 'cat'}},
    })
    .setValues({open: true});
  const rows = toRows(other);
  rows.pets.forEach((row) => server.tables.pets.set(row));
  rows.tinybaseValues.forEach((row) => server.tables.tinybaseValues.set(row));
  expect(transactions).toBe(0);
  await pause(10);

  expect(transactions).toBe(1);
  expect(store.getContent()).toEqual(other.getContent());

  // An update that changes no clocks merges nothing.
  server.tables.pets.set({...[...server.tables.pets.iter()][0]});
  await pause(10);
  expect(transactions).toBe(1);

  // Within one batch, the later clock for a Cell wins whatever the order.
  server.tables.pets.set({
    id: 'rex',
    species: 'a',
    speciesHlc: 'Nn1JUF-----7JQY8',
  });
  server.tables.pets.set({
    id: 'rex',
    species: 'b',
    speciesHlc: 'Nn1JUF-----7JQY9',
  });
  server.tables.pets.set({
    id: 'rex',
    species: 'c',
    speciesHlc: 'Nn1JUF-----7JQY7',
  });
  await pause(10);
  expect(transactions).toBe(2);
  expect(store.getCell('pets', 'rex', 'species')).toBe('b');

  await persister.destroy();
});

test('honors configured names and clock column suffix', async () => {
  const tables = {
    petOwners: createMockTable([], 'name'),
    settings: createMockTable([], 'key'),
  };
  const {connection, reducers, subscriptions} = createMockConnection(tables, {
    hlcColumnSuffix: '_clock',
  });
  reducers.savePetOwners = reducers.mergePetOwners;
  const store = createMergeableStore()
    .setTables({owners: {alice: {pets: 2}}})
    .setValues({open: true});
  const persister = createSpacetimeDbPersister(store, connection, {
    tables: {
      owners: {
        tableName: 'petOwners',
        rowIdColumnName: 'name',
        reducerName: 'savePetOwners',
      },
    },
    values: {tableName: 'settings', rowIdColumnName: 'key'},
    hlcColumnSuffix: '_clock',
  });

  await persister.startAutoPersisting();
  expect(reducers.savePetOwners).toHaveBeenCalledExactlyOnceWith({
    rows: [{name: 'alice', pets: 2, pets_clock: anyHlc}],
  });
  expect(reducers.mergeSettings).toHaveBeenCalledExactlyOnceWith({
    rows: [{key: '_', open: true, open_clock: anyHlc}],
  });
  expect(subscriptions[0].queries).toEqual([
    {table: 'petOwners'},
    {table: 'settings'},
  ]);

  tables.petOwners.set({name: 'bob', pets: 1, pets_clock: 'Nn1JUF-----7JQY8'});
  await pause(10);
  expect(store.getTables()).toEqual({
    owners: {alice: {pets: 2}, bob: {pets: 1}},
  });

  await persister.destroy();
});

test('returns the DbConnection, and idles with an empty config', async () => {
  const server = createServer();
  const store = createMergeableStore().setTables({
    pets: {fido: {species: 'dog'}},
  });
  const persister = createSpacetimeDbPersister(store, server.connection, {});

  await persister.startAutoPersisting();
  expect(persister.getDbConnection()).toBe(server.connection);
  expect(server.subscriptions).toHaveLength(0);
  expect(server.reducers.mergePets).not.toHaveBeenCalled();
  expect(store.getTables()).toEqual({pets: {fido: {species: 'dog'}}});

  await persister.destroy();
});

test('ignores errors when a table is missing', async () => {
  const onIgnoredError = vi.fn();
  const {connection} = createMockConnection({});
  const store = createMergeableStore().setValue('open', true);
  const persister = createSpacetimeDbPersister(
    store,
    connection,
    CONFIG,
    onIgnoredError,
  );

  await persister.load();
  await persister.startAutoLoad();

  // Once from each load, and once from listening for changes.
  expect(onIgnoredError.mock.calls.map(([{message}]) => message)).toEqual([
    'tinybase:17:table:pets',
    'tinybase:17:table:pets',
    'tinybase:17:table:pets',
  ]);
  expect(store.getValues()).toEqual({open: true});
  await persister.destroy();
});

test('ignores errors when the subscription cannot find a table', async () => {
  const onIgnoredError = vi.fn();
  const tables = createMockTables();
  const {connection} = createMockConnection({});
  const persister = createSpacetimeDbPersister(
    createMergeableStore(),
    {...connection, db: tables},
    CONFIG,
    onIgnoredError,
  );

  await persister.load();
  expect(onIgnoredError).toHaveBeenCalledOnce();
  expect(onIgnoredError.mock.calls[0][0].message).toBe(
    'tinybase:17:table:pets',
  );
  await persister.destroy();
});

test('ignores subscription errors and retries on the next load', async () => {
  const onIgnoredError = vi.fn();
  const error = new Error('no such table');
  const options = {errorOnSubscribe: error as Error | undefined};
  const server = createServer(options);
  server.tables.pets.set({
    id: 'fido',
    species: 'dog',
    speciesHlc: 'Nn1JUF-----7JQY8',
  });
  const store = createMergeableStore();
  const persister = createSpacetimeDbPersister(
    store,
    server.connection,
    CONFIG,
    onIgnoredError,
  );

  await persister.load();
  expect(onIgnoredError).toHaveBeenCalledWith(error);
  expect(store.getTables()).toEqual({});

  options.errorOnSubscribe = undefined;
  await persister.load();
  expect(server.subscriptions).toHaveLength(2);
  expect(store.getTables()).toEqual({pets: {fido: {species: 'dog'}}});

  await persister.destroy();
  expect(server.subscriptions[0].unsubscribe).not.toHaveBeenCalled();
  expect(server.subscriptions[1].unsubscribe).toHaveBeenCalledOnce();
});

test('ignores errors when a reducer is missing, or fails', async () => {
  const onIgnoredError = vi.fn();
  const server = createServer();
  delete server.reducers.mergePets;
  const persister = createSpacetimeDbPersister(
    createMergeableStore().setTables({pets: {fido: {species: 'dog'}}}),
    server.connection,
    CONFIG,
    onIgnoredError,
  );
  await persister.save();
  expect(onIgnoredError).toHaveBeenCalledOnce();
  expect(onIgnoredError.mock.calls[0][0].message).toBe(
    'tinybase:17:reducer:mergePets',
  );
  await persister.destroy();

  const reducerError = new Error('not allowed');
  const failing = createServer({reducerError});
  const persister2 = createSpacetimeDbPersister(
    createMergeableStore().setValue('open', true),
    failing.connection,
    CONFIG,
    onIgnoredError,
  );
  await persister2.save();
  expect(onIgnoredError).toHaveBeenLastCalledWith(reducerError);
  await persister2.destroy();
});

test('loads existing rows once when auto-loading', async () => {
  const server = createServer();
  const other = createMergeableStore()
    .setTables({pets: {fido: {species: 'dog'}, felix: {species: 'cat'}}})
    .setValues({open: true});
  const rows = toRows(other);
  rows.pets.forEach((row) => server.tables.pets.set(row));
  rows.tinybaseValues.forEach((row) => server.tables.tinybaseValues.set(row));
  const store = createMergeableStore();
  let transactions = 0;
  store.addDidFinishTransactionListener(() => transactions++);
  const persister = createSpacetimeDbPersister(
    store,
    server.connection,
    CONFIG,
  );

  // The subscription's own insert callbacks are redundant with the load.
  await persister.startAutoLoad();
  await pause(10);
  expect(transactions).toBe(1);
  expect(store.getContent()).toEqual(other.getContent());

  await persister.destroy();
});

test('skips the echoes of its own saves', async () => {
  const server = createServer();
  const store = createMergeableStore();
  let transactions = 0;
  store.addDidFinishTransactionListener(() => transactions++);
  const persister = createSpacetimeDbPersister(
    store,
    server.connection,
    CONFIG,
  );
  await persister.startAutoPersisting();
  transactions = 0;

  store.setCell('pets', 'fido', 'species', 'dog');
  store.setValue('open', true);
  await pause(10);
  expect(transactions).toBe(2);
  expect(server.reducers.mergePets).toHaveBeenCalledOnce();

  // Another client's change is still merged.
  server.tables.pets.set({
    id: 'felix',
    species: 'cat',
    speciesHlc: 'Nn1JUF-----7JQY8',
  });
  await pause(10);
  expect(transactions).toBe(3);
  expect(store.getRowIds('pets')).toEqual(['fido', 'felix']);

  await persister.destroy();
});

test('leaves container clocks to the Store', async () => {
  const server = createServer();
  const store1 = createMergeableStore('s1')
    .setTables({pets: {fido: {species: 'dog'}}})
    .setValues({open: true});
  const store2 = createMergeableStore('s2');
  const persister1 = createSpacetimeDbPersister(
    store1,
    server.connection,
    CONFIG,
  );
  const persister2 = createSpacetimeDbPersister(
    store2,
    server.connection,
    CONFIG,
  );

  await persister1.save();
  await persister2.load();
  expect(store2.getMergeableContentHashes()).toEqual(
    store1.getMergeableContentHashes(),
  );
  expect(store2.getMergeableContent()).toEqual(store1.getMergeableContent());

  await persister1.destroy();
  await persister2.destroy();
});

test('reports Cells that collide with Id or clock columns', async () => {
  const onIgnoredError = vi.fn();
  const server = createServer();
  const store = createMergeableStore().setTables({
    pets: {fido: {id: 'other', speciesHlc: 'x', species: 'dog'}},
  });
  const persister = createSpacetimeDbPersister(
    store,
    server.connection,
    CONFIG,
    onIgnoredError,
  );

  await persister.save();
  expect(server.reducers.mergePets).toHaveBeenCalledExactlyOnceWith({
    rows: [{id: 'fido', species: 'dog', speciesHlc: anyHlc}],
  });
  expect(onIgnoredError.mock.calls.map(([{message}]) => message)).toEqual([
    'tinybase:18:pets:id',
    'tinybase:18:pets:speciesHlc',
  ]);

  await persister.destroy();
});

test('reads Values from their one row, and skips empty clocks', async () => {
  const server = createServer();
  server.tables.tinybaseValues.set({
    id: 'other',
    open: false,
    openHlc: 'Nn1JUF-----7JQY8',
  });
  server.tables.tinybaseValues.set({id: '_', open: true, openHlc: ''});
  server.tables.pets.set({id: 'fido', species: 'dog', speciesHlc: ''});
  const store = createMergeableStore();
  const persister = createSpacetimeDbPersister(
    store,
    server.connection,
    CONFIG,
  );

  // Nothing loaded, so the initial content applies...
  await persister.load([{pets: {felix: {species: 'cat'}}}, {open: true}]);
  expect(store.getContent()).toEqual([
    {pets: {felix: {species: 'cat'}}},
    {open: true},
  ]);
  // ...but its empty clocks are never saved.
  await persister.save();
  expect(server.reducers.mergePets).not.toHaveBeenCalled();
  expect(server.reducers.mergeTinybaseValues).not.toHaveBeenCalled();

  server.tables.tinybaseValues.set({
    id: '_',
    open: false,
    openHlc: 'Nn1JUF-----7JQY8',
  });
  await persister.load();
  expect(store.getValues()).toEqual({open: false});

  await persister.destroy();
});

test('settles every reducer call, and reports the first failure', async () => {
  const onIgnoredError = vi.fn();
  const tables = {pets: createMockTable(), toys: createMockTable()};
  const {connection, reducers} = createMockConnection(tables);
  delete reducers.mergeToys;
  const persister = createSpacetimeDbPersister(
    createMergeableStore().setTables({
      pets: {fido: {species: 'dog'}},
      toys: {ball: {color: 'red'}},
    }),
    connection,
    {tables: {pets: 'pets', toys: 'toys'}},
    onIgnoredError,
  );

  await persister.save();
  expect(reducers.mergePets).toHaveBeenCalledOnce();
  expect(onIgnoredError).toHaveBeenCalledOnce();
  expect(onIgnoredError.mock.calls[0][0].message).toBe(
    'tinybase:17:reducer:mergeToys',
  );

  await persister.destroy();
});

test('listens to no table when one is missing', async () => {
  const onIgnoredError = vi.fn();
  const tables = {pets: createMockTable()};
  const {connection} = createMockConnection(tables);
  const persister = createSpacetimeDbPersister(
    createMergeableStore(),
    connection,
    CONFIG,
    onIgnoredError,
  );

  await persister.startAutoLoad();
  expect(onIgnoredError.mock.calls.map(([{message}]) => message)).toEqual([
    'tinybase:17:table:tinybaseValues',
    'tinybase:17:table:tinybaseValues',
  ]);
  expect(tables.pets.callbacks.insert.size).toBe(0);
  expect(tables.pets.callbacks.update.size).toBe(0);

  await persister.destroy();
});

test('scopes a Table with a condition and fixed columns', async () => {
  const server = createServer();
  const forRoom = (room: string) => ({
    tables: {
      pets: {
        tableName: 'pets',
        fixedColumns: {room},
        condition: (row: any) => row.room.eq(room),
      },
    },
  });
  const store1 = createMergeableStore('s1').setCell(
    'pets',
    'fido',
    'species',
    'dog',
  );
  const persister1 = createSpacetimeDbPersister(
    store1,
    server.connection,
    forRoom('room1'),
  );
  await persister1.save();
  expect(server.reducers.mergePets).toHaveBeenCalledExactlyOnceWith({
    rows: [{room: 'room1', id: 'fido', species: 'dog', speciesHlc: anyHlc}],
  });
  expect(server.subscriptions[0].queries).toEqual([
    {table: 'pets', where: {eq: ['room', 'room1']}},
  ]);

  // The cache may hold other rooms' rows (when subscriptions share a
  // connection), so only rows with the fixed columns are loaded.
  server.tables.pets.set({
    id: 'felix',
    room: 'room2',
    species: 'cat',
    speciesHlc: 'Nn1JUF-----7JQY8',
  });
  const store2 = createMergeableStore('s2');
  const persister2 = createSpacetimeDbPersister(
    store2,
    server.connection,
    forRoom('room1'),
  );
  await persister2.startAutoLoad();
  expect(store2.getTables()).toEqual({pets: {fido: {species: 'dog'}}});
  server.tables.pets.set({
    id: 'rex',
    room: 'room2',
    species: 'dog',
    speciesHlc: 'Nn1JUF-----7JQY8',
  });
  await pause(10);
  expect(store2.getTables()).toEqual({pets: {fido: {species: 'dog'}}});

  await persister1.destroy();
  await persister2.destroy();
});

test('maps Cell Ids to column names, per-Table suffix', async () => {
  const tables = {pets: createMockTable(), tinybaseValues: createMockTable()};
  const {connection, reducers} = createMockConnection(tables);
  const config = {
    tables: {
      pets: {tableName: 'pets', columns: {species: 'kind', price: 'cost'}},
    },
    values: {hlcColumnSuffix: '_at'},
  };
  const store = createMergeableStore('s1')
    .setTables({pets: {fido: {species: 'dog', price: 5}}})
    .setValues({open: true});
  const persister = createSpacetimeDbPersister(store, connection, config);

  await persister.save();
  expect(reducers.mergePets).toHaveBeenCalledExactlyOnceWith({
    rows: [
      {id: 'fido', kind: 'dog', kindHlc: anyHlc, cost: 5, costHlc: anyHlc},
    ],
  });
  expect(reducers.mergeTinybaseValues).toHaveBeenCalledExactlyOnceWith({
    rows: [{id: '_', open: true, open_at: anyHlc}],
  });

  const store2 = createMergeableStore('s2');
  const persister2 = createSpacetimeDbPersister(store2, connection, config);
  await persister2.load();
  expect(store2.getContent()).toEqual(store.getContent());

  await persister.destroy();
  await persister2.destroy();
});

test('subscribes once to a table shared by several Tables', async () => {
  const server = createServer();
  const store = createMergeableStore();
  const persister = createSpacetimeDbPersister(store, server.connection, {
    tables: {pets: 'pets', animals: 'pets'},
  });
  server.tables.pets.set({
    id: 'fido',
    species: 'dog',
    speciesHlc: 'Nn1JUF-----7JQY8',
  });

  await persister.load();
  expect(server.subscriptions[0].queries).toEqual([{table: 'pets'}]);
  expect(store.getTables()).toEqual({
    pets: {fido: {species: 'dog'}},
    animals: {fido: {species: 'dog'}},
  });

  await persister.destroy();
});

test('fails rather than waits when the connection is lost', async () => {
  const onIgnoredError = vi.fn();
  const server = createServer({neverApply: true, reducerHangs: true});
  const store = createMergeableStore().setValue('open', true);
  const persister = createSpacetimeDbPersister(
    store,
    server.connection,
    CONFIG,
    onIgnoredError,
  );

  // A load waiting for the subscription fails when the connection drops...
  const load = persister.load();
  await pause();
  expect(onIgnoredError).not.toHaveBeenCalled();
  server.connection.disconnect();
  await load;
  expect(onIgnoredError).toHaveBeenCalledOnce();
  expect(onIgnoredError.mock.calls[0][0].message).toBe('tinybase:19');
  expect(server.connection.lifecycleCallbacks.disconnects.size).toBe(1);

  // ...as does anything attempted afterwards.
  await persister.save();
  expect(onIgnoredError).toHaveBeenCalledTimes(2);
  expect(server.subscriptions).toHaveLength(1);

  await persister.destroy();
  expect(server.connection.lifecycleCallbacks.disconnects.size).toBe(0);
  expect(server.connection.lifecycleCallbacks.connectErrors.size).toBe(0);

  // A save waiting for a reducer fails too, with the connection's own error.
  const error = new Error('socket closed');
  const server2 = createServer({reducerHangs: true});
  const persister2 = createSpacetimeDbPersister(
    createMergeableStore().setValue('open', true),
    server2.connection,
    CONFIG,
    onIgnoredError,
  );
  const save = persister2.save();
  await pause();
  server2.connection.connectError(error);
  await save;
  expect(onIgnoredError).toHaveBeenLastCalledWith(error);
  await persister2.destroy();
});

test('skips invalid or far-future clocks, and reports them', async () => {
  const onIgnoredError = vi.fn();
  const server = createServer();
  server.tables.pets.set({
    id: 'fido',
    species: 'dog',
    speciesHlc: 'not a clock',
    price: 5,
    priceHlc: 'zzzzzzzzzzzzzzzz',
    sold: true,
    soldHlc: 'Nn1JUF-----7JQY8',
  });
  const store = createMergeableStore();
  const persister = createSpacetimeDbPersister(
    store,
    server.connection,
    CONFIG,
    onIgnoredError,
  );

  await persister.load();
  expect(store.getTables()).toEqual({pets: {fido: {sold: true}}});
  expect(onIgnoredError.mock.calls.map(([{message}]) => message)).toEqual([
    'tinybase:13:not a clock',
    'tinybase:13:zzzzzzzzzzzzzzzz',
  ]);

  await persister.destroy();
});

test('a full save diffs against its own rows in a shared cache', async () => {
  // Rooms share one table, keyed by room and Row Id, over one connection.
  const byRoom = (row: Row) => row.room + ':' + row.id;
  const tables = {
    pets: createMockTable([], byRoom),
    tinybaseValues: createMockTable([], byRoom),
  };
  const {connection, reducers} = createMockConnection(tables);
  const forRoom = (room: string) => ({
    tables: {
      pets: {
        tableName: 'pets',
        fixedColumns: {room},
        condition: (row: any) => row.room.eq(room),
      },
    },
    values: {fixedColumns: {room}, condition: (row: any) => row.room.eq(room)},
  });
  tables.pets.set({
    room: 'room2',
    id: 'fido',
    species: 'cat',
    speciesHlc: 'zzzzzzzzzzzzzzzz',
  });
  const store = createMergeableStore('s1').setCell(
    'pets',
    'fido',
    'species',
    'dog',
  );
  const persister = createSpacetimeDbPersister(
    store,
    connection,
    forRoom('room1'),
  );

  // Room 2's newer clock for the same Row Id must not suppress the save.
  await persister.save();
  expect(reducers.mergePets).toHaveBeenCalledExactlyOnceWith({
    rows: [{room: 'room1', id: 'fido', species: 'dog', speciesHlc: anyHlc}],
  });
  await persister.save();
  expect(reducers.mergePets).toHaveBeenCalledOnce();

  // The same goes for the Values, whose rows all have the same Row Id.
  tables.tinybaseValues.set({
    room: 'room2',
    id: '_',
    open: false,
    openHlc: 'zzzzzzzzzzzzzzzz',
  });
  store.setValue('open', true);
  await persister.save();
  expect(reducers.mergeTinybaseValues).toHaveBeenCalledExactlyOnceWith({
    rows: [{room: 'room1', id: '_', open: true, openHlc: anyHlc}],
  });
  expect(store.getValues()).toEqual({open: true});

  await persister.destroy();
});

test('reports null Cells and column collisions', async () => {
  const onIgnoredError = vi.fn();
  const server = createServer();
  const store = createMergeableStore().setTables({
    pets: {
      fido: {species: 'dog', kind: 'mammal', sold: null, room: 'r', price: 5},
    },
  });
  const persister = createSpacetimeDbPersister(
    store,
    server.connection,
    {
      tables: {
        pets: {
          tableName: 'pets',
          columns: {species: 'kind'},
          fixedColumns: {room: 'room1'},
        },
      },
    },
    onIgnoredError,
  );

  await persister.save();
  expect(server.reducers.mergePets).toHaveBeenCalledExactlyOnceWith({
    rows: [
      {
        room: 'room1',
        id: 'fido',
        kind: 'dog',
        kindHlc: anyHlc,
        price: 5,
        priceHlc: anyHlc,
      },
    ],
  });
  expect(onIgnoredError.mock.calls.map(([{message}]) => message)).toEqual([
    'tinybase:18:pets:kind',
    'tinybase:18:pets:sold',
    'tinybase:18:pets:room',
  ]);

  await persister.destroy();
});

test('matches fixed columns by value, whatever the column type', async () => {
  const server = createServer();
  server.tables.pets.set({
    id: 'fido',
    room: 1n,
    species: 'dog',
    speciesHlc: 'Nn1JUF-----7JQY8',
  });
  server.tables.pets.set({
    id: 'felix',
    room: 2n,
    species: 'cat',
    speciesHlc: 'Nn1JUF-----7JQY8',
  });
  const store = createMergeableStore();
  const persister = createSpacetimeDbPersister(store, server.connection, {
    tables: {pets: {tableName: 'pets', fixedColumns: {room: 1}}},
  });

  await persister.load();
  expect(store.getTables()).toEqual({pets: {fido: {species: 'dog'}}});

  await persister.destroy();
});

test('resets only the failed subscription when one fails late', async () => {
  const error = new Error('no such table');
  const server = createServer();
  const store = createMergeableStore();
  const persister = createSpacetimeDbPersister(
    store,
    server.connection,
    CONFIG,
  );
  await persister.load();

  // Destroy and recreate, then an error for the old subscription arrives.
  await persister.destroy();
  const persister2 = createSpacetimeDbPersister(
    store,
    server.connection,
    CONFIG,
  );
  await persister2.load();
  server.subscriptions[0].onError?.({event: error}, error);
  await pause();
  await persister2.load();
  expect(server.subscriptions).toHaveLength(2);

  await persister2.destroy();
  expect(server.subscriptions[1].unsubscribe).toHaveBeenCalledOnce();
});
