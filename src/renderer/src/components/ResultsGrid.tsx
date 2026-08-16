import { useMemo } from 'react';
import { AgGridReact } from 'ag-grid-react';
import {
  themeQuartz, colorSchemeDark, type ColDef, type IDatasource, type IGetRowsParams,
} from 'ag-grid-community';
import { tabById } from '../../../shared/tabs';

const pulseTheme = themeQuartz.withPart(colorSchemeDark).withParams({
  backgroundColor: '#111418',
  headerBackgroundColor: '#1a1f27',
  oddRowBackgroundColor: '#151a21',
  accentColor: '#10b981',
  borderColor: '#2a3140',
  fontSize: 12,
  headerFontSize: 12,
  rowHeight: 28,
  headerHeight: 30,
});

interface Props {
  tab: string;
  filterId: string | null;
  search: string;
  refreshKey: number;
  onSelectUrl: (url: string) => void;
}

export default function ResultsGrid(props: Props): React.JSX.Element {
  const tabDef = tabById(props.tab);

  const columnDefs = useMemo<ColDef[]>(
    () =>
      (tabDef?.columns ?? []).map((c) => ({
        field: c.key,
        headerName: c.label,
        width: c.width ?? 150,
        sortable: true,
        resizable: true,
        type: c.numeric ? 'rightAligned' : undefined,
      })),
    [tabDef]
  );

  const datasource = useMemo<IDatasource>(() => {
    const { tab, filterId, search } = props;
    return {
      getRows: (params: IGetRowsParams) => {
        const sort = params.sortModel[0];
        window.pulse
          .queryRowsLive({
            tab,
            filterId,
            search: search || null,
            sortCol: sort?.colId ?? null,
            sortDir: (sort?.sort as 'asc' | 'desc') ?? null,
            offset: params.startRow,
            limit: params.endRow - params.startRow,
          })
          .then((res) => {
            params.successCallback(res.rows, res.total);
          })
          .catch(() => params.failCallback());
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.tab, props.filterId, props.search, props.refreshKey]);

  return (
    <div className="h-full w-full">
      <AgGridReact
        key={`${props.tab}|${props.filterId}|${props.search}|${props.refreshKey}`}
        theme={pulseTheme}
        columnDefs={columnDefs}
        rowModelType="infinite"
        datasource={datasource}
        cacheBlockSize={200}
        maxBlocksInCache={20}
        infiniteInitialRowCount={1}
        rowSelection={{ mode: 'singleRow', checkboxes: false, enableClickSelection: true }}
        onRowClicked={(e) => {
          const url = (e.data?.url ?? e.data?.src) as string | undefined;
          if (url) props.onSelectUrl(url);
        }}
        suppressCellFocus
      />
    </div>
  );
}
