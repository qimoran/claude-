import { useEffect, useMemo, useRef, useState } from 'react'
import { BarChart3, LineChart, AreaChart, PieChart, RefreshCw } from 'lucide-react'
import * as echarts from 'echarts'
import { read as readXlsx, utils as xlsxUtils } from 'xlsx'
import { jsPDF } from 'jspdf'
import {
  AggregateSeriesResult,
  AggregateSeriesOptions,
  BoxplotResult,
  CleaningOptions,
  FormulaConfig,
  HeatmapResult,
  MissingFillMode,
  OutlierMode,
  TimeGranularity,
  applyCleaning,
  applyFormulaColumns,
  aggregateSeries,
  buildBoxplotData,
  buildHeatmapData,
  buildScatterData,
  paginateRows,
  sampleRows,
} from '../../utils/analysisAdvanced'
import {
  calculateBasicStats,
  detectNumericColumns,
  parseDataInput,
} from '../../utils/dataAnalysis'

type ChartType = 'bar' | 'line' | 'area' | 'combo' | 'pie' | 'stackedBar' | 'groupedBar' | 'dualAxis' | 'scatter' | 'bubble' | 'heatmap' | 'boxplot'
type AggregateMode = 'sum' | 'avg' | 'max' | 'min'
type SortMode = 'none' | 'desc' | 'asc'
type ThemePreset = 'default' | 'emerald' | 'sunset'

interface DataAnalysisPanelProps {
  isActive: boolean
}

const SAMPLE_DATA = `月份,营收,订单数
1月,12800,42
2月,15600,58
3月,14900,51
4月,18200,67
5月,20500,73
6月,23100,82`

const THEME_PRESETS: Record<ThemePreset, { primary: string; secondary: string; shadow: string }> = {
  default: { primary: '#569cd6', secondary: '#c586c0', shadow: 'rgba(86, 156, 214, 0.25)' },
  emerald: { primary: '#34d399', secondary: '#22d3ee', shadow: 'rgba(52, 211, 153, 0.25)' },
  sunset: { primary: '#fb7185', secondary: '#f59e0b', shadow: 'rgba(245, 158, 11, 0.24)' },
}

function getThemeColor(variableName: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(variableName).trim()
  return value ? `rgb(${value})` : fallback
}

function formatValue(value: number): string {
  return new Intl.NumberFormat('zh-CN', {
    maximumFractionDigits: 2,
  }).format(value)
}

function calculateMovingAverage(values: number[], windowSize: number): number[] {
  if (values.length === 0) {
    return []
  }

  const safeWindow = Math.max(2, windowSize)
  return values.map((_, index) => {
    const start = Math.max(0, index - safeWindow + 1)
    const range = values.slice(start, index + 1)
    const total = range.reduce((acc, value) => acc + value, 0)
    return Number((total / range.length).toFixed(4))
  })
}

function calculateStdDev(values: number[]): number {
  if (values.length < 2) {
    return 0
  }
  const mean = values.reduce((acc, value) => acc + value, 0) / values.length
  const variance = values.reduce((acc, value) => acc + (value - mean) ** 2, 0) / values.length
  return Math.sqrt(variance)
}

interface AnalysisTemplate {
  name: string
  chartType: ChartType
  categoryColumn: string
  metricColumn: string
  secondaryMetricColumn: string
  aggregateMode: AggregateMode
  sortMode: SortMode
  timeColumn: string
  granularity: TimeGranularity
  renameRuleText: string
  missingFillMode: MissingFillMode
  outlierMode: OutlierMode
  outlierMetricColumn: string
  unitFactor: number
  topN: number
  cumulative: boolean
  percentage: boolean
  formulas: FormulaConfig[]
}

const TEMPLATE_STORAGE_KEY = 'analytics-template-v5'

function parseRenameMap(input: string): Record<string, string> {
  if (!input.trim()) {
    return {}
  }
  const map: Record<string, string> = {}
  input.split(',').forEach((pair) => {
    const [from, to] = pair.split(':').map((item) => item.trim())
    if (from && to) {
      map[from] = to
    }
  })
  return map
}

function parseDrillColumns(input: string): string[] {
  return input.split(',').map((item) => item.trim()).filter(Boolean)
}

function exportText(content: string, fileName: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 800)
}

export default function DataAnalysisPanel({ isActive }: DataAnalysisPanelProps) {
  const [rawInput, setRawInput] = useState(SAMPLE_DATA)
  const [urlInput, setUrlInput] = useState('')
  const [statusText, setStatusText] = useState<string | null>(null)
  const [chartType, setChartType] = useState<ChartType>('bar')
  const [themePreset, setThemePreset] = useState<ThemePreset>('default')
  const [categoryColumn, setCategoryColumn] = useState('')
  const [metricColumn, setMetricColumn] = useState('')
  const [secondaryMetricColumn, setSecondaryMetricColumn] = useState('')
  const [timeColumn, setTimeColumn] = useState('')
  const [granularity, setGranularity] = useState<TimeGranularity>('none')
  const [aggregateMode, setAggregateMode] = useState<AggregateMode>('sum')
  const [sortMode, setSortMode] = useState<SortMode>('none')
  const [topN, setTopN] = useState(20)
  const [cumulative, setCumulative] = useState(false)
  const [percentage, setPercentage] = useState(false)
  const [showTrendLine, setShowTrendLine] = useState(true)
  const [showMovingAverage, setShowMovingAverage] = useState(false)
  const [showLabels, setShowLabels] = useState(true)
  const [smoothLine, setSmoothLine] = useState(true)
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [drillColumnsText, setDrillColumnsText] = useState('区域,品类')
  const [drillPath, setDrillPath] = useState<string[]>([])
  const [missingFillMode, setMissingFillMode] = useState<MissingFillMode>('none')
  const [outlierMode, setOutlierMode] = useState<OutlierMode>('none')
  const [outlierMetricColumn, setOutlierMetricColumn] = useState('')
  const [unitFactor, setUnitFactor] = useState(1)
  const [renameRuleText, setRenameRuleText] = useState('')
  const [formulaName, setFormulaName] = useState('利润率')
  const [formulaExpression, setFormulaExpression] = useState('([营收]-[成本])/[营收]*100')
  const [formulas, setFormulas] = useState<FormulaConfig[]>([])
  const [enableSampling, setEnableSampling] = useState(true)
  const [sampleLimit, setSampleLimit] = useState(1000)
  const [tablePage, setTablePage] = useState(1)
  const [pageSize, setPageSize] = useState(12)
  const [engine, setEngine] = useState<'main' | 'worker'>('main')
  const [templateName, setTemplateName] = useState('默认模板')
  const [templates, setTemplates] = useState<AnalysisTemplate[]>([])
  const [maxPoints, setMaxPoints] = useState(20)
  const [chartError, setChartError] = useState<string | null>(null)
  const [chartReady, setChartReady] = useState(false)
  const [series, setSeries] = useState<AggregateSeriesResult>({
    categories: [],
    primaryValues: [],
    secondaryValues: [],
    trendLine: [],
    mom: [],
    yoy: [],
    filteredRows: [],
  })

  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const chartContainerRef = useRef<HTMLDivElement | null>(null)
  const linkedChartContainerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<echarts.ECharts | null>(null)
  const linkedChartRef = useRef<echarts.ECharts | null>(null)
  const optionRef = useRef<echarts.EChartsOption>({})
  const workerRef = useRef<Worker | null>(null)
  const requestIdRef = useRef(0)
  const chartClickHandlerRef = useRef<(params: unknown) => void>()

  const parsed = useMemo(() => {
    try {
      const dataset = parseDataInput(rawInput)
      return { dataset, error: null as string | null }
    } catch (error) {
      const message = error instanceof Error ? error.message : '数据解析失败'
      return { dataset: null, error: message }
    }
  }, [rawInput])

  const sourceRows = useMemo(() => parsed.dataset?.rows || [], [parsed.dataset])
  const sourceColumns = useMemo(() => parsed.dataset?.columns || [], [parsed.dataset])
  const sourceNumericColumns = useMemo(() => detectNumericColumns(sourceRows, sourceColumns), [sourceRows, sourceColumns])

  const cleanedRows = useMemo(() => {
    const rows = enableSampling ? sampleRows(sourceRows, sampleLimit) : sourceRows
    const options: CleaningOptions = {
      missingFillMode,
      outlierMode,
      outlierMetricColumn,
      unitFactor,
      renameMap: parseRenameMap(renameRuleText),
    }
    return applyCleaning(rows, sourceNumericColumns, options)
  }, [
    enableSampling,
    sourceRows,
    sampleLimit,
    missingFillMode,
    outlierMode,
    outlierMetricColumn,
    unitFactor,
    renameRuleText,
    sourceNumericColumns,
  ])

  const analysisRows = useMemo(() => applyFormulaColumns(cleanedRows, formulas), [cleanedRows, formulas])
  const allColumns = useMemo(() => Array.from(new Set(analysisRows.flatMap((row) => Object.keys(row)))), [analysisRows])
  const numericColumns = useMemo(() => detectNumericColumns(analysisRows, allColumns), [analysisRows, allColumns])
  const categoryColumns = useMemo(() => {
    const preferred = allColumns.filter((column) => !numericColumns.includes(column))
    return preferred.length > 0 ? preferred : allColumns
  }, [allColumns, numericColumns])
  const drillColumns = useMemo(() => parseDrillColumns(drillColumnsText), [drillColumnsText])

  useEffect(() => {
    setMetricColumn((current) => {
      if (numericColumns.length === 0) {
        return ''
      }
      return numericColumns.includes(current) ? current : numericColumns[0]
    })
  }, [numericColumns])

  useEffect(() => {
    setSecondaryMetricColumn((current) => {
      if (numericColumns.length < 2) {
        return ''
      }
      return numericColumns.includes(current) ? current : numericColumns[1]
    })
  }, [numericColumns])

  useEffect(() => {
    setCategoryColumn((current) => {
      if (categoryColumns.length === 0) {
        return ''
      }
      return categoryColumns.includes(current) ? current : categoryColumns[0]
    })
  }, [categoryColumns])

  useEffect(() => {
    setOutlierMetricColumn((current) => {
      if (numericColumns.length === 0) {
        return ''
      }
      return numericColumns.includes(current) ? current : numericColumns[0]
    })
  }, [numericColumns])

  useEffect(() => {
    setTimeColumn((current) => {
      if (!current) {
        return ''
      }
      return allColumns.includes(current) ? current : ''
    })
  }, [allColumns])

  useEffect(() => {
    setTablePage(1)
  }, [analysisRows.length, pageSize])

  useEffect(() => {
    try {
      const raw = localStorage.getItem(TEMPLATE_STORAGE_KEY)
      if (!raw) {
        return
      }
      const parsedTemplates = JSON.parse(raw) as AnalysisTemplate[]
      setTemplates(Array.isArray(parsedTemplates) ? parsedTemplates : [])
    } catch {
      // ignore local template parse failure
    }
  }, [])

  const aggregateOptions = useMemo<AggregateSeriesOptions>(() => ({
    categoryColumn,
    metricColumn,
    secondaryMetricColumn,
    aggregateMode,
    sortMode,
    maxPoints,
    topN,
    cumulative,
    percentage,
    timeColumn,
    granularity,
    drilldownColumns: drillColumns,
    drilldownPath: drillPath,
    selectedCategory: null,
  }), [
    categoryColumn,
    metricColumn,
    secondaryMetricColumn,
    aggregateMode,
    sortMode,
    maxPoints,
    topN,
    cumulative,
    percentage,
    timeColumn,
    granularity,
    drillColumns,
    drillPath,
  ])

  useEffect(() => {
    if (!categoryColumn || !metricColumn) {
      return
    }

    const shouldUseWorker = analysisRows.length > 900
    if (shouldUseWorker) {
      if (!workerRef.current) {
        const worker = new Worker(new URL('../../workers/analysisWorker.ts', import.meta.url), { type: 'module' })
        worker.onmessage = (event: MessageEvent<{ success: boolean; result?: AggregateSeriesResult; error?: string; requestId?: number }>) => {
          if ((event.data.requestId || 0) !== requestIdRef.current) {
            return
          }
          if (!event.data.success || !event.data.result) {
            setChartError(event.data.error || 'Worker 聚合失败')
            return
          }
          setSeries(event.data.result)
          setChartError(null)
        }
        workerRef.current = worker
      }

      const requestId = requestIdRef.current + 1
      requestIdRef.current = requestId
      setEngine('worker')
      workerRef.current.postMessage({ rows: analysisRows, options: aggregateOptions, requestId })
      return
    }

    setEngine('main')
    setSeries(aggregateSeries(analysisRows, aggregateOptions))
  }, [analysisRows, aggregateOptions, categoryColumn, metricColumn])

  useEffect(() => {
    return () => {
      workerRef.current?.terminate()
      workerRef.current = null
    }
  }, [])

  const scatterData = useMemo(() => buildScatterData(
    series.filteredRows,
    metricColumn,
    secondaryMetricColumn || metricColumn,
    numericColumns[2] || '',
    categoryColumn,
    maxPoints,
  ), [series.filteredRows, metricColumn, secondaryMetricColumn, numericColumns, categoryColumn, maxPoints])

  const heatmapData = useMemo(() => {
    if (!series.filteredRows.length || categoryColumns.length < 2 || !metricColumn) {
      return { xAxis: [], yAxis: [], data: [] } as HeatmapResult
    }
    return buildHeatmapData(series.filteredRows, categoryColumn, categoryColumns[1], metricColumn, aggregateMode)
  }, [series.filteredRows, categoryColumns, categoryColumn, metricColumn, aggregateMode])

  const boxplotData = useMemo(() => {
    if (!series.filteredRows.length || !categoryColumn || !metricColumn) {
      return { categories: [], data: [] } as BoxplotResult
    }
    return buildBoxplotData(series.filteredRows, categoryColumn, metricColumn, maxPoints)
  }, [series.filteredRows, categoryColumn, metricColumn, maxPoints])

  const stats = useMemo(() => {
    return calculateBasicStats(series.primaryValues)
  }, [series.primaryValues])

  const insight = useMemo(() => {
    if (series.categories.length === 0 || series.primaryValues.length === 0) {
      return {
        peakCategory: '-',
        trend: '-',
        volatility: '-',
      }
    }

    let peakIndex = 0
    series.primaryValues.forEach((value, index) => {
      if (value > series.primaryValues[peakIndex]) {
        peakIndex = index
      }
    })

    const first = series.primaryValues[0]
    const last = series.primaryValues[series.primaryValues.length - 1]
    const trend = first !== 0 ? ((last - first) / Math.abs(first)) * 100 : 0

    return {
      peakCategory: series.categories[peakIndex],
      trend: `${trend >= 0 ? '+' : ''}${trend.toFixed(1)}%`,
      volatility: formatValue(calculateStdDev(series.primaryValues)),
    }
  }, [series.categories, series.primaryValues])

  const tableData = useMemo(() => paginateRows(series.filteredRows, tablePage, pageSize), [series.filteredRows, tablePage, pageSize])

  const linkedRows = useMemo(() => {
    if (!selectedCategory) {
      return series.filteredRows
    }
    const currentColumn = drillColumns[drillPath.length] || categoryColumn
    return series.filteredRows.filter((row) => String(row[currentColumn] || '').trim() === selectedCategory)
  }, [selectedCategory, series.filteredRows, drillColumns, drillPath.length, categoryColumn])

  chartClickHandlerRef.current = (params: unknown) => {
    const data = params as { name?: string }
    if (!data.name) {
      return
    }
    setSelectedCategory(data.name)
    if (drillColumns.length > drillPath.length) {
      setDrillPath((prev) => [...prev, data.name || ''])
    }
  }

  useEffect(() => {
    let disposed = false

    const initChart = async () => {
      if (!chartContainerRef.current || !linkedChartContainerRef.current) {
        return
      }

      try {
        if (disposed || !chartContainerRef.current || !linkedChartContainerRef.current) {
          return
        }

        chartRef.current?.dispose()
        linkedChartRef.current?.dispose()
        chartRef.current = echarts.init(chartContainerRef.current)
        linkedChartRef.current = echarts.init(linkedChartContainerRef.current)
        setChartReady(true)
        setChartError(null)
      } catch (error) {
        if (disposed) {
          return
        }
        const message = error instanceof Error ? error.message : '图表引擎加载失败'
        setChartError(message)
      }
    }

    initChart()

    return () => {
      disposed = true
      chartRef.current?.dispose()
      linkedChartRef.current?.dispose()
      chartRef.current = null
      linkedChartRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!chartReady || !chartRef.current) {
      return
    }

    const chart = chartRef.current
    const cssPrimaryColor = getThemeColor('--c-primary', '#569cd6')
    const textColor = getThemeColor('--c-text', '#d4d4d4')
    const mutedTextColor = getThemeColor('--c-text-muted', '#858585')
    const borderColor = getThemeColor('--c-border', '#3e3e42')
    const surfaceColor = getThemeColor('--c-surface-light', '#2d2d2d')
    const preset = THEME_PRESETS[themePreset]
    const primaryColor = themePreset === 'default' ? cssPrimaryColor : preset.primary
    const secondaryColor = preset.secondary
    const accentColor = themePreset === 'default' ? '#22d3ee' : (themePreset === 'emerald' ? '#84cc16' : '#f97316')
    const movingAvg = calculateMovingAverage(series.primaryValues, 3)

    const baseOption: echarts.EChartsOption = {
      color: [primaryColor, secondaryColor],
      grid: { left: 50, right: 20, top: 40, bottom: 42 },
      textStyle: {
        color: textColor,
      },
      tooltip: {
        trigger: 'axis',
        backgroundColor: surfaceColor,
        borderColor,
        textStyle: {
          color: textColor,
        },
      },
      toolbox: {
        right: 8,
        top: 2,
        iconStyle: { borderColor: mutedTextColor },
        feature: {
          dataZoom: { yAxisIndex: 'none' },
          restore: {},
          saveAsImage: { title: '导出图片' },
        },
      },
      dataZoom: series.categories.length > 8
        ? [
          { type: 'inside' },
          { type: 'slider', height: 16, bottom: 8 },
        ]
        : [],
      xAxis: {
        type: 'category',
        data: series.categories,
        axisLabel: {
          color: mutedTextColor,
          rotate: series.categories.length > 10 ? 24 : 0,
        },
        axisLine: { lineStyle: { color: borderColor } },
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: mutedTextColor },
        splitLine: { lineStyle: { color: borderColor, opacity: 0.35 } },
      },
      animationDuration: 450,
    }

    if (chartType === 'pie') {
      optionRef.current = {
        ...baseOption,
        grid: undefined,
        xAxis: undefined,
        yAxis: undefined,
        dataZoom: [],
        tooltip: { trigger: 'item' },
        legend: {
          bottom: 0,
          textStyle: { color: mutedTextColor },
        },
        series: [
          {
            type: 'pie',
            radius: ['34%', '68%'],
            center: ['50%', '45%'],
            itemStyle: {
              borderColor: getThemeColor('--c-bg', '#1e1e1e'),
              borderWidth: 2,
              shadowBlur: 20,
              shadowColor: preset.shadow,
            },
            label: {
              color: textColor,
              formatter: '{b}: {d}%',
            },
            data: series.categories.map((name, index) => ({
              name,
              value: series.primaryValues[index],
            })),
          },
        ],
      }
      chart.setOption(optionRef.current)
            return
    }

    if (chartType === 'heatmap') {
      optionRef.current = {
        ...baseOption,
        xAxis: {
          type: 'category',
          data: heatmapData.xAxis,
          axisLabel: { color: mutedTextColor },
          axisLine: { lineStyle: { color: borderColor } },
        },
        yAxis: {
          type: 'category',
          data: heatmapData.yAxis,
          axisLabel: { color: mutedTextColor },
          axisLine: { lineStyle: { color: borderColor } },
        },
        visualMap: {
          min: 0,
          max: Math.max(...heatmapData.data.map((item) => item[2]), 1),
          orient: 'horizontal',
          left: 'center',
          bottom: 0,
          calculable: true,
        },
        series: [{ type: 'heatmap', data: heatmapData.data }],
      }
      chart.setOption(optionRef.current)
            return
    }

    if (chartType === 'boxplot') {
      optionRef.current = {
        ...baseOption,
        xAxis: {
          type: 'category',
          data: boxplotData.categories,
          axisLabel: { color: mutedTextColor },
          axisLine: { lineStyle: { color: borderColor } },
        },
        series: [{ type: 'boxplot', data: boxplotData.data }],
      }
      chart.setOption(optionRef.current)
            return
    }

    if (chartType === 'scatter' || chartType === 'bubble') {
      optionRef.current = {
        ...baseOption,
        xAxis: {
          type: 'value',
          axisLabel: { color: mutedTextColor },
          axisLine: { lineStyle: { color: borderColor } },
        },
        series: [{
          type: 'scatter',
          data: scatterData.map((item) => item.value),
          symbolSize: chartType === 'bubble'
            ? (params: number[] | number) => {
              if (typeof params === 'number') {
                return params
              }
              return Math.max(8, Math.min(44, Number(params[2] || 10)))
            }
            : 12,
          label: showLabels
            ? {
              show: true,
              formatter: (params: unknown) => {
                const p = params as { dataIndex?: number }
                const index = p.dataIndex ?? -1
                return scatterData[index]?.label || ''
              },
            }
            : undefined,
        }],
      }
      chart.setOption(optionRef.current)
            return
    }

    const isLineLike = chartType === 'line' || chartType === 'area'
    const hasSecondarySeries = chartType === 'combo' && (
      secondaryMetricColumn || series.secondaryValues.some((value) => value !== 0)
    )
    const seriesList: unknown[] = [
      {
        name: metricColumn || '主指标',
        type: chartType === 'line' || chartType === 'area' ? 'line' : 'bar',
        data: series.primaryValues,
        smooth: isLineLike ? smoothLine : false,
        showSymbol: false,
        stack: chartType === 'stackedBar' ? 'stack' : undefined,
        barMaxWidth: 36,
        label: showLabels
          ? {
            show: true,
            position: 'top',
            color: mutedTextColor,
            fontSize: 11,
            formatter: (params: { value: number }) => formatValue(params.value),
          }
          : undefined,
        itemStyle: {
          color: primaryColor,
          borderRadius: 6,
          shadowBlur: chartType === 'bar' || chartType === 'combo' || chartType === 'stackedBar' || chartType === 'groupedBar' ? 14 : 0,
          shadowColor: preset.shadow,
        },
        lineStyle: {
          width: 3,
          color: primaryColor,
        },
        areaStyle: chartType === 'area'
          ? {
            opacity: 0.25,
            color: primaryColor,
          }
          : undefined,
      },
      ...(secondaryMetricColumn
        ? [{
          name: secondaryMetricColumn,
          type: chartType === 'dualAxis' ? 'line' : 'bar',
          yAxisIndex: chartType === 'dualAxis' ? 1 : 0,
          stack: chartType === 'stackedBar' ? 'stack' : undefined,
          smooth: true,
          showSymbol: false,
          data: chartType === 'combo' && !hasSecondarySeries ? movingAvg : series.secondaryValues,
          lineStyle: { width: 2.5, color: secondaryColor },
          itemStyle: { color: secondaryColor },
        }]
        : []),
      ...(showTrendLine
        ? [{
          name: '趋势线',
          type: 'line',
          showSymbol: false,
          smooth: true,
          data: series.trendLine,
          lineStyle: { width: 2, type: 'dashed', color: accentColor },
        }]
        : []),
      ...(showMovingAverage
        ? [{
          name: '移动平均(3)',
          type: 'line',
          showSymbol: false,
          smooth: true,
          data: movingAvg,
          lineStyle: { width: 2, color: '#f59e0b' },
        }]
        : []),
    ]

    optionRef.current = {
      ...baseOption,
      legend: {
        top: 2,
        left: 8,
        textStyle: { color: mutedTextColor },
      },
      yAxis: chartType === 'dualAxis'
        ? [
          {
            type: 'value',
            axisLabel: { color: mutedTextColor },
            splitLine: { lineStyle: { color: borderColor, opacity: 0.35 } },
          },
          {
            type: 'value',
            axisLabel: { color: mutedTextColor },
            splitLine: { show: false },
          },
        ]
        : baseOption.yAxis,
      series: seriesList as echarts.EChartsOption['series'],
    }

    chart.setOption(optionRef.current)
    chartRef.current.off('click')
    chartRef.current.on('click', (params: unknown) => {
      const data = params as { name?: string }
      if (!data.name) {
        return
      }
      setSelectedCategory(data.name)
      if (drillColumns.length > drillPath.length) {
        setDrillPath((prev) => [...prev, data.name || ''])
      }
    })
      }, [
    chartReady,
    chartType,
    metricColumn,
    secondaryMetricColumn,
    series.categories,
    series.primaryValues,
    series.secondaryValues,
    series.trendLine,
    smoothLine,
    showLabels,
    showTrendLine,
    showMovingAverage,
    themePreset,
    scatterData,
    heatmapData,
    boxplotData,
    drillColumns.length,
    drillPath.length,
  ])

  useEffect(() => {
    if (!chartReady || !linkedChartRef.current) {
      return
    }
    const detailAgg = aggregateSeries(linkedRows, {
      categoryColumn: drillColumns[drillPath.length] || categoryColumn,
      metricColumn,
      secondaryMetricColumn: '',
      aggregateMode,
      sortMode: 'desc',
      maxPoints: 10,
      topN: 10,
      cumulative: false,
      percentage: false,
      timeColumn: '',
      granularity: 'none',
      drilldownColumns: [],
      drilldownPath: [],
      selectedCategory: null,
    })
    linkedChartRef.current.setOption({
      title: { text: selectedCategory ? `联动: ${selectedCategory}` : '联动: 全部', textStyle: { fontSize: 12 } },
      grid: { left: 40, right: 12, top: 36, bottom: 28 },
      tooltip: { trigger: 'axis' },
      xAxis: { type: 'category', data: detailAgg.categories },
      yAxis: { type: 'value' },
      series: [{ type: 'bar', data: detailAgg.primaryValues, barMaxWidth: 28 }],
    }, true)
    linkedChartRef.current.resize()
  }, [chartReady, linkedRows, selectedCategory, drillColumns, drillPath.length, categoryColumn, metricColumn, aggregateMode])

  useEffect(() => {
    const onResize = () => {
      chartRef.current?.resize()
      linkedChartRef.current?.resize()
    }

    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
    }
  }, [])

  useEffect(() => {
    if (!isActive) {
      return
    }

    const timer = window.setTimeout(() => {
      chartRef.current?.resize()
      linkedChartRef.current?.resize()
    }, 120)

    return () => window.clearTimeout(timer)
  }, [isActive])

  const handleAddFormula = () => {
    if (!formulaName.trim() || !formulaExpression.trim()) {
      return
    }
    setFormulas((prev) => [...prev, { name: formulaName.trim(), expression: formulaExpression.trim() }])
    setFormulaName('')
    setFormulaExpression('')
  }

  const handleRemoveFormula = (name: string) => {
    setFormulas((prev) => prev.filter((item) => item.name !== name))
  }

  const handleImportFile = async (file: File) => {
    try {
      if (file.name.toLowerCase().endsWith('.xlsx') || file.name.toLowerCase().endsWith('.xls')) {
        const xlsx = await ensureXlsx()
        const workbook = xlsx.read(await file.arrayBuffer(), { type: 'array' })
        const first = workbook.SheetNames[0]
        const rows = xlsx.utils.sheet_to_json(workbook.Sheets[first], { defval: '' })
        setRawInput(JSON.stringify(rows, null, 2))
      } else {
        setRawInput(await file.text())
      }
      setStatusText(`导入成功: ${file.name}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : '导入失败'
      setStatusText(`导入失败: ${message}`)
    }
  }

  const handleFetchUrl = async () => {
    if (!urlInput.trim()) {
      return
    }
    try {
      const response = await fetch(urlInput.trim())
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }
      const contentType = response.headers.get('content-type') || ''
      if (contentType.includes('application/json')) {
        const data = await response.json()
        setRawInput(JSON.stringify(data, null, 2))
      } else {
        setRawInput(await response.text())
      }
      setStatusText('URL 数据导入成功')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'URL 导入失败'
      setStatusText(`URL 导入失败: ${message}`)
    }
  }

  const handleExportPng = () => {
    if (!chartRef.current) {
      return
    }
    const url = chartRef.current.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#fff' })
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'analytics.png'
    anchor.click()
  }

  const handleExportSvg = () => {
    if (!chartContainerRef.current) {
      return
    }
    const temp = document.createElement('div')
    temp.style.width = `${chartContainerRef.current.clientWidth}px`
    temp.style.height = `${chartContainerRef.current.clientHeight}px`
    temp.style.position = 'fixed'
    temp.style.left = '-9999px'
    document.body.appendChild(temp)
    const svgChart = echarts.init(temp, undefined, { renderer: 'svg' })
    svgChart.setOption(optionRef.current, true)
    const url = svgChart.getDataURL({ type: 'svg' })
    svgChart.dispose()
    document.body.removeChild(temp)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'analytics.svg'
    anchor.click()
  }

  const handleExportPdf = async () => {
    if (!chartRef.current || !chartContainerRef.current) {
      return
    }
    const jsPDF = await ensureJsPdf()
    const width = chartContainerRef.current.clientWidth
    const height = chartContainerRef.current.clientHeight
    const image = chartRef.current.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#fff' })
    const doc = new jsPDF('l', 'pt', [width, height])
    doc.addImage(image, 'PNG', 0, 0, width, height)
    doc.save('analytics.pdf')
  }

  const handleExportCsv = () => {
    const rows = linkedRows
    if (rows.length === 0) {
      return
    }
    const cols = Array.from(new Set(rows.flatMap((row) => Object.keys(row))))
    const csv = [cols.join(','), ...rows.map((row) => cols.map((col) => row[col] || '').join(','))].join('\n')
    exportText(csv, 'analytics-filtered.csv', 'text/csv;charset=utf-8')
  }

  const handleSaveTemplate = () => {
    if (!templateName.trim()) {
      return
    }
    const item: AnalysisTemplate = {
      name: templateName.trim(),
      chartType,
      categoryColumn,
      metricColumn,
      secondaryMetricColumn,
      aggregateMode,
      sortMode,
      timeColumn,
      granularity,
      renameRuleText,
      missingFillMode,
      outlierMode,
      outlierMetricColumn,
      unitFactor,
      topN,
      cumulative,
      percentage,
      formulas,
    }
    const next = [...templates.filter((template) => template.name !== item.name), item]
    setTemplates(next)
    localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(next))
  }

  const handleApplyTemplate = (name: string) => {
    const item = templates.find((template) => template.name === name)
    if (!item) {
      return
    }
    setChartType(item.chartType)
    setCategoryColumn(item.categoryColumn)
    setMetricColumn(item.metricColumn)
    setSecondaryMetricColumn(item.secondaryMetricColumn)
    setAggregateMode(item.aggregateMode)
    setSortMode(item.sortMode)
    setTimeColumn(item.timeColumn)
    setGranularity(item.granularity)
    setRenameRuleText(item.renameRuleText)
    setMissingFillMode(item.missingFillMode)
    setOutlierMode(item.outlierMode)
    setOutlierMetricColumn(item.outlierMetricColumn)
    setUnitFactor(item.unitFactor)
    setTopN(item.topN)
    setCumulative(item.cumulative)
    setPercentage(item.percentage)
    setFormulas(item.formulas)
  }

  const handleDeleteTemplate = (name: string) => {
    const next = templates.filter((template) => template.name !== name)
    setTemplates(next)
    localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(next))
  }

  return (
    <div className="h-full flex flex-col bg-claude-bg">
      <div className="p-6 border-b border-claude-border">
        <h1 className="text-lg font-semibold text-claude-text mb-2">数据分析</h1>
        <p className="text-sm text-claude-text-muted">
          高级看板：支持 CSV / JSON、双指标组合图、聚合与排序、缩放与导出图片
        </p>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-2 gap-4 p-4">
        <section className="min-h-0 bg-claude-surface border border-claude-border rounded-xl p-4 flex flex-col overflow-hidden">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.json,.txt,.xlsx,.xls"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) {
                void handleImportFile(file)
              }
              event.target.value = ''
            }}
          />
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-claude-text">数据源</h2>
            <div className="flex items-center gap-2">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-2.5 py-1 rounded-md text-xs bg-claude-bg border border-claude-border text-claude-text-muted hover:text-claude-text hover:border-claude-primary transition-colors"
              >
                导入文件
              </button>
              <button
                onClick={() => setRawInput(SAMPLE_DATA)}
                className="px-2.5 py-1 rounded-md text-xs bg-claude-bg border border-claude-border text-claude-text-muted hover:text-claude-text hover:border-claude-primary transition-colors inline-flex items-center gap-1"
              >
                <RefreshCw size={12} />
                填充示例
              </button>
            </div>
          </div>
          <div className="mb-2 flex items-center gap-2">
            <input
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              className="flex-1 bg-claude-bg border border-claude-border rounded-md px-2 py-1.5 text-xs text-claude-text focus:outline-none focus:border-claude-primary"
              placeholder="输入 URL 后点击拉取（CSV/JSON）"
            />
            <button
              onClick={() => void handleFetchUrl()}
              className="px-2.5 py-1.5 rounded-md text-xs bg-claude-bg border border-claude-border text-claude-text hover:border-claude-primary"
            >
              拉取
            </button>
          </div>
          <textarea
            value={rawInput}
            onChange={(e) => setRawInput(e.target.value)}
            className="flex-1 min-h-[220px] bg-claude-bg border border-claude-border rounded-lg p-3 text-sm text-claude-text font-mono focus:outline-none focus:border-claude-primary resize-none"
            placeholder="在这里粘贴 CSV 或 JSON 数组数据"
          />
          <div className="mt-3 text-xs text-claude-text-muted">
            解析格式: {parsed.dataset ? parsed.dataset.source.toUpperCase() : '无'}
            {parsed.dataset && `，共 ${parsed.dataset.rows.length} 行`}
          </div>
          {statusText && (
            <div className="mt-2 text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/25 rounded-md px-2 py-1.5 flex items-center justify-between gap-2">
              <span className="truncate">{statusText}</span>
              <button onClick={() => setStatusText(null)} className="text-emerald-200 hover:text-white">清除</button>
            </div>
          )}
          {parsed.error && (
            <div className="mt-3 text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-md p-2">
              {parsed.error}
            </div>
          )}
        </section>

        <section className="min-h-0 bg-claude-surface border border-claude-border rounded-xl p-4 flex flex-col">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 mb-3">
            <label className="text-xs text-claude-text-muted">
              图表类型
              <select
                value={chartType}
                onChange={(e) => setChartType(e.target.value as ChartType)}
                className="mt-1 w-full bg-claude-bg border border-claude-border rounded-md px-2 py-1.5 text-sm text-claude-text focus:outline-none focus:border-claude-primary"
              >
                <option value="bar">条形图</option>
                <option value="line">折线图</option>
                <option value="area">面积图</option>
                <option value="combo">组合图</option>
                <option value="pie">饼图</option>
                <option value="stackedBar">堆叠条形图</option>
                <option value="groupedBar">分组条形图</option>
                <option value="dualAxis">双轴图</option>
                <option value="scatter">散点图</option>
                <option value="bubble">气泡图</option>
                <option value="heatmap">热力图</option>
                <option value="boxplot">箱线图</option>
              </select>
            </label>
            <label className="text-xs text-claude-text-muted">
              分类字段
              <select
                value={categoryColumn}
                onChange={(e) => setCategoryColumn(e.target.value)}
                className="mt-1 w-full bg-claude-bg border border-claude-border rounded-md px-2 py-1.5 text-sm text-claude-text focus:outline-none focus:border-claude-primary"
              >
                {categoryColumns.map((column) => (
                  <option key={column} value={column}>{column}</option>
                ))}
              </select>
            </label>
            <label className="text-xs text-claude-text-muted">
              指标字段
              <select
                value={metricColumn}
                onChange={(e) => setMetricColumn(e.target.value)}
                className="mt-1 w-full bg-claude-bg border border-claude-border rounded-md px-2 py-1.5 text-sm text-claude-text focus:outline-none focus:border-claude-primary"
              >
                {numericColumns.map((column) => (
                  <option key={column} value={column}>{column}</option>
                ))}
              </select>
            </label>
            <label className="text-xs text-claude-text-muted">
              对比指标（组合图）
              <select
                value={secondaryMetricColumn}
                onChange={(e) => setSecondaryMetricColumn(e.target.value)}
                className="mt-1 w-full bg-claude-bg border border-claude-border rounded-md px-2 py-1.5 text-sm text-claude-text focus:outline-none focus:border-claude-primary"
              >
                <option value="">无（使用移动均线）</option>
                {numericColumns
                  .filter((column) => column !== metricColumn)
                  .map((column) => (
                    <option key={column} value={column}>{column}</option>
                  ))}
              </select>
            </label>
            <label className="text-xs text-claude-text-muted">
              时间字段
              <select
                value={timeColumn}
                onChange={(e) => setTimeColumn(e.target.value)}
                className="mt-1 w-full bg-claude-bg border border-claude-border rounded-md px-2 py-1.5 text-sm text-claude-text focus:outline-none focus:border-claude-primary"
              >
                <option value="">无</option>
                {allColumns.map((column) => (
                  <option key={column} value={column}>{column}</option>
                ))}
              </select>
            </label>
            <label className="text-xs text-claude-text-muted">
              时间粒度
              <select
                value={granularity}
                onChange={(e) => setGranularity(e.target.value as TimeGranularity)}
                className="mt-1 w-full bg-claude-bg border border-claude-border rounded-md px-2 py-1.5 text-sm text-claude-text focus:outline-none focus:border-claude-primary"
              >
                <option value="none">无</option>
                <option value="day">按天</option>
                <option value="week">按周</option>
                <option value="month">按月</option>
              </select>
            </label>
            <label className="text-xs text-claude-text-muted">
              钻取字段链
              <input
                value={drillColumnsText}
                onChange={(e) => setDrillColumnsText(e.target.value)}
                className="mt-1 w-full bg-claude-bg border border-claude-border rounded-md px-2 py-1.5 text-sm text-claude-text focus:outline-none focus:border-claude-primary"
                placeholder="如：区域,品类"
              />
            </label>
            <label className="text-xs text-claude-text-muted">
              异常值指标
              <select
                value={outlierMetricColumn}
                onChange={(e) => setOutlierMetricColumn(e.target.value)}
                className="mt-1 w-full bg-claude-bg border border-claude-border rounded-md px-2 py-1.5 text-sm text-claude-text focus:outline-none focus:border-claude-primary"
              >
                {numericColumns.map((column) => (
                  <option key={column} value={column}>{column}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="mb-3 flex flex-wrap items-center gap-2">
            <button
              onClick={() => setChartType('bar')}
              className={`px-2.5 py-1.5 rounded-md text-xs border inline-flex items-center gap-1 transition-colors ${chartType === 'bar' ? 'text-claude-primary border-claude-primary bg-claude-bg' : 'text-claude-text-muted border-claude-border hover:text-claude-text'}`}
            >
              <BarChart3 size={13} />
              条形图
            </button>
            <button
              onClick={() => setChartType('line')}
              className={`px-2.5 py-1.5 rounded-md text-xs border inline-flex items-center gap-1 transition-colors ${chartType === 'line' ? 'text-claude-primary border-claude-primary bg-claude-bg' : 'text-claude-text-muted border-claude-border hover:text-claude-text'}`}
            >
              <LineChart size={13} />
              折线图
            </button>
            <button
              onClick={() => setChartType('area')}
              className={`px-2.5 py-1.5 rounded-md text-xs border inline-flex items-center gap-1 transition-colors ${chartType === 'area' ? 'text-claude-primary border-claude-primary bg-claude-bg' : 'text-claude-text-muted border-claude-border hover:text-claude-text'}`}
            >
              <AreaChart size={13} />
              面积图
            </button>
            <button
              onClick={() => setChartType('combo')}
              className={`px-2.5 py-1.5 rounded-md text-xs border inline-flex items-center gap-1 transition-colors ${chartType === 'combo' ? 'text-claude-primary border-claude-primary bg-claude-bg' : 'text-claude-text-muted border-claude-border hover:text-claude-text'}`}
            >
              <BarChart3 size={13} />
              组合图
            </button>
            <button
              onClick={() => setChartType('pie')}
              className={`px-2.5 py-1.5 rounded-md text-xs border inline-flex items-center gap-1 transition-colors ${chartType === 'pie' ? 'text-claude-primary border-claude-primary bg-claude-bg' : 'text-claude-text-muted border-claude-border hover:text-claude-text'}`}
            >
              <PieChart size={13} />
              饼图
            </button>
            <label className="text-xs text-claude-text-muted ml-auto inline-flex items-center gap-2">
              最多显示
              <input
                type="number"
                min={1}
                max={200}
                value={maxPoints}
                onChange={(e) => setMaxPoints(Math.max(1, Number(e.target.value) || 1))}
                className="w-20 bg-claude-bg border border-claude-border rounded-md px-2 py-1 text-sm text-claude-text focus:outline-none focus:border-claude-primary"
              />
              项
            </label>
            <label className="text-xs text-claude-text-muted inline-flex items-center gap-2">
              Top N
              <input
                type="number"
                min={1}
                max={200}
                value={topN}
                onChange={(e) => setTopN(Math.max(1, Number(e.target.value) || 1))}
                className="w-20 bg-claude-bg border border-claude-border rounded-md px-2 py-1 text-sm text-claude-text focus:outline-none focus:border-claude-primary"
              />
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 mb-3">
            <label className="text-xs text-claude-text-muted">
              聚合方式
              <select
                value={aggregateMode}
                onChange={(e) => setAggregateMode(e.target.value as AggregateMode)}
                className="mt-1 w-full bg-claude-bg border border-claude-border rounded-md px-2 py-1.5 text-sm text-claude-text focus:outline-none focus:border-claude-primary"
              >
                <option value="sum">求和</option>
                <option value="avg">平均</option>
                <option value="max">最大值</option>
                <option value="min">最小值</option>
              </select>
            </label>
            <label className="text-xs text-claude-text-muted">
              排序
              <select
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value as SortMode)}
                className="mt-1 w-full bg-claude-bg border border-claude-border rounded-md px-2 py-1.5 text-sm text-claude-text focus:outline-none focus:border-claude-primary"
              >
                <option value="none">保持原始顺序</option>
                <option value="desc">按值降序</option>
                <option value="asc">按值升序</option>
              </select>
            </label>
            <label className="text-xs text-claude-text-muted">
              缺失值填充
              <select
                value={missingFillMode}
                onChange={(e) => setMissingFillMode(e.target.value as MissingFillMode)}
                className="mt-1 w-full bg-claude-bg border border-claude-border rounded-md px-2 py-1.5 text-sm text-claude-text focus:outline-none focus:border-claude-primary"
              >
                <option value="none">不处理</option>
                <option value="zero">填 0</option>
                <option value="mean">均值填充</option>
                <option value="forward">前向填充</option>
              </select>
            </label>
            <label className="text-xs text-claude-text-muted">
              异常值处理
              <select
                value={outlierMode}
                onChange={(e) => setOutlierMode(e.target.value as OutlierMode)}
                className="mt-1 w-full bg-claude-bg border border-claude-border rounded-md px-2 py-1.5 text-sm text-claude-text focus:outline-none focus:border-claude-primary"
              >
                <option value="none">不处理</option>
                <option value="iqr">IQR 去极值</option>
              </select>
            </label>
            <label className="text-xs text-claude-text-muted">
              单位换算系数
              <input
                type="number"
                min={1}
                step={1}
                value={unitFactor}
                onChange={(e) => setUnitFactor(Math.max(1, Number(e.target.value) || 1))}
                className="mt-1 w-full bg-claude-bg border border-claude-border rounded-md px-2 py-1.5 text-sm text-claude-text focus:outline-none focus:border-claude-primary"
              />
            </label>
            <label className="text-xs text-claude-text-muted md:col-span-2">
              字段重命名（`旧:新,旧:新`）
              <input
                value={renameRuleText}
                onChange={(e) => setRenameRuleText(e.target.value)}
                className="mt-1 w-full bg-claude-bg border border-claude-border rounded-md px-2 py-1.5 text-sm text-claude-text focus:outline-none focus:border-claude-primary"
              />
            </label>
            <label className="text-xs text-claude-text-muted">
              主题风格
              <select
                value={themePreset}
                onChange={(e) => setThemePreset(e.target.value as ThemePreset)}
                className="mt-1 w-full bg-claude-bg border border-claude-border rounded-md px-2 py-1.5 text-sm text-claude-text focus:outline-none focus:border-claude-primary"
              >
                <option value="default">深海蓝</option>
                <option value="emerald">青绿商务</option>
                <option value="sunset">日落暖色</option>
              </select>
            </label>
            <div className="text-xs text-claude-text-muted flex flex-wrap items-end gap-4 pb-1 md:col-span-2 xl:col-span-4">
              <label className="inline-flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={showLabels}
                  onChange={(e) => setShowLabels(e.target.checked)}
                />
                显示标签
              </label>
              <label className="inline-flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={smoothLine}
                  onChange={(e) => setSmoothLine(e.target.checked)}
                />
                平滑线条
              </label>
              <label className="inline-flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={showTrendLine}
                  onChange={(e) => setShowTrendLine(e.target.checked)}
                />
                趋势线
              </label>
              <label className="inline-flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={showMovingAverage}
                  onChange={(e) => setShowMovingAverage(e.target.checked)}
                />
                移动平均
              </label>
              <label className="inline-flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={cumulative}
                  onChange={(e) => setCumulative(e.target.checked)}
                />
                累计
              </label>
              <label className="inline-flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={percentage}
                  onChange={(e) => setPercentage(e.target.checked)}
                />
                百分比
              </label>
              <label className="inline-flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={enableSampling}
                  onChange={(e) => setEnableSampling(e.target.checked)}
                />
                采样
              </label>
              <label className="inline-flex items-center gap-1.5">
                采样上限
                <input
                  type="number"
                  min={100}
                  step={100}
                  value={sampleLimit}
                  disabled={!enableSampling}
                  onChange={(e) => setSampleLimit(Math.max(100, Number(e.target.value) || 100))}
                  className="w-20 bg-claude-bg border border-claude-border rounded-md px-2 py-0.5 text-xs text-claude-text disabled:opacity-50"
                />
              </label>
              <button
                onClick={() => {
                  setSelectedCategory(null)
                  setDrillPath([])
                }}
                className="px-2.5 py-1 rounded-md text-xs bg-claude-bg border border-claude-border text-claude-text-muted hover:text-claude-text"
              >
                重置钻取
              </button>
            </div>
          </div>

          {chartError && (
            <div className="mb-2 text-xs text-yellow-300 bg-yellow-500/10 border border-yellow-500/25 rounded-md p-2">
              {chartError}
            </div>
          )}
          <div className="mb-2 text-xs text-claude-text-muted">
            计算引擎: <span className="text-claude-text">{engine === 'worker' ? 'Worker 并行' : '主线程'}</span>
            {selectedCategory ? ` | 已选分类: ${selectedCategory}` : ''}
            {drillPath.length > 0 ? ` | 钻取路径: ${drillPath.join(' / ')}` : ''}
          </div>

          <div className="relative flex-1 min-h-[280px] rounded-lg border border-claude-border bg-claude-bg overflow-hidden">
            <div className="absolute inset-0 opacity-50 pointer-events-none bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.06),transparent_55%)]" />
            <div ref={chartContainerRef} className="relative z-10 h-full w-full" />
          </div>

          <div className="mt-3 rounded-lg border border-claude-border bg-claude-bg p-2">
            <div className="text-xs text-claude-text-muted mb-1">联动钻取图</div>
            <div ref={linkedChartContainerRef} className="h-[170px] w-full" />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-2 mt-3">
            <div className="bg-claude-bg rounded-lg border border-claude-border px-2.5 py-2">
              <div className="text-[11px] text-claude-text-muted mb-1">数据点</div>
              <div className="text-sm text-claude-text font-semibold">{stats ? stats.count : '-'}</div>
            </div>
            <div className="bg-claude-bg rounded-lg border border-claude-border px-2.5 py-2">
              <div className="text-[11px] text-claude-text-muted mb-1">总和</div>
              <div className="text-sm text-claude-text font-semibold">{stats ? formatValue(stats.sum) : '-'}</div>
            </div>
            <div className="bg-claude-bg rounded-lg border border-claude-border px-2.5 py-2">
              <div className="text-[11px] text-claude-text-muted mb-1">均值</div>
              <div className="text-sm text-claude-text font-semibold">{stats ? formatValue(stats.average) : '-'}</div>
            </div>
            <div className="bg-claude-bg rounded-lg border border-claude-border px-2.5 py-2">
              <div className="text-[11px] text-claude-text-muted mb-1">最小值</div>
              <div className="text-sm text-claude-text font-semibold">{stats ? formatValue(stats.min) : '-'}</div>
            </div>
            <div className="bg-claude-bg rounded-lg border border-claude-border px-2.5 py-2">
              <div className="text-[11px] text-claude-text-muted mb-1">最大值</div>
              <div className="text-sm text-claude-text font-semibold">{stats ? formatValue(stats.max) : '-'}</div>
            </div>
            <div className="bg-claude-bg rounded-lg border border-claude-border px-2.5 py-2">
              <div className="text-[11px] text-claude-text-muted mb-1">峰值分类</div>
              <div className="text-sm text-claude-text font-semibold truncate" title={insight.peakCategory}>
                {insight.peakCategory}
              </div>
            </div>
            <div className="bg-claude-bg rounded-lg border border-claude-border px-2.5 py-2">
              <div className="text-[11px] text-claude-text-muted mb-1">区间趋势</div>
              <div className="text-sm text-claude-text font-semibold">{insight.trend}</div>
            </div>
            <div className="bg-claude-bg rounded-lg border border-claude-border px-2.5 py-2">
              <div className="text-[11px] text-claude-text-muted mb-1">波动率(σ)</div>
              <div className="text-sm text-claude-text font-semibold">{insight.volatility}</div>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-1 xl:grid-cols-2 gap-3">
            <div className="bg-claude-bg border border-claude-border rounded-lg p-3">
              <div className="text-xs font-semibold text-claude-text mb-2">公式列</div>
              <div className="grid grid-cols-1 gap-2">
                <input
                  value={formulaName}
                  onChange={(e) => setFormulaName(e.target.value)}
                  className="w-full bg-claude-surface border border-claude-border rounded-md px-2 py-1 text-xs text-claude-text"
                  placeholder="公式名称"
                />
                <input
                  value={formulaExpression}
                  onChange={(e) => setFormulaExpression(e.target.value)}
                  className="w-full bg-claude-surface border border-claude-border rounded-md px-2 py-1 text-xs text-claude-text font-mono"
                  placeholder="表达式: ([营收]-[成本])/[营收]*100"
                />
                <button
                  onClick={handleAddFormula}
                  className="px-2.5 py-1 rounded-md text-xs bg-claude-surface border border-claude-border text-claude-text hover:border-claude-primary"
                >
                  添加公式
                </button>
              </div>
              {formulas.length > 0 && (
                <div className="mt-2 space-y-1">
                  {formulas.map((formula) => (
                    <div key={formula.name} className="flex items-center justify-between gap-2 text-xs border border-claude-border rounded-md px-2 py-1">
                      <span className="truncate text-claude-text">{formula.name}: {formula.expression}</span>
                      <button onClick={() => handleRemoveFormula(formula.name)} className="text-red-300 hover:text-red-200">删除</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-claude-bg border border-claude-border rounded-lg p-3">
              <div className="text-xs font-semibold text-claude-text mb-2">模板与导出</div>
              <div className="flex gap-2 mb-2">
                <input
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  className="flex-1 bg-claude-surface border border-claude-border rounded-md px-2 py-1 text-xs text-claude-text"
                  placeholder="模板名称"
                />
                <button
                  onClick={handleSaveTemplate}
                  className="px-2.5 py-1 rounded-md text-xs bg-claude-surface border border-claude-border text-claude-text hover:border-claude-primary"
                >
                  保存
                </button>
              </div>
              {templates.length > 0 && (
                <div className="space-y-1 mb-2 max-h-28 overflow-auto">
                  {templates.map((template) => (
                    <div key={template.name} className="flex items-center justify-between gap-2 text-xs border border-claude-border rounded-md px-2 py-1">
                      <span className="truncate text-claude-text">{template.name}</span>
                      <div className="flex items-center gap-2">
                        <button onClick={() => handleApplyTemplate(template.name)} className="text-emerald-300 hover:text-emerald-200">应用</button>
                        <button onClick={() => handleDeleteTemplate(template.name)} className="text-red-300 hover:text-red-200">删</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <button onClick={handleExportPng} className="px-2 py-1 rounded-md text-xs bg-claude-surface border border-claude-border text-claude-text">PNG</button>
                <button onClick={handleExportSvg} className="px-2 py-1 rounded-md text-xs bg-claude-surface border border-claude-border text-claude-text">SVG</button>
                <button onClick={() => void handleExportPdf()} className="px-2 py-1 rounded-md text-xs bg-claude-surface border border-claude-border text-claude-text">PDF</button>
                <button onClick={handleExportCsv} className="px-2 py-1 rounded-md text-xs bg-claude-surface border border-claude-border text-claude-text">CSV</button>
              </div>
            </div>
          </div>

          <div className="mt-3 border border-claude-border rounded-lg overflow-hidden">
            <div className="px-3 py-2 bg-claude-bg border-b border-claude-border flex items-center justify-between">
              <span className="text-xs text-claude-text-muted">明细数据（{tableData.total} 行）</span>
              <div className="flex items-center gap-2 text-xs">
                <label className="text-claude-text-muted inline-flex items-center gap-1">
                  每页
                  <input
                    type="number"
                    min={5}
                    max={100}
                    value={pageSize}
                    onChange={(e) => setPageSize(Math.max(5, Number(e.target.value) || 5))}
                    className="w-14 bg-claude-surface border border-claude-border rounded px-1 py-0.5 text-claude-text"
                  />
                </label>
                <button
                  onClick={() => setTablePage((page) => Math.max(1, page - 1))}
                  disabled={tableData.page <= 1}
                  className="px-2 py-0.5 border border-claude-border rounded text-claude-text disabled:opacity-40"
                >
                  上一页
                </button>
                <span className="text-claude-text-muted">{tableData.page}/{tableData.totalPages}</span>
                <button
                  onClick={() => setTablePage((page) => Math.min(tableData.totalPages, page + 1))}
                  disabled={tableData.page >= tableData.totalPages}
                  className="px-2 py-0.5 border border-claude-border rounded text-claude-text disabled:opacity-40"
                >
                  下一页
                </button>
              </div>
            </div>
            <div className="max-h-[220px] overflow-auto bg-claude-surface">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-claude-bg/95">
                  <tr>
                    {allColumns.slice(0, 10).map((column) => (
                      <th key={column} className="text-left font-medium text-claude-text-muted px-2 py-1.5 border-b border-claude-border whitespace-nowrap">
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tableData.items.map((row, index) => (
                    <tr key={`${index}-${Object.values(row).join('|')}`} className="odd:bg-claude-bg/30">
                      {allColumns.slice(0, 10).map((column) => (
                        <td key={column} className="px-2 py-1.5 text-claude-text border-b border-claude-border/50 whitespace-nowrap">
                          {(row[column] || '-').toString()}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
