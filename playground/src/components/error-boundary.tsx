import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = {
  children?: ReactNode;
};

type State = {
  error: Error | null;
  hasError: boolean;
};

export class ErrorBoundary extends Component<Props, State> {
  public override state: State = {
    error: null,
    hasError: false
  };

  public static getDerivedStateFromError(error: Error): State {
    return { error, hasError: true };
  }

  public override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('Uncaught error:', error, errorInfo);
  }

  public override render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary-panel">
          <h3>Something went wrong.</h3>
          <p>The component failed to render.</p>
          <details
            style={{
              fontSize: '0.8rem',
              marginBottom: '1rem',
              whiteSpace: 'pre-wrap'
            }}
          >
            {this.state.error && this.state.error.toString()}
          </details>
          <button
            onClick={() => this.setState({ error: null, hasError: false })}
          >
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
