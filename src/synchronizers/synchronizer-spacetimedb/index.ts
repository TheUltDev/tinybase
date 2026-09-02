import type {IdOrNull} from '../../@types/common/index.d.ts';
import type {MergeableStore} from '../../@types/mergeable-store/index.d.ts';
import type {SpacetimeDbConnection} from '../../@types/persisters/persister-spacetimedb/index.d.ts';
import type {
  Message,
  Receive,
  Send,
} from '../../@types/synchronizers/index.d.ts';
import type {
  SpacetimeDbSynchronizer,
  SpacetimeDbSynchronizerConfig,
  createSpacetimeDbSynchronizer as createSpacetimeDbSynchronizerDecl,
} from '../../@types/synchronizers/synchronizer-spacetimedb/index.d.ts';
import {getUniqueId} from '../../common/codec.ts';
import {
  ERROR_SYNC_MESSAGE,
  errorNew,
  tryCatch,
  tryCatchSync,
  tryReturn,
} from '../../common/error.ts';
import {
  jsonParseWithUndefined,
  jsonStringWithUndefined,
} from '../../common/json.ts';
import {isArray, isString, noop, size} from '../../common/other.ts';
import {EMPTY_STRING, TINYBASE} from '../../common/strings.ts';
import {
  type Row,
  type Unlisten,
  createSubscriber,
  getReducer,
  getTable,
  listenToTable,
} from '../../persisters/persister-spacetimedb/common.ts';
import {createCustomSynchronizer} from '../index.ts';

const TABLE_NAME = 'tinybaseSync';
const REDUCER_NAME = 'sendTinybaseSync';
const CHANNEL = 'channel';
const FROM_CLIENT_ID = 'fromClientId';
const TO_CLIENT_ID = 'toClientId';
const PAYLOAD = 'payload';

export const createSpacetimeDbSynchronizer = ((
  store: MergeableStore,
  connection: SpacetimeDbConnection,
  configOrChannelName?: SpacetimeDbSynchronizerConfig | string,
  onSend?: Send,
  onReceive?: Receive,
  onIgnoredError?: (error: any) => void,
): SpacetimeDbSynchronizer => {
  const {
    channelName = TINYBASE,
    tableName = TABLE_NAME,
    reducerName = REDUCER_NAME,
    requestTimeoutSeconds = 1,
  } = isString(configOrChannelName)
    ? {channelName: configOrChannelName}
    : (configOrChannelName ?? {});
  const clientId = getUniqueId();
  // Only this channel's events from other clients that are broadcast or
  // addressed to this client are subscribed to, filtered on the server.
  const [subscribe, , extra] = createSubscriber(
    connection,
    (getTableRef) => [
      getTableRef(tableName).where((row: any) =>
        row[CHANNEL].eq(channelName)
          .and(row[FROM_CLIENT_ID].ne(clientId))
          .and(
            row[TO_CLIENT_ID].eq(EMPTY_STRING).or(
              row[TO_CLIENT_ID].eq(clientId),
            ),
          ),
      ),
    ],
    onIgnoredError,
  );
  let unlisten: Unlisten = noop;

  // Subscribes if not already (or not any more, after a subscription error).
  const ensureSubscribed = (fail?: (error: Error) => void) =>
    void subscribe().catch((error) => {
      onIgnoredError?.(error);
      fail?.(error);
    });

  const send = (
    toClientId: IdOrNull,
    requestId: IdOrNull,
    message: Message,
    body: any,
  ): void => {
    ensureSubscribed();
    void tryCatch(
      () =>
        getReducer(
          connection,
          reducerName,
        )({
          [CHANNEL]: channelName,
          [FROM_CLIENT_ID]: clientId,
          [TO_CLIENT_ID]: toClientId ?? EMPTY_STRING,
          [PAYLOAD]: jsonStringWithUndefined([requestId, message, body]),
        }),
      onIgnoredError,
    );
  };

  const registerReceive = (
    receive: Receive,
    fail: (error: Error) => void,
  ): void => {
    const table = getTable(connection, tableName);
    ensureSubscribed(fail);
    // Event tables never hold rows, so only inserts ever fire. The server
    // filter is repeated here in case the table's cache is shared.
    unlisten = listenToTable(
      table,
      (row: Row) =>
        tryCatchSync(() => {
          const fromClientId = row[FROM_CLIENT_ID];
          const toClientId = row[TO_CLIENT_ID];
          if (
            row[CHANNEL] == channelName &&
            isString(fromClientId) &&
            fromClientId != clientId &&
            (toClientId == EMPTY_STRING || toClientId == clientId)
          ) {
            const data = tryReturn(() => jsonParseWithUndefined(row[PAYLOAD]));
            if (isArray(data) && size(data) == 3) {
              receive(
                fromClientId,
                data[0] as IdOrNull,
                data[1] as Message,
                data[2],
              );
            } else {
              onIgnoredError?.(errorNew(ERROR_SYNC_MESSAGE));
            }
          }
        }, onIgnoredError),
      noop,
    );
  };

  const destroy = (): void => {
    unlisten();
    void extra.destroy();
  };

  return createCustomSynchronizer(
    store,
    send,
    registerReceive,
    destroy,
    requestTimeoutSeconds,
    onSend,
    onReceive,
    onIgnoredError,
    {
      getChannelName: () => channelName,
      getDbConnection: extra.getDbConnection,
    },
  ) as SpacetimeDbSynchronizer;
}) as typeof createSpacetimeDbSynchronizerDecl;
