import { useAtomValue } from 'jotai';

import { DocPanel } from './components/doc-panel';
import { EditorPanel } from './components/editor-panel';
import { ErrorBoundary } from './components/error-boundary';
import { HierarchyPanel } from './components/hierarchy-panel';
import { PatternSandbox } from './components/pattern-sandbox';
import { TestSuitePanel } from './components/test-suite-panel';
import { TesterPanel } from './components/tester-panel';
import { Toolbar } from './components/toolbar';
import { useKeyboardShortcuts } from './hooks/use-keyboard-shortcuts';
import { showDocAtom } from './store/atoms';
import { useURLSync } from './store/url-sync';

export const App = () => {
  useURLSync();
  useKeyboardShortcuts();
  const showDoc = useAtomValue(showDocAtom);

  return (
    <div
      aria-label="ODGN Rights Playground"
      className="playground"
      role="application"
    >
      <Toolbar />
      <main className="playground-main">
        <div className="panels-container">
          <div className="side-column">
            <ErrorBoundary>
              <EditorPanel />
            </ErrorBoundary>
            <ErrorBoundary>
              <PatternSandbox />
            </ErrorBoundary>
          </div>
          <div className="center-column">
            <ErrorBoundary>
              <HierarchyPanel />
            </ErrorBoundary>
          </div>
          <div className="side-column">
            <ErrorBoundary>
              <TesterPanel />
            </ErrorBoundary>
            <ErrorBoundary>
              <TestSuitePanel />
            </ErrorBoundary>
          </div>
        </div>
      </main>
      {showDoc && <DocPanel />}
    </div>
  );
};
