import { atom, useAtomValue, useSetAtom } from 'jotai';
import { useEffect } from 'react';

import {
  configAtom,
  editorFormatAtom,
  simulatedTimeAtom,
  type PlaygroundConfig
} from './atoms';

interface URLState {
  config: PlaygroundConfig;
  format: 'json' | 'string';
  simulatedTime?: string;
}

function encodeState(state: URLState): string {
  const json = JSON.stringify(state);
  // Use native compression if available, fallback to uncompressed
  const encoded = btoa(unescape(encodeURIComponent(json)));
  return encoded.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeState(hash: string): URLState | null {
  try {
    const base64 = hash.replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(escape(atob(base64)));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

// Atom that syncs to URL
export const urlStateAtom = atom(
  get => {
    const config = get(configAtom);
    const format = get(editorFormatAtom);
    const simulatedTime = get(simulatedTimeAtom);
    return {
      config,
      format,
      simulatedTime: simulatedTime?.toISOString()
    };
  },
  (_get, set, hash: string) => {
    const state = decodeState(hash);
    if (state) {
      set(configAtom, state.config);
      set(editorFormatAtom, state.format);
      if (state.simulatedTime) {
        set(simulatedTimeAtom, new Date(state.simulatedTime));
      } else {
        set(simulatedTimeAtom, null);
      }
    }
  }
);

// Hook to sync URL on state changes
export function useURLSync() {
  const state = useAtomValue(urlStateAtom);
  const setURLState = useSetAtom(urlStateAtom);

  useEffect(() => {
    const hash = encodeState(state);
    const currentHash = window.location.hash.slice(1);
    if (hash !== currentHash) {
      window.history.replaceState(null, '', `#${hash}`);
    }
  }, [state]);

  // Load from URL on mount
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.slice(1);
      if (hash) {
        setURLState(hash);
      }
    };

    handleHashChange();
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [setURLState]);
}
