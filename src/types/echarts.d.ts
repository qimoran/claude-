interface EChartsOption {
  [key: string]: unknown
}

interface EChartsInstance {
  setOption: (option: EChartsOption, notMerge?: boolean) => void
  resize: () => void
  dispose: () => void
}

interface EChartsGlobal {
  init: (dom: HTMLElement) => EChartsInstance
}

interface Window {
  echarts?: EChartsGlobal
}
