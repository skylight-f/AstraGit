import { useRef, useState } from 'react';

type PushBatch = {
  repositoryId: string | null;
  stopRequested: boolean;
  stopRequest: Promise<void> | null;
};

export function usePushBatch(cancel: (repositoryId: string) => Promise<{ cancelled: boolean }>, onError: (reason: unknown) => void) {
  const currentBatch = useRef<PushBatch>(null);
  const [stopping, setStopping] = useState(false);

  async function run(runSelections: (batch: { stopped: () => boolean; execute<T>(repositoryId: string, action: () => Promise<T>): Promise<T> }) => Promise<void>) {
    if (currentBatch.current) return;
    const batch: PushBatch = { repositoryId: null, stopRequested: false, stopRequest: null };
    currentBatch.current = batch;
    try {
      await runSelections({
        stopped: () => batch.stopRequested,
        async execute(repositoryId, action) {
          batch.repositoryId = repositoryId;
          try {
            return await action();
          } finally {
            batch.repositoryId = null;
          }
        },
      });
    } finally {
      await batch.stopRequest;
      currentBatch.current = null;
      setStopping(false);
    }
  }

  function stop() {
    const batch = currentBatch.current;
    if (!batch || batch.stopRequest) return;
    const repositoryId = batch.repositoryId;

    batch.stopRequested = true;
    setStopping(true);
    batch.stopRequest = (async () => {
      // Cancellation can arrive while the push is still registering with the local service.
      while (repositoryId && batch.repositoryId === repositoryId) {
        const { cancelled } = await cancel(repositoryId);
        if (cancelled || batch.repositoryId !== repositoryId) return;
        await new Promise<void>(resolve => setTimeout(resolve, 150));
      }
    })().catch(reason => {
      batch.stopRequest = null;
      setStopping(false);
      onError(reason);
    });
  }

  return { run, stop, stopping };
}
