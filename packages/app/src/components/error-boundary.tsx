import { Component, type ReactNode } from 'react'
import { ErrorNote } from '@/components/error-note'

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (!this.state.failed) return this.props.children
    return <div className="m-auto p-6"><ErrorNote message="This part didn’t load. Reload the page to try again." /></div>
  }
}
