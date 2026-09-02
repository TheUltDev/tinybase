/// synchronizer-spacetimedb
import type {MergeableStore} from '../../../mergeable-store/with-schemas/index.d.ts';
import type {SpacetimeDbConnection} from '../../../persisters/persister-spacetimedb/with-schemas/index.d.ts';
import type {OptionalSchemas} from '../../../store/with-schemas/index.d.ts';
import type {Receive, Send, Synchronizer} from '../../with-schemas/index.d.ts';

/// SpacetimeDbSynchronizer
export interface SpacetimeDbSynchronizer<
  Schemas extends OptionalSchemas,
> extends Synchronizer<Schemas> {
  /// SpacetimeDbSynchronizer.getChannelName
  getChannelName(): string;
  /// SpacetimeDbSynchronizer.getDbConnection
  getDbConnection(): SpacetimeDbConnection;
}

/// SpacetimeDbSynchronizerConfig
export type SpacetimeDbSynchronizerConfig = {
  /// SpacetimeDbSynchronizerConfig.channelName
  channelName?: string;
  /// SpacetimeDbSynchronizerConfig.tableName
  tableName?: string;
  /// SpacetimeDbSynchronizerConfig.reducerName
  reducerName?: string;
  /// SpacetimeDbSynchronizerConfig.requestTimeoutSeconds
  requestTimeoutSeconds?: number;
};

/// createSpacetimeDbSynchronizer
export function createSpacetimeDbSynchronizer<Schemas extends OptionalSchemas>(
  store: MergeableStore<Schemas>,
  connection: SpacetimeDbConnection,
  configOrChannelName?: SpacetimeDbSynchronizerConfig | string,
  onSend?: Send,
  onReceive?: Receive,
  onIgnoredError?: (error: any) => void,
): SpacetimeDbSynchronizer<Schemas>;
