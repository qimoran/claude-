import { DataRow } from './dataAnalysis'

export type AggregateMode = 'sum' | 'avg' | 'max' | 'min'
export type SortMode = 'none' | 'desc' | 'asc'
export type MissingFillMode = 'none' | 'zero' | 'mean' | 'forward'
export type OutlierMode = 'none' | 'iqr'
export type TimeGranularity = 'none' | 'day' | 'week' | 'month'

export interface FormulaConfig {
  name: string
  expression: string
}

export interface CleaningOptions {
  missingFillMode: MissingFillMode
  outlierMode: OutlierMode
  outlierMetricColumn: string
  unitFactor: number
  renameMap: Record<string, string>
}

export interface AggregateSeriesOptions {
  categoryColumn: string
  metricColumn: string
  secondaryMetricColumn?: string
  aggregateMode: AggregateMode
  sortMode: SortMode
  maxPoints: number
  topN: number
  cumulative: boolean
  percentage: boolean
  timeColumn?: string
  granularity: TimeGranularity
  drilldownColumns: string[]
  drilldownPath: string[]
  selectedCategory: string | null
}

export interface AggregateSeriesResult {
  categories: string[]
  primaryValues: number[]
  secondaryValues: number[]
  trendLine: number[]
  mom: Array<number | null>
  yoy: Array<number | null>
  filteredRows: DataRow[]
}

export interface ScatterPoint {
  label: string
  value: number[]
}

export interface HeatmapResult {
  xAxis: string[]
  yAxis: string[]
  data: number[][]
}

export interface BoxplotResult {
  categories: string[]
  data: number[][]
}

export interface PaginationResult<T> {
  page: number
  pageSize: number
  total: number
  totalPages: number
  items: T[]
}

export function toNumber(value: string): number | null {
  const normalized = (value || '')
    .trim()
    .replace(/,/g, '')
    .replace(/%$/, '')
  if (!normalized) {
    return null
  }
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function round(value: number, precision = 4): number {
  const factor = 10 ** precision
  return Math.round(value * factor) / factor
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) {
    return 0
  }
  const sorted = [...values].sort((a, b) => a - b)
  const index = (sorted.length - 1) * p
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  if (lower === upper) {
    return sorted[lower]
  }
  const weight = index - lower
  return sorted[lower] * (1 - weight) + sorted[upper] * weight
}

export function sampleRows(rows: DataRow[], maxRows: number): DataRow[] {
  if (rows.length <= maxRows || maxRows <= 0) {
    return rows
  }

  const step = rows.length / maxRows
  const sampled: DataRow[] = []
  for (let i = 0; i < maxRows; i += 1) {
    sampled.push(rows[Math.floor(i * step)])
  }
  return sampled
}

export function paginateRows<T>(rows: T[], page: number, pageSize: number): PaginationResult<T> {
  const safePageSize = Math.max(1, pageSize)
  const total = rows.length
  const totalPages = Math.max(1, Math.ceil(total / safePageSize))
  const safePage = Math.min(Math.max(page, 1), totalPages)
  const start = (safePage - 1) * safePageSize
  const end = start + safePageSize

  return {
    page: safePage,
    pageSize: safePageSize,
    total,
    totalPages,
    items: rows.slice(start, end),
  }
}

function parseDateValue(value: string): Date | null {
  const v = value.trim()
  if (!v) {
    return null
  }

  const normalized = v
    .replace(/年/g, '-')
    .replace(/月/g, '-')
    .replace(/日/g, '')
    .replace(/\//g, '-')

  const parsed = new Date(normalized)
  if (!Number.isNaN(parsed.getTime())) {
    return parsed
  }

  return null
}

function formatDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function formatMonth(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

export function dateToBucket(value: string, granularity: TimeGranularity): string {
  if (granularity === 'none') {
    return value.trim()
  }

  const parsed = parseDateValue(value)
  if (!parsed) {
    return value.trim()
  }

  if (granularity === 'day') {
    return formatDate(parsed)
  }

  if (granularity === 'month') {
    return formatMonth(parsed)
  }

  // week bucket (Monday)
  const date = new Date(parsed)
  const day = date.getDay()
  const shift = day === 0 ? -6 : 1 - day
  date.setDate(date.getDate() + shift)
  return `${formatDate(date)}(周)`
}

export function applyColumnRename(rows: DataRow[], renameMap: Record<string, string>): DataRow[] {
  if (Object.keys(renameMap).length === 0) {
    return rows
  }

  return rows.map((row) => {
    const next: DataRow = {}
    Object.entries(row).forEach(([key, value]) => {
      const newKey = renameMap[key]?.trim() || key
      next[newKey] = value
    })
    return next
  })
}

export function applyFormulaColumns(rows: DataRow[], formulas: FormulaConfig[]): DataRow[] {
  const validFormulas = formulas.filter((f) => f.name.trim() && f.expression.trim())
  if (validFormulas.length === 0) {
    return rows
  }

  return rows.map((row) => {
    const next = { ...row }
    validFormulas.forEach((formula) => {
      try {
        const matches = Array.from(formula.expression.matchAll(/\[([^\]]+)\]/g))
        if (matches.length === 0) {
          return
        }

        let expression = formula.expression
        const vars: Record<string, number> = {}

        matches.forEach((match, index) => {
          const col = match[1]
          const token = `v${index}`
          const num = toNumber(row[col] || '')
          vars[token] = num ?? 0
          expression = expression.replace(match[0], token)
        })

        if (!/^[\dv+\-*/().\s%]+$/.test(expression)) {
          return
        }

        const fn = new Function(...Object.keys(vars), `return ${expression}`) as (...args: number[]) => number
        const result = fn(...Object.values(vars))
        if (Number.isFinite(result)) {
          next[formula.name.trim()] = String(round(result))
        }
      } catch {
        // ignore one bad formula
      }
    })
    return next
  })
}

export function applyCleaning(
  inputRows: DataRow[],
  numericColumns: string[],
  options: CleaningOptions,
): DataRow[] {
  const rows = inputRows.map((row) => ({ ...row }))

  // unit conversion
  if (options.unitFactor !== 1) {
    rows.forEach((row) => {
      numericColumns.forEach((col) => {
        const num = toNumber(row[col] || '')
        if (num !== null) {
          row[col] = String(round(num / options.unitFactor))
        }
      })
    })
  }

  // missing value fill
  if (options.missingFillMode !== 'none') {
    const means: Record<string, number> = {}
    if (options.missingFillMode === 'mean') {
      numericColumns.forEach((col) => {
        const values = rows
          .map((row) => toNumber(row[col] || ''))
          .filter((v): v is number => v !== null)
        means[col] = values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length
      })
    }

    const lastSeen: Record<string, number> = {}
    rows.forEach((row) => {
      numericColumns.forEach((col) => {
        const current = toNumber(row[col] || '')
        if (current !== null) {
          lastSeen[col] = current
          return
        }

        if (options.missingFillMode === 'zero') {
          row[col] = '0'
          return
        }

        if (options.missingFillMode === 'mean') {
          row[col] = String(round(means[col] ?? 0))
          return
        }

        if (options.missingFillMode === 'forward') {
          row[col] = String(round(lastSeen[col] ?? 0))
        }
      })
    })
  }

  // outlier removal
  if (options.outlierMode === 'iqr' && options.outlierMetricColumn) {
    const target = options.outlierMetricColumn
    const values = rows
      .map((row) => toNumber(row[target] || ''))
      .filter((v): v is number => v !== null)
      .sort((a, b) => a - b)

    if (values.length >= 4) {
      const q1 = percentile(values, 0.25)
      const q3 = percentile(values, 0.75)
      const iqr = q3 - q1
      const lower = q1 - 1.5 * iqr
      const upper = q3 + 1.5 * iqr
      return rows.filter((row) => {
        const num = toNumber(row[target] || '')
        if (num === null) {
          return true
        }
        return num >= lower && num <= upper
      })
    }
  }

  // rename columns at the end
  return applyColumnRename(rows, options.renameMap)
}

function computeAggregate(values: number[], mode: AggregateMode): number {
  if (values.length === 0) {
    return 0
  }
  if (mode === 'avg') {
    return values.reduce((a, b) => a + b, 0) / values.length
  }
  if (mode === 'max') {
    return Math.max(...values)
  }
  if (mode === 'min') {
    return Math.min(...values)
  }
  return values.reduce((a, b) => a + b, 0)
}

function linearTrend(values: number[]): number[] {
  if (values.length === 0) {
    return []
  }
  const n = values.length
  const x = values.map((_, i) => i + 1)
  const sumX = x.reduce((a, b) => a + b, 0)
  const sumY = values.reduce((a, b) => a + b, 0)
  const sumXY = x.reduce((acc, item, index) => acc + item * values[index], 0)
  const sumX2 = x.reduce((acc, item) => acc + item * item, 0)
  const denominator = n * sumX2 - sumX * sumX

  if (denominator === 0) {
    return values
  }

  const slope = (n * sumXY - sumX * sumY) / denominator
  const intercept = (sumY - slope * sumX) / n
  return x.map((item) => round(intercept + slope * item))
}

function computeMoM(values: number[]): Array<number | null> {
  return values.map((current, index) => {
    if (index === 0) {
      return null
    }
    const previous = values[index - 1]
    if (previous === 0) {
      return null
    }
    return round(((current - previous) / Math.abs(previous)) * 100, 2)
  })
}

function computeYoY(categories: string[], values: number[]): Array<number | null> {
  const map = new Map<string, number>()
  categories.forEach((category, index) => {
    map.set(category, values[index])
  })

  return categories.map((category, index) => {
    // support YYYY-MM only
    const monthMatch = category.match(/^(\d{4})-(\d{2})/)
    if (!monthMatch) {
      return null
    }
    const year = Number(monthMatch[1]) - 1
    const month = monthMatch[2]
    const key = `${year}-${month}`
    const prev = map.get(key)
    if (prev === undefined || prev === 0) {
      return null
    }
    return round(((values[index] - prev) / Math.abs(prev)) * 100, 2)
  })
}

export function aggregateSeries(rows: DataRow[], options: AggregateSeriesOptions): AggregateSeriesResult {
  const {
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
    drilldownColumns,
    drilldownPath,
    selectedCategory,
  } = options

  let filteredRows = rows

  if (drilldownColumns.length > 0 && drilldownPath.length > 0) {
    filteredRows = filteredRows.filter((row) => {
      return drilldownPath.every((value, index) => {
        const column = drilldownColumns[index]
        return (row[column] || '').trim() === value
      })
    })
  }

  if (selectedCategory) {
    filteredRows = filteredRows.filter((row, index) => {
      const category = timeColumn
        ? dateToBucket(row[timeColumn] || '', granularity)
        : (row[categoryColumn] || `第${index + 1}行`).trim()
      return category === selectedCategory
    })
  }

  const currentLevel = drilldownPath.length
  const currentDrillColumn = drilldownColumns[currentLevel]
  const groupKeyColumn = timeColumn
    ? timeColumn
    : currentDrillColumn || categoryColumn

  const grouped = new Map<string, { primary: number[]; secondary: number[] }>()
  filteredRows.forEach((row, index) => {
    const rawGroupKey = row[groupKeyColumn] || `第${index + 1}行`
    const groupKey = timeColumn ? dateToBucket(rawGroupKey, granularity) : rawGroupKey.trim()
    const primary = toNumber(row[metricColumn] || '')
    if (primary === null) {
      return
    }
    const secondary = secondaryMetricColumn ? toNumber(row[secondaryMetricColumn] || '') : null
    if (!grouped.has(groupKey)) {
      grouped.set(groupKey, { primary: [], secondary: [] })
    }
    const bucket = grouped.get(groupKey)
    if (!bucket) {
      return
    }
    bucket.primary.push(primary)
    if (secondary !== null) {
      bucket.secondary.push(secondary)
    }
  })

  let rowsForChart = Array.from(grouped.entries()).map(([category, bucket]) => ({
    category,
    primary: round(computeAggregate(bucket.primary, aggregateMode)),
    secondary: bucket.secondary.length > 0 ? round(computeAggregate(bucket.secondary, aggregateMode)) : 0,
  }))

  if (sortMode === 'desc') {
    rowsForChart = rowsForChart.sort((a, b) => b.primary - a.primary)
  }
  if (sortMode === 'asc') {
    rowsForChart = rowsForChart.sort((a, b) => a.primary - b.primary)
  }

  const effectiveTopN = topN > 0 ? topN : maxPoints
  rowsForChart = rowsForChart.slice(0, Math.max(1, Math.min(maxPoints, effectiveTopN)))

  let categories = rowsForChart.map((row) => row.category)
  let primaryValues = rowsForChart.map((row) => row.primary)
  const secondaryValues = rowsForChart.map((row) => row.secondary)

  if (cumulative) {
    let sum = 0
    primaryValues = primaryValues.map((value) => {
      sum += value
      return round(sum)
    })
  }

  if (percentage) {
    const total = primaryValues.reduce((a, b) => a + b, 0)
    if (total !== 0) {
      primaryValues = primaryValues.map((value) => round((value / total) * 100, 2))
    }
  }

  // sort by time when grouping by time
  if (timeColumn && granularity !== 'none') {
    const zipped = categories.map((category, index) => ({
      category,
      primary: primaryValues[index],
      secondary: secondaryValues[index],
    }))
    zipped.sort((a, b) => a.category.localeCompare(b.category))
    categories = zipped.map((item) => item.category)
    primaryValues = zipped.map((item) => item.primary)
    for (let i = 0; i < secondaryValues.length; i += 1) {
      secondaryValues[i] = zipped[i].secondary
    }
  }

  return {
    categories,
    primaryValues,
    secondaryValues,
    trendLine: linearTrend(primaryValues),
    mom: computeMoM(primaryValues),
    yoy: computeYoY(categories, primaryValues),
    filteredRows,
  }
}

export function buildScatterData(
  rows: DataRow[],
  xMetricColumn: string,
  yMetricColumn: string,
  bubbleSizeColumn: string,
  labelColumn: string,
  maxPoints: number,
): ScatterPoint[] {
  return rows
    .map((row, index) => {
      const x = toNumber(row[xMetricColumn] || '')
      const y = toNumber(row[yMetricColumn] || '')
      if (x === null || y === null) {
        return null
      }
      const size = bubbleSizeColumn ? toNumber(row[bubbleSizeColumn] || '') ?? 10 : 10
      const label = (row[labelColumn] || `点${index + 1}`).trim()
      return {
        label,
        value: [x, y, Math.max(4, round(size, 2))],
      }
    })
    .filter((item): item is ScatterPoint => item !== null)
    .slice(0, Math.max(1, maxPoints))
}

export function buildHeatmapData(
  rows: DataRow[],
  xColumn: string,
  yColumn: string,
  metricColumn: string,
  aggregateMode: AggregateMode,
): HeatmapResult {
  const xSet = new Set<string>()
  const ySet = new Set<string>()
  const bucketMap = new Map<string, number[]>()

  rows.forEach((row, index) => {
    const x = (row[xColumn] || `X${index + 1}`).trim()
    const y = (row[yColumn] || `Y${index + 1}`).trim()
    const num = toNumber(row[metricColumn] || '')
    if (num === null) {
      return
    }
    xSet.add(x)
    ySet.add(y)
    const key = `${x}__${y}`
    if (!bucketMap.has(key)) {
      bucketMap.set(key, [])
    }
    bucketMap.get(key)?.push(num)
  })

  const xAxis = Array.from(xSet)
  const yAxis = Array.from(ySet)
  const data: number[][] = []

  xAxis.forEach((x, xi) => {
    yAxis.forEach((y, yi) => {
      const key = `${x}__${y}`
      const values = bucketMap.get(key) || []
      const metric = round(computeAggregate(values, aggregateMode), 2)
      data.push([xi, yi, metric])
    })
  })

  return { xAxis, yAxis, data }
}

export function buildBoxplotData(
  rows: DataRow[],
  categoryColumn: string,
  metricColumn: string,
  maxPoints: number,
): BoxplotResult {
  const map = new Map<string, number[]>()
  rows.forEach((row, index) => {
    const category = (row[categoryColumn] || `组${index + 1}`).trim()
    const num = toNumber(row[metricColumn] || '')
    if (num === null) {
      return
    }
    if (!map.has(category)) {
      map.set(category, [])
    }
    map.get(category)?.push(num)
  })

  const categories = Array.from(map.keys()).slice(0, Math.max(1, maxPoints))
  const data = categories.map((category) => {
    const values = (map.get(category) || []).sort((a, b) => a - b)
    if (values.length === 0) {
      return [0, 0, 0, 0, 0]
    }
    const min = values[0]
    const max = values[values.length - 1]
    const q1 = percentile(values, 0.25)
    const median = percentile(values, 0.5)
    const q3 = percentile(values, 0.75)
    return [round(min), round(q1), round(median), round(q3), round(max)]
  })

  return { categories, data }
}
