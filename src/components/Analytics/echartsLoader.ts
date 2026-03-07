import { use } from 'echarts/core'
import { BarChart, LineChart, PieChart, ScatterChart, HeatmapChart, BoxplotChart } from 'echarts/charts'
import {
  GridComponent,
  TooltipComponent,
  ToolboxComponent,
  DataZoomComponent,
  LegendComponent,
  VisualMapComponent,
  TitleComponent,
} from 'echarts/components'
import { CanvasRenderer, SVGRenderer } from 'echarts/renderers'
import type { ComposeOption, ECharts, SetOptionOpts } from 'echarts/core'
import type {
  BarSeriesOption,
  LineSeriesOption,
  PieSeriesOption,
  ScatterSeriesOption,
  HeatmapSeriesOption,
  BoxplotSeriesOption,
} from 'echarts/charts'
import type {
  GridComponentOption,
  TooltipComponentOption,
  ToolboxComponentOption,
  DataZoomComponentOption,
  LegendComponentOption,
  VisualMapComponentOption,
  TitleComponentOption,
} from 'echarts/components'

use([
  BarChart,
  LineChart,
  PieChart,
  ScatterChart,
  HeatmapChart,
  BoxplotChart,
  GridComponent,
  TooltipComponent,
  ToolboxComponent,
  DataZoomComponent,
  LegendComponent,
  VisualMapComponent,
  TitleComponent,
  CanvasRenderer,
  SVGRenderer,
])

export type AnalyticsChartOption = ComposeOption<
  | BarSeriesOption
  | LineSeriesOption
  | PieSeriesOption
  | ScatterSeriesOption
  | HeatmapSeriesOption
  | BoxplotSeriesOption
  | GridComponentOption
  | TooltipComponentOption
  | ToolboxComponentOption
  | DataZoomComponentOption
  | LegendComponentOption
  | VisualMapComponentOption
  | TitleComponentOption
>

export type AnalyticsChartInstance = ECharts
export type AnalyticsSetOptionOpts = SetOptionOpts

export async function loadEcharts() {
  const echarts = await import('echarts/core')
  return echarts
}
