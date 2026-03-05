import { useEffect, useMemo, useRef, useState } from 'react'
import { BarChart3, LineChart, AreaChart, PieChart, RefreshCw } from 'lucide-react'
import {
  calculateBasicStats,
  detectNumericColumns,
  parseDataInput,
} from '../../utils/dataAnalysis'

type ChartType = 'bar' | 'line' | 'area' | 'combo' | 'pie'
type AggregateMode = 'sum' | 'avg' | 'max' | 'min'
type SortMode = 'none' | 'desc' | 'asc'
type ThemePreset = 'default' | 'emerald' | 'sunset'

interface DataAnalysisPanelProps {
  isActive: boolean
}

const ECHARTS_CDN_URL = 'https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js'
const ECHARTS_SCRIPT_ID = 'echarts-cdn-script'

const SAMPLE_DATA = `月份,营收,订单数
1月,12800,42
2月,15600,58
3月,14900,51
4月,18200,67
5月,20500,73
6月,23100,82`

let echartsPromise: Promise<EChartsGlobal> | null = null

const THEME_PRESETS: Record<ThemePreset, { primary: string; secondary: string; shadow: string }> = {
  default: { primary: '#569cd6', secondary: '#c586c0', shadow: 'rgba(86, 156, 214, 0.25)' },
  emerald: { primary: '#34d399', secondary: '#22d3ee', shadow: 'rgba(52, 211, 153, 0.25)' },
  sunset: { primary: '#fb7185', secondary: '#f59e0b', shadow: 'rgba(245, 158, 11, 0.24)' },
}

function ensureEChartsLoaded(): Promise<EChartsGlobal> {
  if (window.echarts) {
    return Promise.resolve(window.echarts)
  }

  if (echartsPromise) {
    return echartsPromise
  }

  const loadingPromise = new Promise<EChartsGlobal>((resolve, reject) => {
    const existing = document.getElementById(ECHARTS_SCRIPT_ID) as HTMLScriptElement | null

    const onLoad = () => {
      if (window.echarts) {
        resolve(window.echarts)
        return
      }
      reject(new Error('ECharts 加载成功，但全局对象不可用'))
    }

    const onError = () => {
      reject(new Error('无法加载 ECharts CDN，请检查网络或代理配置'))
    }

    if (existing) {
      existing.addEventListener('load', onLoad, { once: true })
      existing.addEventListener('error', onError, { once: true })
      return
    }

    const script = document.createElement('script')
    script.id = ECHARTS_SCRIPT_ID
    script.src = ECHARTS_CDN_URL
    script.async = true
    script.addEventListener('load', onLoad, { once: true })
    script.addEventListener('error', onError, { once: true })
    document.head.appendChild(script)
  }).catch((error) => {
    echartsPromise = null
    throw error
  })

  echartsPromise = loadingPromise
  return echartsPromise
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

function toNumber(value: string): number | null {
  const normalized = value.trim().replace(/,/g, '').replace(/%$/, '')
  if (!normalized) {
    return null
  }
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
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

export default function DataAnalysisPanel({ isActive }: DataAnalysisPanelProps) {
  const [rawInput, setRawInput] = useState(SAMPLE_DATA)
  const [chartType, setChartType] = useState<ChartType>('bar')
  const [themePreset, setThemePreset] = useState<ThemePreset>('default')
  const [categoryColumn, setCategoryColumn] = useState('')
  const [metricColumn, setMetricColumn] = useState('')
  const [secondaryMetricColumn, setSecondaryMetricColumn] = useState('')
  const [aggregateMode, setAggregateMode] = useState<AggregateMode>('sum')
  const [sortMode, setSortMode] = useState<SortMode>('none')
  const [showLabels, setShowLabels] = useState(true)
  const [smoothLine, setSmoothLine] = useState(true)
  const [maxPoints, setMaxPoints] = useState(20)
  const [chartError, setChartError] = useState<string | null>(null)
  const [chartReady, setChartReady] = useState(false)

  const chartContainerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<EChartsInstance | null>(null)

  const parsed = useMemo(() => {
    try {
      const dataset = parseDataInput(rawInput)
      return { dataset, error: null as string | null }
    } catch (error) {
      const message = error instanceof Error ? error.message : '数据解析失败'
      return { dataset: null, error: message }
    }
  }, [rawInput])

  const numericColumns = useMemo(() => {
    if (!parsed.dataset) {
      return []
    }
    return detectNumericColumns(parsed.dataset.rows, parsed.dataset.columns)
  }, [parsed.dataset])

  const categoryColumns = useMemo(() => {
    if (!parsed.dataset) {
      return []
    }

    const preferred = parsed.dataset.columns.filter((column) => !numericColumns.includes(column))
    return preferred.length > 0 ? preferred : parsed.dataset.columns
  }, [numericColumns, parsed.dataset])

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
      if (!current) {
        return ''
      }
      return numericColumns.includes(current) ? current : ''
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

  const series = useMemo(() => {
    if (!parsed.dataset || !categoryColumn || !metricColumn) {
      return { categories: [], primaryValues: [], secondaryValues: [] }
    }

    interface Bucket {
      category: string
      values: number[]
      secondaryValues: number[]
    }

    const grouped = new Map<string, Bucket>()
    parsed.dataset.rows.forEach((row, index) => {
      const category = row[categoryColumn]?.trim() || `第 ${index + 1} 行`
      const primary = toNumber(row[metricColumn] || '')
      const secondary = secondaryMetricColumn ? toNumber(row[secondaryMetricColumn] || '') : null

      if (primary === null) {
        return
      }

      if (!grouped.has(category)) {
        grouped.set(category, {
          category,
          values: [],
          secondaryValues: [],
        })
      }

      const bucket = grouped.get(category)
      if (!bucket) {
        return
      }
      bucket.values.push(primary)
      if (secondary !== null) {
        bucket.secondaryValues.push(secondary)
      }
    })

    const aggregate = (values: number[]): number => {
      if (values.length === 0) {
        return 0
      }
      if (aggregateMode === 'avg') {
        return values.reduce((acc, value) => acc + value, 0) / values.length
      }
      if (aggregateMode === 'max') {
        return Math.max(...values)
      }
      if (aggregateMode === 'min') {
        return Math.min(...values)
      }
      return values.reduce((acc, value) => acc + value, 0)
    }

    const rows = Array.from(grouped.values()).map((bucket) => ({
      category: bucket.category,
      primary: Number(aggregate(bucket.values).toFixed(4)),
      secondary: bucket.secondaryValues.length > 0
        ? Number(aggregate(bucket.secondaryValues).toFixed(4))
        : null,
    }))

    if (sortMode === 'desc') {
      rows.sort((a, b) => b.primary - a.primary)
    }
    if (sortMode === 'asc') {
      rows.sort((a, b) => a.primary - b.primary)
    }

    const limitedRows = rows.slice(0, Math.max(1, maxPoints))
    return {
      categories: limitedRows.map((item) => item.category),
      primaryValues: limitedRows.map((item) => item.primary),
      secondaryValues: limitedRows.map((item) => item.secondary ?? 0),
    }
  }, [
    aggregateMode,
    categoryColumn,
    maxPoints,
    metricColumn,
    parsed.dataset,
    secondaryMetricColumn,
    sortMode,
  ])

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

  useEffect(() => {
    let disposed = false

    const initChart = async () => {
      if (!chartContainerRef.current) {
        return
      }

      try {
        const echarts = await ensureEChartsLoaded()
        if (disposed || !chartContainerRef.current) {
          return
        }

        chartRef.current?.dispose()
        chartRef.current = echarts.init(chartContainerRef.current)
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
      chartRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!chartReady || !chartRef.current) {
      return
    }

    const cssPrimaryColor = getThemeColor('--c-primary', '#569cd6')
    const textColor = getThemeColor('--c-text', '#d4d4d4')
    const mutedTextColor = getThemeColor('--c-text-muted', '#858585')
    const borderColor = getThemeColor('--c-border', '#3e3e42')
    const surfaceColor = getThemeColor('--c-surface-light', '#2d2d2d')
    const preset = THEME_PRESETS[themePreset]
    const primaryColor = themePreset === 'default' ? cssPrimaryColor : preset.primary
    const secondaryColor = preset.secondary
    const movingAvg = calculateMovingAverage(series.primaryValues, 3)

    const baseOption: EChartsOption = {
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
        data: series.categories as unknown,
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
      chartRef.current.setOption({
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
      }, true)
      chartRef.current.resize()
      return
    }

    const isLineLike = chartType === 'line' || chartType === 'area'
    const hasSecondarySeries = chartType === 'combo' && (
      secondaryMetricColumn || series.secondaryValues.some((value) => value !== 0)
    )
    const option: EChartsOption = {
      ...baseOption,
      legend: chartType === 'combo'
        ? {
          top: 2,
          left: 8,
          textStyle: { color: mutedTextColor },
        }
        : undefined,
      series: [
        {
          name: metricColumn || '主指标',
          type: chartType === 'bar' || chartType === 'combo' ? 'bar' : 'line',
          data: series.primaryValues,
          smooth: isLineLike ? smoothLine : false,
          showSymbol: false,
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
            shadowBlur: chartType === 'bar' || chartType === 'combo' ? 14 : 0,
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
        ...(chartType === 'combo'
          ? [{
            name: secondaryMetricColumn || '3期移动均线',
            type: 'line',
            yAxisIndex: 0,
            smooth: true,
            showSymbol: false,
            data: hasSecondarySeries ? series.secondaryValues : movingAvg,
            lineStyle: {
              width: 2.5,
              color: secondaryColor,
            },
            itemStyle: {
              color: secondaryColor,
            },
          }]
          : []),
      ],
    }

    chartRef.current.setOption(option, true)
    chartRef.current.resize()
  }, [
    chartReady,
    chartType,
    metricColumn,
    secondaryMetricColumn,
    series.categories,
    series.primaryValues,
    series.secondaryValues,
    smoothLine,
    showLabels,
    themePreset,
  ])

  useEffect(() => {
    const onResize = () => {
      chartRef.current?.resize()
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
    }, 120)

    return () => window.clearTimeout(timer)
  }, [isActive])

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
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-claude-text">数据源</h2>
            <button
              onClick={() => setRawInput(SAMPLE_DATA)}
              className="px-2.5 py-1 rounded-md text-xs bg-claude-bg border border-claude-border text-claude-text-muted hover:text-claude-text hover:border-claude-primary transition-colors inline-flex items-center gap-1"
            >
              <RefreshCw size={12} />
              填充示例
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
          {parsed.error && (
            <div className="mt-3 text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-md p-2">
              {parsed.error}
            </div>
          )}
        </section>

        <section className="min-h-0 bg-claude-surface border border-claude-border rounded-xl p-4 flex flex-col">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 mb-3">
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
            <div className="text-xs text-claude-text-muted flex items-end gap-4 pb-1">
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
            </div>
          </div>

          {chartError && (
            <div className="mb-2 text-xs text-yellow-300 bg-yellow-500/10 border border-yellow-500/25 rounded-md p-2">
              {chartError}
            </div>
          )}

          <div className="relative flex-1 min-h-[280px] rounded-lg border border-claude-border bg-claude-bg overflow-hidden">
            <div className="absolute inset-0 opacity-50 pointer-events-none bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.06),transparent_55%)]" />
            <div ref={chartContainerRef} className="relative z-10 h-full w-full" />
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
        </section>
      </div>
    </div>
  )
}
