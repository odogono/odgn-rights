import { useSetAtom } from 'jotai';
import { useEffect } from 'react';

import { Flags } from '@/index';

import { testFlagsAtom } from '../store/atoms';
import { redoAtom, undoAtom } from '../store/history';

export function useKeyboardShortcuts() {
  const undo = useSetAtom(undoAtom);
  const redo = useSetAtom(redoAtom);
  const setFlags = useSetAtom(testFlagsAtom);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Undo: Ctrl+Z / Cmd+Z
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      }

      // Redo: Ctrl+Shift+Z / Cmd+Shift+Z or Ctrl+Y
      if (
        (e.ctrlKey || e.metaKey) &&
        ((e.key === 'z' && e.shiftKey) || e.key === 'y')
      ) {
        e.preventDefault();
        redo();
      }

      // Flag toggles (only when not in text input)
      if (
        !e.ctrlKey &&
        !e.metaKey &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement)
      ) {
        const flagMap: Record<string, number> = {
          c: Flags.CREATE,
          d: Flags.DELETE,
          r: Flags.READ,
          w: Flags.WRITE,
          x: Flags.EXECUTE
        };

        const flag = flagMap[e.key.toLowerCase()];
        if (flag !== undefined) {
          setFlags(current => current ^ flag);
        }
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undo, redo, setFlags]);
}
