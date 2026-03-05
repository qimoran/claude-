export interface DataRow {
  [key: string]: string
}

export interface ParsedDataset {
  source: 'csv' | 'json'
  columns: string[]
  rows: DataRow[]
}

export interface SeriesData {
  categories: string[]
  values: number[]
}

export interface BasicStats {
  count: number
  sum: number
  average: number
  min: number
  max: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeValue(value: unknown): string {
  if (value === null || value === undefined) {
    return ''
  }
  if (typeof value === 'string') {
    return value.trim()
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return JSON.stringify(value)
}

function parseCsvLine(line: string, delimiter: ',' | '\t'): string[] {
  const values: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]

    if (char === '"') {
      const next = line[i + 1]
      if (inQuotes && next === '"') {
        current += '"'
        i += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (char === delimiter && !inQuotes) {
      values.push(current.trim())
      current = ''
      continue
    }

    current += char
  }

  values.push(current.trim())
  return values
}

function toNumber(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }

  const normalized = trimmed
    .replace(/,/g, '')
    .replace(/%$/, '')
    .replace(/\s+/g, '')

  if (!normalized) {
    return null
  }

  const parsed = Number(normalized)
  if (!Number.isFinite(parsed)) {
    return null
  }

  return parsed
}

export function parseDataInput(input: string): ParsedDataset {
  const raw = input.trim()
  if (!raw) {
    throw new Error('请输入 CSV 或 JSON 数据')
  }

  try {
    const parsed = JSON.parse(raw) as unknown
    if (Array.isArray(parsed) && parsed.length > 0 && parsed.every(isRecord)) {
      const columns = Array.from(
        new Set(parsed.flatMap((item) => Object.keys(item)))
      )
      const rows = parsed.map((item) => {
        const row: DataRow = {}
        columns.forEach((col) => {
          row[col] = normalizeValue(item[col])
        })
        return row
      })

      return {
        source: 'json',
        columns,
        rows,
      }
    }
  } catch {
    // 非 JSON，继续按 CSV 解析
  }

  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  if (lines.length < 2) {
    throw new Error('CSV 至少需要表头和一行数据')
  }

  const commaColumns = parseCsvLine(lines[0], ',').length
  const tabColumns = parseCsvLine(lines[0], '\t').length
  const delimiter: ',' | '\t' = tabColumns > commaColumns ? '\t' : ','

  const headers = parseCsvLine(lines[0], delimiter).map((header, index) => {
    const trimmed = header.trim()
    return trimmed || `column_${index + 1}`
  })

  const rows = lines.slice(1).map((line) => {
    const values = parseCsvLine(line, delimiter)
    const row: DataRow = {}
    headers.forEach((header, index) => {
      row[header] = (values[index] || '').trim()
    })
    return row
  })

  return {
    source: 'csv',
    columns: headers,
    rows,
  }
}

export function detectNumericColumns(rows: DataRow[], columns: string[]): string[] {
  return columns.filter((column) => {
    const numericCount = rows.reduce((count, row) => {
      return toNumber(row[column]) !== null ? count + 1 : count
    }, 0)

    if (numericCount === 0) {
      return false
    }

    // 至少 60% 行是数字，判定为数值列
    return numericCount / Math.max(rows.length, 1) >= 0.6
  })
}

export function buildSeriesData(
  rows: DataRow[],
  categoryColumn: string,
  metricColumn: string,
  maxPoints = 30,
): SeriesData {
  const grouped = new Map<string, number>()

  rows.forEach((row, index) => {
    const value = toNumber(row[metricColumn])
    if (value === null) {
      return
    }

    const fallback = `第 ${index + 1} 行`
    const category = row[categoryColumn]?.trim() || fallback
    grouped.set(category, (grouped.get(category) || 0) + value)
  })

  const points = Array.from(grouped.entries()).slice(0, Math.max(maxPoints, 1))
  return {
    categories: points.map(([category]) => category),
    values: points.map(([, value]) => Number(value.toFixed(4))),
  }
}

export function calculateBasicStats(values: number[]): BasicStats | null {
  if (values.length === 0) {
    return null
  }

  const sum = values.reduce((total, value) => total + value, 0)
  const min = Math.min(...values)
  const max = Math.max(...values)

  return {
    count: values.length,
    sum,
    average: sum / values.length,
    min,
    max,
  }
}
