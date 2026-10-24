import { useEffect, useRef, useState } from 'react';
import type { RepositorySetupInput, RepositorySetupJob } from '@astragit/shared';
import type { DashboardClient } from './apiClient.js';
import { AstraGitApiError } from './transport/localApiTransport.js';

const key = 'astragit.repository-setup.pending.v1';
const running = (job: RepositorySetupJob | null) => job?.status === 'running' || job?.status === 'cancelling';
function pendingId(): string | null { try { return localStorage.getItem(key); } catch { return null; } }
function persist(id: string | null) { try { if (id) localStorage.setItem(key, id); else localStorage.removeItem(key); } catch { /* Server retains job identity. */ } }

/** Mounted with App, so navigation does not stop monitoring or lose update guards. */
export function useRepositorySetup(client: DashboardClient, onOpen: (id: string) => Promise<void>) {
  const [id, setId] = useState(pendingId);
  const [job, setJob] = useState<RepositorySetupJob | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [revision, setRevision] = useState(0);
  const gate = useRef(false);
  const input = useRef<RepositorySetupInput | null>(null);
  const autoOpen = useRef(false);
  const open = useRef(onOpen); open.current = onOpen;
  const busy = starting || running(job) || Boolean(id && !job);
  const missing = error instanceof AstraGitApiError && error.status === 404;

  useEffect(() => {
    if (id) return;
    let live = true;
    void client.loadRepositorySetups().then(jobs => {
      if (!live || gate.current || input.current) return;
      const active = jobs.find(job => running(job));
      if (active) { setId(active.id); setJob(active); persist(active.id); }
    }).catch(() => { /* Opening a local project remains usable while disconnected. */ });
    return () => { live = false; };
  }, [client, id]);

  useEffect(() => {
    if (!id) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const value = await client.loadRepositorySetup(id);
        if (!live) return;
        setJob(value); setError(null);
        if (running(value)) timer = setTimeout(() => void poll(), 700);
        else {
          persist(null);
          if (value.status === 'completed' && value.projectId && autoOpen.current) {
            autoOpen.current = false;
            await open.current(value.projectId);
          }
        }
      } catch (reason) { if (live) setError(reason); }
    };
    void poll();
    return () => { live = false; clearTimeout(timer); };
  }, [client, id, revision]);

  const submit = async (value: RepositorySetupInput) => {
    setStarting(true); setError(null); persist(value.requestId);
    setJob({ id: value.requestId, kind: value.kind, localPath: value.localPath, status: 'running', output: '', startedAt: new Date().toISOString() });
    try {
      const valueJob = await client.startRepositorySetup(value);
      setJob(valueJob); setId(valueJob.id); setError(null); setRevision(n => n + 1);
    } catch (reason) {
      if (reason instanceof AstraGitApiError && reason.status >= 400 && reason.status < 500) { setJob(null); setId(null); persist(null); }
      else setId(value.requestId); // Reconnect to the same identity, never mint a retry job.
      setError(reason);
    } finally { setStarting(false); }
  };

  return {
    job, busy, error, missing, draft: input.current,
    start: async (value: Omit<RepositorySetupInput, 'requestId'>, openWhenDone: boolean) => {
      if (gate.current || busy) return;
      gate.current = true; autoOpen.current = openWhenDone;
      input.current = { ...value, requestId: crypto.randomUUID() };
      try { await submit(input.current); } finally { gate.current = false; }
    },
    reconnect: async () => {
      if (gate.current) return;
      gate.current = true;
      try { if (input.current) await submit(input.current); else { setError(null); setRevision(n => n + 1); } }
      finally { gate.current = false; }
    },
    cancel: async () => {
      if (!id || gate.current) return;
      gate.current = true;
      try { setJob(await client.cancelRepositorySetup(id)); setError(null); setRevision(n => n + 1); }
      catch (reason) { setError(reason); }
      finally { gate.current = false; }
    },
    clear: () => { if (!busy || missing) { setJob(null); setId(null); setError(null); input.current = null; autoOpen.current = false; persist(null); } },
    open: () => job?.projectId ? open.current(job.projectId) : Promise.resolve(),
  };
}
