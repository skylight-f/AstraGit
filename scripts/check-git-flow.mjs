import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { repositoryGitFlowDirectory, verifyBundledGitFlow } from '../packages/git-core/src/gitFlowTool.ts';

export async function verifyGitFlowResources(directory = repositoryGitFlowDirectory) {
  return verifyBundledGitFlow(directory);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await verifyGitFlowResources();
  console.info(`内置 Git Flow AVH ${result.version} 的 ${result.files} 项脚本及许可文件校验通过。`);
}
