import { EditorPanel } from './components/editor-panel';
import { HierarchyPanel } from './components/hierarchy-panel';
import { PatternSandbox } from './components/pattern-sandbox';
import { TesterPanel } from './components/tester-panel';
import { Toolbar } from './components/toolbar';

export const App = () => (
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
