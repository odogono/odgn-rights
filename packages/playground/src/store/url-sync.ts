import { atom, useAtomValue, useSetAtom } from 'jotai';
import { useEffect } from 'react';

import {
  normalizePlaygroundConfig,
  type PlaygroundConfig
} from '../helpers/playground-config';
import {
  configAtom,
  editorFormatAtom,
  screenModeAtom,
  simulatedTimeAtom
} from './atoms';

type URLState = {
  config: PlaygroundConfig;
  format: 'json' | 'string';
  screenMode?: 'classic' | 'resources';
  simulatedTime?: string;
};

const encodeState = (state: URLState): string => {
  const json = JSON.stringify(state);
  // Use native compression if available, fallback to uncompressed
  const encoded = btoa(unescape(encodeURIComponent(json)));
  return encoded.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
};

const decodeState = (hash: string): URLState | null => {
  try {
    const base64 = hash.replaceAll('-', '+').replaceAll('_', '/');
    const json = decodeURIComponent(escape(atob(base64)));
    return JSON.parse(json);
  } catch {
    return null;
  }
};

// Atom that syncs to URL
export const urlStateAtom = atom(
  get => {
    const config = get(configAtom);
    const format = get(editorFormatAtom);
    const screenMode = get(screenModeAtom);
    const simulatedTime = get(simulatedTimeAtom);
    return {
      config: normalizePlaygroundConfig(config),
      format,
      screenMode,
      simulatedTime: simulatedTime?.toISOString()
    };
  },
  (_get, set, hash: string) => {
    const state = decodeState(hash);
    if (state) {
      set(configAtom, normalizePlaygroundConfig(state.config));
      set(editorFormatAtom, state.format);
      set(screenModeAtom, state.screenMode ?? 'classic');
      if (state.simulatedTime) {
        set(simulatedTimeAtom, new Date(state.simulatedTime));
      } else {
        set(simulatedTimeAtom, null);
      }
    }
  }
);

// Hook to sync URL on state changes
export const useURLSync = () => {
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
};
