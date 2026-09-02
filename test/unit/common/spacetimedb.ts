import {vi} from 'vitest';

type Row = {[column: string]: any};
type Callback = (context: unknown, ...rows: Row[]) => void;
type Subscription = {
  queries: any[];
  applied: boolean;
  onApplied?: () => void;
  onError?: (context: any, error: Error) => void;
  unsubscribe: ReturnType<typeof vi.fn>;
};
export type MockSyncServerOptions = {
  tableName?: string;
  reducerName?: string;
  errorOnSubscribe?: Error;
  reducerError?: Error;
};

// Whether a row matches a query's plain-data where clause.
export const matchesQuery = ({where}: any, row: Row): boolean => {
  const matches = (expr: any): boolean =>
    expr.eq
      ? row[expr.eq[0]] == expr.eq[1]
      : expr.ne
        ? row[expr.ne[0]] != expr.ne[1]
        : expr.allOf
          ? expr.allOf.every(matches)
          : expr.anyOf.some(matches);
  return where ? matches(where) : true;
};

// Just enough of the SpacetimeDB SDK's client cache for an event table: rows
// are never stored, and only insert callbacks fire.
export const createMockEventTable = () => {
  const callbacks = new Set<Callback>();
  const others = new Set<Callback>();
  return {
    iter: () => [][Symbol.iterator](),
    count: () => 0n,
    onInsert: (callback: Callback) => callbacks.add(callback),
    onUpdate: (callback: Callback) => others.add(callback),
    onDelete: (callback: Callback) => others.add(callback),
    removeOnInsert: (callback: Callback) => callbacks.delete(callback),
    removeOnUpdate: (callback: Callback) => others.delete(callback),
    removeOnDelete: (callback: Callback) => others.delete(callback),
    insert: (row: Row) => callbacks.forEach((callback) => callback({}, row)),
    // A real event table never fires these; used to check they are ignored.
    other: (row: Row) => others.forEach((callback) => callback({}, row, row)),
    callbacks,
  };
};

// Query builders for the given tables, whose expressions are plain data (with
// non-enumerable and/or methods) so that they can be compared with toEqual.
export const createMockQueryBuilders = (tableNames: string[]) => {
  const expr = (data: any) =>
    Object.defineProperties(data, {
      and: {value: (other: any) => expr({allOf: [data, other]})},
      or: {value: (other: any) => expr({anyOf: [data, other]})},
    });
  const row = new Proxy(
    {},
    {
      get: (_, column) => ({
        eq: (value: any) => expr({eq: [column, value]}),
        ne: (value: any) => expr({ne: [column, value]}),
      }),
    },
  );
  return Object.fromEntries(
    tableNames.map((tableName) => [
      tableName,
      {
        build: () => ({table: tableName}),
        where: (predicate: (row: any) => any) => ({
          table: tableName,
          where: predicate(row),
        }),
      },
    ]),
  );
};

// The connection lifecycle callbacks that the SDK's DbConnection has, and a
// way to trigger them.
export const createMockLifecycle = () => {
  type Lifecycle = (context: any, error?: Error) => void;
  const disconnects = new Set<Lifecycle>();
  const connectErrors = new Set<Lifecycle>();
  return {
    onDisconnect: (callback: Lifecycle): void => {
      disconnects.add(callback);
    },
    onConnectError: (callback: Lifecycle): void => {
      connectErrors.add(callback);
    },
    removeOnDisconnect: (callback: Lifecycle): void => {
      disconnects.delete(callback);
    },
    removeOnConnectError: (callback: Lifecycle): void => {
      connectErrors.delete(callback);
    },
    disconnect: (error?: Error) =>
      disconnects.forEach((callback) => callback({}, error)),
    connectError: (error: Error) =>
      connectErrors.forEach((callback) => callback({}, error)),
    lifecycleCallbacks: {disconnects, connectErrors},
  };
};

// A mock SpacetimeDB server hosting one sync event table. Each connection has
// its own cache of it, and receives an event once per applied subscription
// that matches it, delivered asynchronously as over a real network (via
// setImmediate, since setTimeout has coarse granularity on some platforms).
export const createMockSyncServer = (options: MockSyncServerOptions = {}) => {
  const {tableName = 'tinybaseSync', reducerName = 'sendTinybaseSync'} =
    options;
  const subscriptions: Subscription[] = [];
  const connections: {
    table: ReturnType<typeof createMockEventTable>;
    subscriptions: Subscription[];
  }[] = [];
  const queryBuilders = createMockQueryBuilders([tableName]);

  const deliver = (row: Row) =>
    connections.forEach(({table, subscriptions}) =>
      subscriptions.forEach((subscription) => {
        if (
          subscription.applied &&
          subscription.queries.some((query) => matchesQuery(query, row))
        ) {
          table.insert(row);
        }
      }),
    );

  const createConnection = () => {
    const table = createMockEventTable();
    const own: Subscription[] = [];
    connections.push({table, subscriptions: own});
    return {
      db: {[tableName]: table},
      reducers: {
        [reducerName]: vi.fn(async (row: Row) => {
          if (options.reducerError) {
            throw options.reducerError;
          }
          await new Promise((resolve) => setImmediate(resolve));
          deliver(row);
        }),
      },
      subscriptionBuilder: () => {
        const subscription: Subscription = {
          queries: [],
          applied: false,
          unsubscribe: vi.fn(() => {
            subscription.applied = false;
          }),
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
            own.push(subscription);
            setImmediate(() => {
              const {errorOnSubscribe} = options;
              if (errorOnSubscribe) {
                subscription.onError?.(
                  {event: errorOnSubscribe},
                  errorOnSubscribe,
                );
              } else {
                subscription.applied = true;
                subscription.onApplied?.();
              }
            });
            return subscription;
          },
        };
        return builder;
      },
      ...createMockLifecycle(),
    };
  };

  return {subscriptions, createConnection, options};
};
