import { describe, expect, it } from 'vitest'
import {
  buildSeriesData,
  calculateBasicStats,
  detectNumericColumns,
  parseDataInput,
} from './dataAnalysis'

describe('parseDataInput', () => {
  it('should parse csv input', () => {
    const parsed = parseDataInput('月份,收入,订单\n1月,1200,30\n2月,1800,42')
    expect(parsed.source).toBe('csv')
    expect(parsed.columns).toEqual(['月份', '收入', '订单'])
    expect(parsed.rows).toHaveLength(2)
  })

  it('should parse json array input', () => {
    const parsed = parseDataInput('[{"month":"1月","sales":12},{"month":"2月","sales":20}]')
    expect(parsed.source).toBe('json')
    expect(parsed.columns).toContain('month')
    expect(parsed.columns).toContain('sales')
    expect(parsed.rows[0].sales).toBe('12')
  })
})

describe('detectNumericColumns', () => {
  it('should detect numeric columns with threshold', () => {
    const parsed = parseDataInput('月份,收入,备注\n1月,1200,稳定\n2月,1600,增长')
    const numeric = detectNumericColumns(parsed.rows, parsed.columns)
    expect(numeric).toContain('收入')
    expect(numeric).not.toContain('备注')
  })
})

describe('buildSeriesData', () => {
  it('should aggregate values by category', () => {
    const parsed = parseDataInput('分类,金额\nA,10\nB,5\nA,4')
    const series = buildSeriesData(parsed.rows, '分类', '金额')
    expect(series.categories).toEqual(['A', 'B'])
    expect(series.values).toEqual([14, 5])
  })
})

describe('calculateBasicStats', () => {
  it('should calculate statistics', () => {
    const stats = calculateBasicStats([10, 20, 30])
    expect(stats).not.toBeNull()
    expect(stats?.count).toBe(3)
    expect(stats?.sum).toBe(60)
    expect(stats?.average).toBe(20)
    expect(stats?.min).toBe(10)
    expect(stats?.max).toBe(30)
  })
})
