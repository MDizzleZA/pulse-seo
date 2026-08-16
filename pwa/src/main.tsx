import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

interface BoundaryState {
  error: Error | null;
}

/** A crash should never white-screen a paying user: show the error + reload. */
class ErrorBoundary extends React.Component<React.PropsWithChildren, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  render(): React.ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center max-w-md px-6">
          <div className="text-xl font-bold text-slate-200 mb-2">Something went wrong</div>
          <div className="text-sm text-slate-500 mb-4 break-all">
            {this.state.error.message || String(this.state.error)}
          </div>
          <button className="btn btn-primary px-6 py-2" onClick={() => location.reload()}>
            Reload
          </button>
          <div className="text-xs text-slate-600 mt-4">
            If this keeps happening, the .pulse file may be damaged — re-export it from the
            desktop app, or contact support@pulseseo.com with the message above.
          </div>
        </div>
      </div>
    );
  }
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);

// Offline support (secure contexts only; localhost counts).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => undefined);
  });
}
