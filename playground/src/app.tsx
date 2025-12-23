import { EditorPanel } from './components/editor-panel';
import { TesterPanel } from './components/tester-panel';
import { Toolbar } from './components/toolbar';

export const App = () => (
  <div className="playground">
    <Toolbar />
    <main className="playground-main">
      <div className="panels-container">
        <EditorPanel />
        <TesterPanel />
      </div>
    </main>
  </div>
);
