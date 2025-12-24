import { EditorPanel } from './components/editor-panel';
import { HierarchyPanel } from './components/hierarchy-panel';
import { PatternSandbox } from './components/pattern-sandbox';
import { TesterPanel } from './components/tester-panel';
import { Toolbar } from './components/toolbar';
import { useKeyboardShortcuts } from './hooks/use-keyboard-shortcuts';
import { useURLSync } from './store/url-sync';

export const App = () => {
  useURLSync();
  useKeyboardShortcuts();

  return (
    <div className="playground">
      <Toolbar />
      <main className="playground-main">
        <div className="panels-container">
          <div className="side-column">
            <EditorPanel />
            <PatternSandbox />
          </div>
          <div className="center-column">
            <HierarchyPanel />
          </div>
          <div className="side-column">
            <TesterPanel />
          </div>
        </div>
      </main>
    </div>
  );
};
