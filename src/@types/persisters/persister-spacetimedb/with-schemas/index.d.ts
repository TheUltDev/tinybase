/// persister-spacetimedb
import type {Id} from '../../../common/with-schemas/index.d.ts';
import type {MergeableStore} from '../../../mergeable-store/with-schemas/index.d.ts';
import type {OptionalSchemas} from '../../../store/with-schemas/index.d.ts';
import type {Persister, Persists} from '../../with-schemas/index.d.ts';

/// SpacetimeDbConnection
export type SpacetimeDbConnection = {
  /// SpacetimeDbConnection.db
  db: {[tableName: string]: any};
  /// SpacetimeDbConnection.reducers
  reducers: {[reducerName: string]: (params: any) => Promise<void>};
  /// SpacetimeDbConnection.subscriptionBuilder
  subscriptionBuilder(): any;
  /// SpacetimeDbConnection.onDisconnect
  onDisconnect?(callback: (context: any, error?: Error) => void): void;
  /// SpacetimeDbConnection.onConnectError
  onConnectError?(callback: (context: any, error?: Error) => void): void;
  /// SpacetimeDbConnection.removeOnDisconnect
  removeOnDisconnect?(callback: (context: any, error?: Error) => void): void;
  /// SpacetimeDbConnection.removeOnConnectError
  removeOnConnectError?(callback: (context: any, error?: Error) => void): void;
};

/// SpacetimeDbPersister
export interface SpacetimeDbPersister<
  Schemas extends OptionalSchemas,
> extends Persister<Schemas, Persists.MergeableStoreOnly> {
  /// SpacetimeDbPersister.getDbConnection
  getDbConnection(): SpacetimeDbConnection;
}

/// SpacetimeDbPersisterConfig
export type SpacetimeDbPersisterConfig = {
  /// SpacetimeDbPersisterConfig.tables
  tables?: SpacetimeDbPersisterTables;
  /// SpacetimeDbPersisterConfig.values
  values?: SpacetimeDbPersisterValues | boolean;
  /// SpacetimeDbPersisterConfig.hlcColumnSuffix
  hlcColumnSuffix?: string;
};

/// SpacetimeDbPersisterTables
export type SpacetimeDbPersisterTables = {
  [tableId: string]: SpacetimeDbPersisterTableConfig | string;
};

/// SpacetimeDbPersisterTableConfig
export type SpacetimeDbPersisterTableConfig = {
  /// SpacetimeDbPersisterTableConfig.tableName
  tableName: string;
  /// SpacetimeDbPersisterTableConfig.rowIdColumnName
  rowIdColumnName?: string;
  /// SpacetimeDbPersisterTableConfig.reducerName
  reducerName?: string;
  /// SpacetimeDbPersisterTableConfig.hlcColumnSuffix
  hlcColumnSuffix?: string;
  /// SpacetimeDbPersisterTableConfig.columns
  columns?: {[cellId: Id]: string};
  /// SpacetimeDbPersisterTableConfig.fixedColumns
  fixedColumns?: {[columnName: string]: string | number | boolean};
  /// SpacetimeDbPersisterTableConfig.condition
  condition?: (row: any) => any;
};

/// SpacetimeDbPersisterValues
export type SpacetimeDbPersisterValues =
  Partial<SpacetimeDbPersisterTableConfig>;

/// createSpacetimeDbPersister
export function createSpacetimeDbPersister<Schemas extends OptionalSchemas>(
  store: MergeableStore<Schemas>,
  connection: SpacetimeDbConnection,
  config: SpacetimeDbPersisterConfig,
  onIgnoredError?: (error: any) => void,
): SpacetimeDbPersister<Schemas>;
