import { DataRow } from '../utils/dataAnalysis'
import { AggregateSeriesOptions, aggregateSeries } from '../utils/analysisAdvanced'

interface WorkerRequest {
  rows: DataRow[]
  options: AggregateSeriesOptions
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  try {
    const result = aggregateSeries(event.data.rows, event.data.options)
    self.postMessage({ success: true, result })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Worker 计算失败'
    self.postMessage({ success: false, error: message })
  }
}
