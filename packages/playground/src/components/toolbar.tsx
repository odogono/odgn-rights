import { useAtomValue, useSetAtom } from 'jotai';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { EllipsisIcon } from 'lucide-react';
import { serializePlaygroundConfig } from '../helpers/playground-config';
import { PRESETS } from '../presets';
import {
  editorContentAtom,
  editorFormatAtom,
  screenModeAtom,
  showDocAtom
} from '../store/atoms';
import { configWithHistoryAtom, useHistory } from '../store/history';

export const Toolbar = () => {
  const { canRedo, canUndo, redo, undo } = useHistory();
  const setConfig = useSetAtom(configWithHistoryAtom);
  const setEditorContent = useSetAtom(editorContentAtom);
  const setEditorFormat = useSetAtom(editorFormatAtom);
  const setScreenMode = useSetAtom(screenModeAtom);
  const screenMode = useAtomValue(screenModeAtom);
  const setShowDoc = useSetAtom(showDocAtom);

  const loadPreset = (key: string) => {
    const preset = PRESETS[key];
    if (preset) {
      setConfig(preset.config);
      setEditorFormat('json');
      setEditorContent(serializePlaygroundConfig(preset.config));
    }
  };

  return (
    <header className="toolbar">
      <div className="toolbar-left" style={{ display: 'flex', alignItems: 'center' }}>
        <h1>ODGN Rights Playground</h1>

        <Select onValueChange={loadPreset}>
          <SelectTrigger className="h-8 text-xs w-[140px]">
            <SelectValue placeholder="Load Preset…" />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(PRESETS).map(([key, preset]) => (
              <SelectItem key={key} value={key}>
                {preset.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="toolbar-center" style={{ display: 'flex', gap: '6px' }}>
        <Button
          onClick={() => setScreenMode('classic')}
          size="sm"
          variant={screenMode === 'classic' ? 'default' : 'outline'}
        >
          Classic View
        </Button>
        <Button
          onClick={() => setScreenMode('resources')}
          size="sm"
          variant={screenMode === 'resources' ? 'default' : 'outline'}
        >
          Resource Tree
        </Button>
        <Button
          disabled={!canUndo}
          onClick={undo}
          size="sm"
          title="Undo (Ctrl+Z)"
          variant="ghost"
        >
          ↶ Undo
        </Button>
        <Button
          disabled={!canRedo}
          onClick={redo}
          size="sm"
          title="Redo (Ctrl+Shift+Z)"
          variant="ghost"
        >
          ↷ Redo
        </Button>
      </div>

      <div className="toolbar-right" style={{ display: 'flex', gap: '6px' }}>
        <Button onClick={() => setShowDoc(true)} size="sm" title="Show Help" variant="outline">
          Help
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline">
              <EllipsisIcon data-icon="inline-start" />
              Actions
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Clipboard</DropdownMenuLabel>
            <DropdownMenuItem
              onSelect={() => {
                navigator.clipboard.writeText(window.location.href);
                alert('URL copied to clipboard!');
              }}
            >
              Copy share URL
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                const config = serializePlaygroundConfig(PRESETS['basic-rbac']!.config);
                navigator.clipboard.writeText(config);
                alert('Basic RBAC config copied to clipboard');
              }}
            >
              Copy basic RBAC config
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
};
