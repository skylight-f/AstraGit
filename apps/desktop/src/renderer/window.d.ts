import type { RendererBootstrap } from './bootstrapTypes.js';
import type { HomebrewUpdateIndicatorState } from '@astragit/shared';

declare global {
  interface Window {
    astraGit?: {
      getBootstrap?: () => Promise<RendererBootstrap | null>;
      chooseDirectory?: () => Promise<string | null>;
      choosePatchFile?: () => Promise<{ ok: true; canceled: true } | { ok: true; canceled: false; name: string; data: string; byteLength: number } | { ok: false; error: import('@astragit/shared').UserFacingErrorCause }>;
      savePatchFile?: (request: { data: string; sha256: string; suggestedName: string }) => Promise<{ ok: true; canceled: true } | { ok: true; canceled: false; name: string } | { ok: false; error: import('@astragit/shared').UserFacingErrorCause }>;
      saveSourceArchive?: (request: { id: string; projectId: string; repositoryId: string; input: import('./features/git/gitContracts.js').GitArchiveInput }) => Promise<{ ok: true; canceled: true } | ({ ok: true; canceled: false; name: string } & import('./features/git/gitContracts.js').GitArchiveResult) | { ok: false; error: import('@astragit/shared').UserFacingErrorCause }>;
      cancelSourceArchive?: (id: string) => Promise<boolean>;
      performFileAction?: (request: { projectId: string; repositoryId: string; path: string; intent: 'open' | 'reveal' | 'edit-ignore-rule' }) => Promise<{ ok: true; missingFile: boolean } | { ok: false; error: import('@astragit/shared').UserFacingErrorCause }>;
      rendererReady?: () => Promise<void>;
      openUpdates?: (language: 'zh-CN' | 'en-US') => Promise<void>;
      performUpdateAction?: (action: 'check' | 'prepare' | 'restart', language: 'zh-CN' | 'en-US') => Promise<HomebrewUpdateIndicatorState | null>;
      getUpdateIndicator?: () => Promise<HomebrewUpdateIndicatorState | null>;
      onUpdateIndicator?: (listener: (state: HomebrewUpdateIndicatorState) => void) => () => void;
    };
  }
}

export {};
