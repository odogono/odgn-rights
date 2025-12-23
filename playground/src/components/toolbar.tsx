import { useSetAtom } from 'jotai';

import { PRESETS } from '../presets';
import { editorContentAtom, editorFormatAtom } from '../store/atoms';
import { configWithHistoryAtom, useHistory } from '../store/history';

export const Toolbar = () => {
  const { canRedo, canUndo, redo, undo } = useHistory();
  const setConfig = useSetAtom(configWithHistoryAtom);
  const setEditorContent = useSetAtom(editorContentAtom);
  const setEditorFormat = useSetAtom(editorFormatAtom);

  const loadPreset = (key: string) => {
    const preset = PRESETS[key];
    if (preset) {
      setConfig(preset.config);
      // We also update editor content to match
      setEditorFormat('json');
      setEditorContent(JSON.stringify(preset.config, null, 2));
    }
  };

  return (
    <header className="toolbar">
      <div className="toolbar-left">
        <h1>ODGN Rights Playground</h1>

        <select defaultValue="" onChange={e => loadPreset(e.target.value)}>
          <option disabled value="">
            Load Preset...
          </option>
          {Object.entries(PRESETS).map(([key, preset]) => (
            <option key={key} value={key}>
              {preset.name}
            </option>
          ))}
        </select>
      </div>

      <div className="toolbar-center" style={{ display: 'flex', gap: '8px' }}>
        <button disabled={!canUndo} onClick={undo} title="Undo (Ctrl+Z)">
          ↶ Undo
        </button>
        <button disabled={!canRedo} onClick={redo} title="Redo (Ctrl+Shift+Z)">
          ↷ Redo
        </button>
      </div>

      <div className="toolbar-right">
        <button
          onClick={() => {
            const config = JSON.stringify(
              PRESETS['basic-rbac']?.config,
              null,
              2
            );
            navigator.clipboard.writeText(config);
            alert('Basic RBAC config copied to clipboard');
          }}
        >
          Export Basic
        </button>
      </div>
    </header>
  );
};
