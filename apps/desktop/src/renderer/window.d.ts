import type { RendererBootstrap } from './bootstrapTypes.js';
import type { ReleaseUpdateProgress, ReleaseUpdateStatus } from '@astragit/shared';

declare global {
  interface Window {
    astraGit?: {
      getBootstrap?: () => Promise<RendererBootstrap | null>;
      chooseDirectory?: () => Promise<string | null>;
      rendererReady?: () => Promise<void>;
      checkUpdate?: () => Promise<ReleaseUpdateStatus>;
      downloadUpdate?: () => Promise<ReleaseUpdateStatus>;
      installUpdate?: () => Promise<{ accepted: boolean }>;
      openDownloadedUpdate?: () => Promise<void>;
      openReleasePage?: () => Promise<void>;
      onUpdateProgress?: (listener: (progress: ReleaseUpdateProgress) => void) => () => void;
    };
  }
}

export {};
