import { Component } from "react";
import type { ReactNode, ErrorInfo } from "react";

interface AppErrorBoundaryProps {
  children: ReactNode;
  fallbackAction?: ReactNode;
}

interface AppErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  constructor(props: AppErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[OpenTP] App error:", error, info.componentStack);
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center h-full bg-surface-primary">
          <div className="text-center px-6 py-8">
            <div className="text-red-400 text-sm mb-2">
              {this.state.error?.message ?? "Something went wrong"}
            </div>
            <button
              type="button"
              onClick={this.handleRetry}
              className="px-3 py-1.5 bg-surface-tertiary text-content-secondary rounded text-sm hover:bg-surface-hover transition-colors"
            >
              Retry
            </button>
            {this.props.fallbackAction}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
