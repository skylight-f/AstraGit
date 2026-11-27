import { splitGitRemoteBranch } from '@astragit/shared';
import type { ProjectGitRepositorySnapshot } from '../../../api/apiClient.js';
import { defaultRemote } from '../repository/pushTarget.js';

function repositoryWebUrl(remote: string): URL | null {
  try {
    const scp = !remote.includes('://') && /^(?:[^@:/\s]+@)?([\w.-]+):([^\s]+)$/u.exec(remote);
    const address = new URL(scp ? `https://${scp[1]}/${scp[2]}` : remote);
    if (address.protocol === 'ssh:') {
      return new URL(`https://${address.hostname}${address.pathname}`);
    }
    if (address.protocol !== 'https:' && address.protocol !== 'http:') return null;
    const web = new URL(address.origin);
    web.pathname = address.pathname;
    return web;
  } catch {
    return null;
  }
}

export function gitPullRequestUrl(snapshot: ProjectGitRepositorySnapshot): string | null {
  if (snapshot.detached || !snapshot.branch) return null;
  const ref = snapshot.upstream ?? `${defaultRemote(snapshot)}/${snapshot.branch}`;
  if (!snapshot.remoteBranches.includes(ref)) return null;
  const tracked = splitGitRemoteBranch(ref, snapshot.remotes);
  if (!tracked || tracked.branch === 'HEAD') return null;
  const details = snapshot.remoteDetails?.find(item => item.name === tracked.remote);
  const url = details && (repositoryWebUrl(details.fetchUrl) ?? repositoryWebUrl(details.pushUrl));
  if (!url) return null;
  const path = url.pathname.replace(/\/+$/u, '').replace(/\.git$/iu, '');
  if (path.split('/').filter(Boolean).length < 2) return null;
  if (url.hostname === 'github.com') {
    url.pathname = `${path}/compare/${encodeURIComponent(tracked.branch)}`;
    url.searchParams.set('expand', '1');
  } else if (/(^|\.)gitlab([.-]|$)/iu.test(url.hostname)) {
    url.pathname = `${path}/-/merge_requests/new`;
    url.searchParams.set('merge_request[source_branch]', tracked.branch);
  } else return null;
  return url.href;
}
