import assert from 'node:assert/strict';
import test from 'node:test';
import { searchWorkspace, searchDestinationAvailable } from '../apps/desktop/src/renderer/workspaceSearchState.ts';

const projects = [{ id: 'project', name: '示例项目', localPath: '/code/工作区' }, { id: 'other', name: 'AstraGit', localPath: '/code/AstraGit' }];
const file = (path, indexStatus = ' ', workingTreeStatus = 'M') => ({ path, indexStatus, workingTreeStatus, category: 'modified' });
const repo = (id, relativePath, fileStatuses, conflictFiles = []) => ({ id, name: id, relativePath, snapshot: { branch: 'main', fileStatuses, conflictFiles } });
const snapshot = { projectId: 'project', projectName: '示例项目', repositories: [
  repo('root', '.', [file('apps/web/', '?', '?'), file('README.md', 'M', 'M'), file('docs/说明.md'), { ...file('src/new name.ts', 'R', ' '), originalPath: 'src/old name.ts' }]),
  repo('web', 'apps/web', [file('README.md', '?', '?'), file('conflict.txt', 'U', 'U')], ['conflict.txt']),
] };

test('workspace search matches names, paths, Unicode and multiple terms, ranking an exact filename first', () => {
  assert.equal(searchWorkspace(projects, snapshot, 'astragit')[0].destination.projectId, 'other');
  assert.equal(searchWorkspace(projects, snapshot, '工作区')[0].destination.kind, 'project');
  assert.equal(searchWorkspace(projects, snapshot, '说明')[0].destination.path, 'docs/说明.md');
  const results = searchWorkspace(projects, snapshot, 'WEB readme');
  assert.equal(results.length, 1);
  assert.deepEqual(results[0].destination, { kind: 'file', projectId: 'project', repositoryId: 'web', path: 'README.md', stage: 'unstaged' });
  assert.equal(searchWorkspace(projects, snapshot, 'README.md')[0].title, 'README.md');
  assert.equal(searchWorkspace(projects, snapshot, 'old name')[0].destination.path, 'src/new name.ts');
});

test('search preserves repository and staging identities and excludes nested-repository placeholders', () => {
  const results = searchWorkspace(projects, snapshot, 'readme');
  assert.equal(results.length, 3);
  assert.equal(new Set(results.map(result => result.id)).size, 3);
  assert.deepEqual(results.filter(result => result.destination.repositoryId === 'root').map(result => result.destination.stage), ['staged', 'unstaged']);
  assert.equal(searchWorkspace(projects, snapshot, 'apps/web/').filter(result => result.destination.kind === 'file').length, 0);
  const conflict = searchWorkspace(projects, snapshot, 'conflict.txt');
  assert.equal(conflict.length, 1);
  assert.equal(conflict[0].destination.stage, 'unstaged');
});

test('empty and unavailable projects still support bounded project navigation without offering every changed file', () => {
  assert.equal(searchWorkspace(projects, null, 'astragit')[0].destination.kind, 'project');
  assert.ok(searchWorkspace(projects, snapshot, '').every(result => result.destination.kind !== 'file'));
  assert.equal(searchWorkspace(projects, snapshot, '', 2).length, 2);
  assert.deepEqual(searchWorkspace(projects, snapshot, 'does-not-exist'), []);
  assert.deepEqual(searchWorkspace([], null, ''), []);
});

test('navigation refuses stale projects, repositories, files and staging versions while retaining actual conflict targets', () => {
  const target = searchWorkspace(projects, snapshot, 'README.md').find(result => result.destination.kind === 'file' && result.destination.stage === 'staged').destination;
  assert.equal(searchDestinationAvailable(snapshot, target), true);
  assert.equal(searchDestinationAvailable(snapshot, { ...target, projectId: 'other' }), false);
  assert.equal(searchDestinationAvailable(snapshot, { ...target, repositoryId: 'removed' }), false);
  assert.equal(searchDestinationAvailable(snapshot, { ...target, path: 'removed.txt' }), false);
  const changed = { ...snapshot, repositories: [repo('root', '.', [file('README.md', ' ', 'M')])] };
  assert.equal(searchDestinationAvailable(changed, target), false);
  assert.equal(searchDestinationAvailable(snapshot, { kind: 'file', projectId: 'project', repositoryId: 'web', path: 'conflict.txt', stage: 'unstaged' }), true);
});
