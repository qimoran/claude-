import { Component, ErrorInfo, ReactNode } from 'react'
import { AlertCircle, RefreshCw } from 'lucide-react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary]', error, errorInfo)
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null })
    window.location.reload()
  }

  handleDismiss = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-screen flex items-center justify-center bg-claude-bg p-8">
          <div className="max-w-lg w-full bg-claude-surface border border-red-500/30 rounded-xl p-8 text-center">
            <AlertCircle size={48} className="mx-auto mb-4 text-red-400" />
            <h2 className="text-xl font-semibold text-claude-text mb-2">
              应用发生错误
            </h2>
            <p className="text-sm text-claude-text-muted mb-4">
              遇到了一个未预期的错误，你可以尝试重新加载或忽略此错误。
            </p>
            {this.state.error && (
              <pre className="text-xs text-red-300 bg-red-500/10 rounded-lg p-3 mb-6 overflow-auto max-h-40 text-left">
                {this.state.error.message}
                {this.state.error.stack && `\n\n${this.state.error.stack}`}
              </pre>
            )}
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={this.handleReload}
                className="inline-flex items-center gap-2 px-4 py-2 bg-claude-primary hover:bg-claude-primary-light text-white rounded-lg text-sm transition-colors"
              >
                <RefreshCw size={14} />
                重新加载
              </button>
              <button
                onClick={this.handleDismiss}
                className="px-4 py-2 bg-claude-surface-light hover:bg-claude-border text-claude-text rounded-lg text-sm transition-colors"
              >
                忽略错误
              </button>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
