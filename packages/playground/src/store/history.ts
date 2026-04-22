import { atom, useAtom, useSetAtom } from 'jotai';

import type { PlaygroundConfig } from '../helpers/playground-config';
import { configAtom } from './atoms';

type HistoryState = {
  future: PlaygroundConfig[];
  past: PlaygroundConfig[];
};

const historyAtom = atom<HistoryState>({
  future: [],
  past: []
});

// Maximum history entries to prevent memory issues
const MAX_HISTORY = 50;

// Atom to update config with history tracking
export const configWithHistoryAtom = atom(
  get => get(configAtom),
  (get, set, newConfig: PlaygroundConfig) => {
    const currentConfig = get(configAtom);
    const history = get(historyAtom);

    // Only push to history if config actually changed
    if (JSON.stringify(currentConfig) === JSON.stringify(newConfig)) {
      return;
    }

    // Push current state to past, clear future
    set(historyAtom, {
      future: [],
      past: [...history.past, currentConfig].slice(-MAX_HISTORY)
    });

    set(configAtom, newConfig);
  }
);

// Undo action
export const undoAtom = atom(null, (get, set) => {
  const history = get(historyAtom);
  if (history.past.length === 0) {
    return;
  }

  const currentConfig = get(configAtom);
  const previousConfig = history.past.at(-1)!;

  set(historyAtom, {
    future: [currentConfig, ...history.future],
    past: history.past.slice(0, -1)
  });

  set(configAtom, previousConfig);
});

// Redo action
export const redoAtom = atom(null, (get, set) => {
  const history = get(historyAtom);
  if (history.future.length === 0) {
    return;
  }

  const currentConfig = get(configAtom);
  const nextConfig = history.future[0]!;

  set(historyAtom, {
    future: history.future.slice(1),
    past: [...history.past, currentConfig]
  });

  set(configAtom, nextConfig);
});

// Derived atoms for UI state
export const canUndoAtom = atom(get => get(historyAtom).past.length > 0);
export const canRedoAtom = atom(get => get(historyAtom).future.length > 0);

// Custom hook for convenience
export const useHistory = () => {
  const [canUndo] = useAtom(canUndoAtom);
  const [canRedo] = useAtom(canRedoAtom);
  const undo = useSetAtom(undoAtom);
  const redo = useSetAtom(redoAtom);

  return { canRedo, canUndo, redo, undo };
};
