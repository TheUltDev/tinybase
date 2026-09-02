import type {SpacetimeDbConnection} from '../../@types/persisters/persister-spacetimedb/index.d.ts';
import {collClear, collDel, collForEach} from '../../common/coll.ts';
import {
  ERROR_SPACETIMEDB_DISCONNECTED,
  ERROR_SPACETIMEDB_MISSING,
  errorNew,
  tryCatch,
} from '../../common/error.ts';
import {isUndefined, promiseNew} from '../../common/other.ts';
import {setAdd, setNew} from '../../common/set.ts';

export type Row = {[columnName: string]: any};
export type RowCallback = (context: unknown, ...rows: Row[]) => void;
export type Table = {
  iter(): Iterable<Row>;
  onInsert(callback: RowCallback): void;
  onUpdate(callback: RowCallback): void;
  removeOnInsert(callback: RowCallback): void;
  removeOnUpdate(callback: RowCallback): void;
};
export type Reducer = (params: Row) => Promise<void>;
export type Unlisten = () => void;
type Subscription = {unsubscribe(): void};
type Reject = (error: Error) => void;

export const ID = 'id';
export const TABLE = 'table';
export const REDUCER = 'reducer';

export const capitalize = (name: string): string =>
  name.charAt(0).toUpperCase() + name.slice(1);

export const errorMissing = (thing: string, name: string): never => {
  throw errorNew(ERROR_SPACETIMEDB_MISSING, thing + ':' + name);
};

export const getTable = (
  connection: SpacetimeDbConnection,
  tableName: string,
): Table => connection.db[tableName] ?? errorMissing(TABLE, tableName);

export const getReducer = (
  connection: SpacetimeDbConnection,
  reducerName: string,
): Reducer =>
  connection.reducers[reducerName] ?? errorMissing(REDUCER, reducerName);

export const tableForEach = (
  table: Table,
  callback: (row: Row) => void,
): void => {
  for (const row of table.iter()) {
    callback(row);
  }
};

// Rows are never removed from the tables used here (deletions are kept as
// tombstones), so only inserts and updates are listened to.
export const listenToTable = (
  table: Table,
  onInsert: (row: Row) => void,
  onUpdate: (oldRow: Row, newRow: Row) => void,
): Unlisten => {
  const insert: RowCallback = (_context, row) => onInsert(row);
  const update: RowCallback = (_context, oldRow, newRow) =>
    onUpdate(oldRow, newRow);
  table.onInsert(insert);
  table.onUpdate(update);
  return () => {
    table.removeOnInsert(insert);
    table.removeOnUpdate(update);
  };
};

// Lazily subscribes to the given queries (once, for the life of the Persister
// or Synchronizer), fails anything waiting on the connection when it is lost
// (the SDK never reconnects, or settles what it was waiting for), and
// provides the extra methods common to all of them.
export const createSubscriber = (
  connection: SpacetimeDbConnection,
  getQueries: (getTableRef: (tableName: string) => any) => any[],
  onIgnoredError?: (error: any) => void,
): [
  subscribe: () => Promise<void>,
  untilLost: <Value>(promise: Promise<Value>) => Promise<Value>,
  extra: {[methodName: string]: (...params: any[]) => any},
] => {
  let subscription: Subscription | undefined;
  let applied: Promise<void> | undefined;
  let lost: Error | undefined;
  const waiting = setNew<Reject>();

  const onLost = (_context: unknown, error?: Error) => {
    lost = error ?? errorNew(ERROR_SPACETIMEDB_DISCONNECTED);
    applied = subscription = undefined;
    collForEach(waiting, (reject) => reject(lost as Error));
    collClear(waiting);
  };
  connection.onDisconnect?.(onLost);
  connection.onConnectError?.(onLost);

  const untilLost = <Value>(promise: Promise<Value>): Promise<Value> =>
    promiseNew((resolve, reject) => {
      setAdd(waiting, reject);
      promise.then(
        (value) => {
          collDel(waiting, reject);
          resolve(value);
        },
        (error) => {
          collDel(waiting, reject);
          reject(error);
        },
      );
    });

  const subscribe = (): Promise<void> => {
    if (lost) {
      return promiseNew((_resolve, reject) => reject(lost));
    }
    if (isUndefined(applied)) {
      const thisApplied: Promise<void> = (applied = untilLost(
        promiseNew<void>((resolve, reject) => {
          subscription = connection
            .subscriptionBuilder()
            .onApplied(() => resolve())
            .onError((_context: unknown, error: Error) => reject(error))
            .subscribe((tables: any) =>
              getQueries(
                (tableName) =>
                  tables[tableName] ?? errorMissing(TABLE, tableName),
              ),
            );
        }),
      ).catch((error) => {
        // Only the failed subscription's state is reset, in case a new
        // one has been started in the meantime.
        if (applied == thisApplied) {
          applied = subscription = undefined;
        }
        throw error;
      }));
    }
    return applied;
  };

  const destroy = () => {
    connection.removeOnDisconnect?.(onLost);
    connection.removeOnConnectError?.(onLost);
    const ended = subscription;
    applied = subscription = undefined;
    return tryCatch(() => ended?.unsubscribe(), onIgnoredError);
  };

  return [subscribe, untilLost, {getDbConnection: () => connection, destroy}];
};
