/// synchronizer-spacetimedb
import type {MergeableStore} from '../../mergeable-store/index.d.ts';
import type {SpacetimeDbConnection} from '../../persisters/persister-spacetimedb/index.d.ts';
import type {Receive, Send, Synchronizer} from '../index.d.ts';

/// SpacetimeDbSynchronizer
export interface SpacetimeDbSynchronizer extends Synchronizer {
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
export function createSpacetimeDbSynchronizer(
  store: MergeableStore,
  connection: SpacetimeDbConnection,
  configOrChannelName?: SpacetimeDbSynchronizerConfig | string,
  onSend?: Send,
  onReceive?: Receive,
  onIgnoredError?: (error: any) => void,
): SpacetimeDbSynchronizer;
