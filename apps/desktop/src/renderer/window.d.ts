import type { RendererBootstrap } from './bootstrapTypes.js';
import type { HomebrewUpdateIndicatorState } from '@astragit/shared';

declare global {
  interface Window {
    astraGit?: {
      getBootstrap?: () => Promise<RendererBootstrap | null>;
      chooseDirectory?: () => Promise<string | null>;
      rendererReady?: () => Promise<void>;
      openUpdates?: (language: 'zh-CN' | 'en-US') => Promise<void>;
      getUpdateIndicator?: () => Promise<HomebrewUpdateIndicatorState | null>;
      onUpdateIndicator?: (listener: (state: HomebrewUpdateIndicatorState) => void) => () => void;
    };
  }
}

export {};
