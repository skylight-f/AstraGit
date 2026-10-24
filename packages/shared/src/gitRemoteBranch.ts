/** Remote names may contain slashes; choose the longest configured prefix. */
export function splitGitRemoteBranch(reference: string, remotes: readonly string[]): { remote: string; branch: string } | null {
  const remote = remotes.filter(name => reference.startsWith(`${name}/`)).sort((left, right) => right.length - left.length)[0];
  const branch = remote ? reference.slice(remote.length + 1) : '';
  return remote && branch ? { remote, branch } : null;
}
