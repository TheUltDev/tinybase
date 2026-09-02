import type {Hlc, Id} from '../../@types/common/index.d.ts';
import type {
  MergeableChanges,
  MergeableContent,
  MergeableStore,
  RowStamp,
  TableStamp,
  ValuesStamp,
} from '../../@types/mergeable-store/index.d.ts';
import type {
  PersisterListener,
  Persists,
} from '../../@types/persisters/index.d.ts';
import type {
  SpacetimeDbConnection,
  SpacetimeDbPersister,
  SpacetimeDbPersisterConfig,
  SpacetimeDbPersisterTableConfig,
  createSpacetimeDbPersister as createSpacetimeDbPersisterDecl,
} from '../../@types/persisters/persister-spacetimedb/index.d.ts';
import type {Cell, CellOrUndefined} from '../../@types/store/index.d.ts';
import {arrayForEach, arrayMap, arrayPush} from '../../common/array.ts';
import {collClear, collHas} from '../../common/coll.ts';
import {
  ERROR_HLC,
  ERROR_SPACETIMEDB_CELL,
  errorNew,
  tryCatch,
  tryFinallyAsync,
} from '../../common/error.ts';
import {HLC_MAX_FUTURE_OFFSET, isHlc} from '../../common/hlc.ts';
import {mapEnsure, mapMap, mapNew} from '../../common/map.ts';
import {
  objEnsure,
  objEvery,
  objForEach,
  objHas,
  objIsEmpty,
  objMap,
  objNew,
  objToArray,
  objValues,
} from '../../common/obj.ts';
import {
  ifNotUndefined,
  isEmpty,
  isFiniteNumber,
  isNull,
  isNullish,
  isNumber,
  isString,
  isUndefined,
  promiseAll,
  promiseResolve,
} from '../../common/other.ts';
import {setAdd, setNew} from '../../common/set.ts';
import {stampNewObj} from '../../common/stamps.ts';
import {EMPTY_STRING, strEndsWith} from '../../common/strings.ts';
import {createCustomPersister} from '../common/create.ts';
import {SINGLE_ROW_ID} from '../common/database/common.ts';
import {
  ID,
  type Row,
  type Table,
  type Unlisten,
  capitalize,
  createSubscriber,
  getReducer,
  getTable,
  listenToTable,
  tableForEach,
} from './common.ts';

type Persist = Persists.MergeableStoreOnly;
type TableConfig = [
  tableName: string,
  rowIdColumnName: string,
  reducerName: string,
  hlcColumnSuffix: string,
  columns: {[cellId: Id]: string},
  cellIds: {[column: string]: Id},
  fixedColumns: Row,
  condition: ((row: any) => any) | undefined,
];
// The Values are identified by an undefined Table Id.
type TableIdOrValues = Id | undefined;
type Rows = {[rowId: Id]: Row};
type CellStamps = {[cellId: Id]: [thing: CellOrUndefined, hlc: Hlc, ...any[]]};

const MERGE = 'merge';
const ROWS = 'rows';
const HLC_COLUMN_SUFFIX = 'Hlc';
const VALUES_TABLE_NAME = 'tinybaseValues';

const toCell = (value: any): Cell | undefined =>
  isString(value) || value === true || value === false
    ? value
    : isNumber(value) && isFiniteNumber(value)
      ? value
      : typeof value == 'bigint'
        ? Number(value)
        : undefined;

// Changes with no clocks on their containers, as a MergeableStore's own are.
const newChanges = (): MergeableChanges => [stampNewObj(), stampNewObj(), 1];

export const createSpacetimeDbPersister = ((
  store: MergeableStore,
  connection: SpacetimeDbConnection,
  {
    tables = {},
    values = false,
    hlcColumnSuffix = HLC_COLUMN_SUFFIX,
  }: SpacetimeDbPersisterConfig,
  onIgnoredError?: (error: any) => void,
): SpacetimeDbPersister => {
  const toTableConfig = (
    config: Partial<SpacetimeDbPersisterTableConfig>,
    tableName = config.tableName as string,
  ): TableConfig => {
    const columns = config.columns ?? {};
    return [
      tableName,
      config.rowIdColumnName ?? ID,
      config.reducerName ?? MERGE + capitalize(tableName),
      config.hlcColumnSuffix ?? hlcColumnSuffix,
      columns,
      objNew(objToArray(columns, (column, cellId) => [column, cellId])),
      config.fixedColumns ?? {},
      config.condition,
    ];
  };
  const tableConfigs: {[tableId: Id]: TableConfig} = objMap(tables, (config) =>
    toTableConfig(isString(config) ? {tableName: config} : config),
  );
  const valuesConfig = values
    ? toTableConfig(
        values === true ? {} : values,
        (values === true ? undefined : values.tableName) ?? VALUES_TABLE_NAME,
      )
    : undefined;
  const allConfigs: [TableIdOrValues, TableConfig][] = objToArray(
    tableConfigs,
    (config, tableId): [TableIdOrValues, TableConfig] => [tableId, config],
  );
  if (valuesConfig) {
    arrayPush(allConfigs, [undefined, valuesConfig]);
  }

  const [subscribeToTables, untilLost, extra] = createSubscriber(
    connection,
    (getTableRef) => {
      const whole = setNew<string>();
      const queries: any[] = [];
      arrayForEach(allConfigs, ([, [tableName, , , , , , , condition]]) => {
        if (condition) {
          arrayPush(queries, getTableRef(tableName).where(condition));
        } else if (!collHas(whole, tableName)) {
          setAdd(whole, tableName);
          arrayPush(queries, getTableRef(tableName).build());
        }
      });
      return queries;
    },
    onIgnoredError,
  );
  // With nothing configured, there is nothing to subscribe to.
  const subscribe = isEmpty(allConfigs) ? promiseResolve : subscribeToTables;

  // Callbacks are redundant while a load is about to scan the whole cache.
  let loading = 0;
  // The clocks of Cells being saved, whose echoes need no merging.
  const inFlight = setNew<Hlc>();

  // Every configured table, resolved up front so that a missing one fails
  // before anything is done with the others.
  const getTables = (): [TableIdOrValues, TableConfig, Table][] =>
    arrayMap(allConfigs, ([tableId, config]) => [
      tableId,
      config,
      getTable(connection, config[0]),
    ]);

  // The Row Id of a row that belongs to this Persister's Store: one with a
  // string Id (the single one, for Values) and the fixed columns, since the
  // cache of a table may be shared with subscriptions to other Stores' rows.
  const getRowId = (
    tableId: TableIdOrValues,
    [, rowIdColumnName, , , , , fixedColumns]: TableConfig,
    row: Row,
  ): Id | undefined => {
    const rowId = row[rowIdColumnName];
    return isString(rowId) &&
      (!isUndefined(tableId) || rowId == SINGLE_ROW_ID) &&
      objEvery(fixedColumns, (value, column) => toCell(row[column]) === value)
      ? rowId
      : undefined;
  };

  // Adds the stamped Cells (or Values) of a row to the changes, and returns
  // how many. A Cell is a column with a valid clock column beside it, whose
  // clock has changed (if an old row is given) and is not one this Persister
  // is itself saving.
  const addRowStamps = (
    getChanges: () => MergeableChanges,
    tableId: TableIdOrValues,
    config: TableConfig,
    row: Row,
    oldRow?: Row,
  ): number => {
    let added = 0;
    ifNotUndefined(getRowId(tableId, config, row), (rowId) => {
      const [, rowIdColumnName, , suffix, , cellIds] = config;
      const maxHlcTime = Date.now() + HLC_MAX_FUTURE_OFFSET;
      let thingsStamp: RowStamp | ValuesStamp | undefined;
      objForEach(row, (value, column) => {
        if (column != rowIdColumnName && !strEndsWith(column, suffix)) {
          const hlcColumn = column + suffix;
          const hlc = row[hlcColumn];
          if (
            isString(hlc) &&
            hlc != EMPTY_STRING &&
            oldRow?.[hlcColumn] != hlc &&
            !collHas(inFlight, hlc)
          ) {
            const cell = toCell(value);
            if (!isHlc(hlc, maxHlcTime)) {
              // An invalid clock would have the Store reject the whole merge.
              onIgnoredError?.(errorNew(ERROR_HLC, hlc));
            } else if (isNullish(value) || !isUndefined(cell)) {
              const thingStamps = (thingsStamp ??= isUndefined(tableId)
                ? getChanges()[1]
                : objEnsure<RowStamp>(
                    objEnsure<TableStamp>(
                      getChanges()[0][0],
                      tableId,
                      stampNewObj,
                    )[0],
                    rowId,
                    stampNewObj,
                  ))[0];
              const cellId = cellIds[column] ?? column;
              const existing = thingStamps[cellId] as [any, Hlc] | undefined;
              if (isUndefined(existing) || existing[1] < hlc) {
                thingStamps[cellId] = [cell, hlc];
                added++;
              }
            }
          }
        }
      });
    });
    return added;
  };

  const getPersisted = (): Promise<MergeableContent | undefined> =>
    tryFinallyAsync(
      async () => {
        loading++;
        await subscribe();
        const changes = newChanges();
        const getChanges = () => changes;
        let added = 0;
        arrayForEach(getTables(), ([tableId, config, table]) =>
          tableForEach(table, (row) => {
            added += addRowStamps(getChanges, tableId, config, row);
          }),
        );
        // Returned as changes, so that they are merged into the Store rather
        // than replacing its content.
        return added ? (changes as any) : undefined;
      },
      () => {
        loading--;
      },
    );

  const setPersisted = async (
    getContent: () => MergeableContent,
    changes?: MergeableChanges<true>,
  ): Promise<void> => {
    // A full save only sends Cells that the database lacks, or has older
    // versions of, which the subscribed client cache reveals.
    await subscribe();
    const cached = mapNew<TableConfig, Rows>();
    if (isUndefined(changes)) {
      arrayForEach(getTables(), ([tableId, config, table]) => {
        const rows: Rows = objNew();
        tableForEach(table, (row) =>
          ifNotUndefined(getRowId(tableId, config, row), (rowId) => {
            rows[rowId] = row;
          }),
        );
        cached.set(config, rows);
      });
    }

    const rowsToSend = mapNew<TableConfig, Rows>();
    const addRow = (
      config: TableConfig,
      rowId: Id,
      cellStamps: CellStamps,
    ): void => {
      const [tableName, rowIdColumnName, , suffix, columns, , fixedColumns] =
        config;
      const cachedRow = cached.get(config)?.[rowId];
      let row: Row | undefined;
      objForEach(cellStamps, ([thing, hlc], cellId) => {
        const column = columns[cellId] ?? cellId;
        if (
          isNull(thing) ||
          column == rowIdColumnName ||
          strEndsWith(column, suffix) ||
          objHas(row ?? fixedColumns, column)
        ) {
          // A null Cell has no typed column to go in, and a Cell cannot share
          // a column with the Row Id, a clock, a fixed column, or another
          // Cell.
          onIgnoredError?.(
            errorNew(ERROR_SPACETIMEDB_CELL, tableName + ':' + cellId),
          );
        } else if (hlc != EMPTY_STRING) {
          const hlcColumn = column + suffix;
          if (!(cachedRow?.[hlcColumn] >= hlc)) {
            row ??= {...fixedColumns, [rowIdColumnName]: rowId};
            row[column] = thing;
            row[hlcColumn] = hlc;
            setAdd(inFlight, hlc);
          }
        }
      });
      if (row) {
        mapEnsure(rowsToSend, config, objNew)[rowId] = row;
      }
    };
    const [[tablesObj], [valuesObj]]: MergeableContent = (changes ??
      getContent()) as any;
    objForEach(tablesObj, ([rows], tableId) =>
      ifNotUndefined(tableConfigs[tableId], (config) =>
        objForEach(rows, ([cellStamps], rowId) =>
          addRow(config, rowId, cellStamps as CellStamps),
        ),
      ),
    );
    if (valuesConfig && !objIsEmpty(valuesObj)) {
      addRow(valuesConfig, SINGLE_ROW_ID, valuesObj as CellStamps);
    }

    // One reducer call, and hence one transaction, per Table. Their echoes
    // arrive before they resolve, and need no merging. Saves are run one at
    // a time by the Persister, so the clocks in flight are just this save's.
    const errors: any[] = [];
    await promiseAll(
      mapMap(rowsToSend, (rows, [, , reducerName]) =>
        tryCatch(
          () =>
            untilLost(
              getReducer(connection, reducerName)({[ROWS]: objValues(rows)}),
            ),
          (error) => arrayPush(errors, error),
        ),
      ),
    );
    collClear(inFlight);
    if (!isEmpty(errors)) {
      throw errors[0];
    }
  };

  const addPersisterListener = (
    listener: PersisterListener<Persist>,
  ): Unlisten => {
    // The SDK fires one callback per row per SpacetimeDB transaction, so the
    // stamps are coalesced into one merge per microtask.
    let pending: MergeableChanges | undefined;
    const getChanges = () => (pending ??= newChanges());
    const flush = () => {
      const changes = pending;
      pending = undefined;
      void tryCatch(() => listener(undefined, changes), onIgnoredError);
    };
    const stops = arrayMap(getTables(), ([tableId, config, table]) => {
      const onRow = (row: Row, oldRow?: Row) => {
        if (!loading) {
          const wasPending = !isUndefined(pending);
          addRowStamps(getChanges, tableId, config, row, oldRow);
          if (!wasPending && !isUndefined(pending)) {
            void promiseResolve().then(flush);
          }
        }
      };
      return listenToTable(table, onRow, (oldRow, newRow) =>
        onRow(newRow, oldRow),
      );
    });
    return () => arrayForEach(stops, (stop) => stop());
  };

  const delPersisterListener = (unlisten: Unlisten): void => unlisten();

  return createCustomPersister(
    store,
    getPersisted,
    setPersisted,
    addPersisterListener,
    delPersisterListener,
    onIgnoredError,
    2, // MergeableStoreOnly,
    extra,
  ) as SpacetimeDbPersister;
}) as typeof createSpacetimeDbPersisterDecl;
