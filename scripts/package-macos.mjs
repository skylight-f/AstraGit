import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, readdir, readFile, realpath, rm, unlink, writeFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, Platform } from 'electron-builder';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const desktop = join(root, 'apps/desktop');
const output = join(root, 'release');
const appId = 'com.astragit.desktop';
const productName = 'AstraGit';
// Actions 未设置的 Secret 会成为空字符串；构建器必须收到未定义值，而非空证书路径。
for (const key of ['CSC_LINK', 'CSC_NAME', 'CSC_KEYCHAIN', 'CSC_INSTALLER_LINK']) if (process.env[key] !== undefined && !process.env[key].trim()) delete process.env[key];
const releaseBuild = process.argv.includes('--release');
const signingConfigured = Boolean(process.env.CSC_LINK || process.env.CSC_NAME);
const notarizationConfigured = Boolean((process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID) || (process.env.APPLE_API_KEY && process.env.APPLE_API_KEY_ID && process.env.APPLE_API_ISSUER));
if (releaseBuild && process.env.REQUIRE_APPLE_DISTRIBUTION === 'true' && (!signingConfigured || !notarizationConfigured)) throw new Error('本次发布要求 Developer ID 签名与公证，请配置 Apple 发布凭据。');
if (process.platform !== 'darwin' || !['arm64', 'x64'].includes(process.arch)) {
  throw new Error('build:app currently supports macOS arm64 and x64, using the host architecture.');
}
mkdirSync(output, { recursive: true });
const stagingRoot = await mkdtemp(join(output, '.app-stage-'));
const appDirectory = join(stagingRoot, 'app');

function run(command, args) {
  return new Promise((resolveExit, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolveExit() : reject(new Error(`${command} exited with ${code ?? signal}`)));
  });
}

async function assertInternalLinks(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      const target = await realpath(path);
      const part = relative(appDirectory, target);
      if (part === '..' || part.startsWith(`..${sep}`) || part.startsWith(sep)) {
        throw new Error(`Packaged dependency resolves outside its staging directory: ${path} -> ${target}`);
      }
    } else if (entry.isDirectory()) {
      await assertInternalLinks(path);
    }
  }
}

try {
  // 使用共享锁文件生成部署锁文件；无需重新解析 semver 或依赖机器上的元数据缓存。
  const deployArgs = ['--filter', '@astragit/desktop', 'deploy', '--prod', '--offline', appDirectory];
  if (process.env.npm_execpath) await run(process.execPath, [process.env.npm_execpath, ...deployArgs]);
  else await run('pnpm', deployArgs);
  // 兼容旧 pnpm 生成的自引用 bookkeeping 链接，只移除指向已验证源码目录的一项。
  const selfLink = join(appDirectory, 'node_modules/.pnpm/node_modules/@astragit/desktop');
  if (await realpath(selfLink).catch(() => null) === desktop) await unlink(selfLink);
  await assertInternalLinks(appDirectory);
  for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) await cp(join(root, file), join(appDirectory, file));
  const manifestPath = join(appDirectory, 'package.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.name = 'astragit';
  manifest.productName = productName;
  manifest.author = 'AstraGit contributors';
  delete manifest.devDependencies;
  delete manifest.scripts;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const requireDesktop = createRequire(join(desktop, 'package.json'));
  const electronManifest = requireDesktop.resolve('electron/package.json');
  const electronVersion = JSON.parse(await readFile(electronManifest, 'utf8')).version;
  await build({
    projectDir: root,
    targets: Platform.MAC.createTarget(releaseBuild ? 'dmg' : 'dir'),
    publish: 'never',
    config: {
      extends: null,
      appId,
      productName,
      buildVersion: manifest.version,
      electronVersion,
      electronDist: join(dirname(electronManifest), 'dist'),
      directories: { app: appDirectory, output, buildResources: join(desktop, 'build') },
      files: ['dist/**', 'package.json', 'LICENSE', 'THIRD_PARTY_NOTICES.md', '!**/*.map', '!**/*.d.ts'],
      extraResources: [{ from: join(desktop, 'build/icon.png'), to: 'branding/icon.png' }],
      asar: true,
      npmRebuild: false,
      artifactName: 'AstraGit-${version}-${arch}.${ext}',
      mac: {
        category: 'public.app-category.developer-tools',
        icon: join(desktop, 'build/icon.icns'),
        // 本地验收仍使用 ad-hoc；显式发行入口才读取签名、公证凭据。
        identity: releaseBuild && signingConfigured ? undefined : '-',
        hardenedRuntime: true,
        notarize: releaseBuild && signingConfigured && notarizationConfigured,
        minimumSystemVersion: '13.0',
      },
    },
  });
  const appPath = join(output, process.arch === 'arm64' ? 'mac-arm64' : 'mac', `${productName}.app`);
  const requireBuilder = createRequire(createRequire(import.meta.url).resolve('electron-builder'));
  const asar = requireBuilder('@electron/asar');
  const archive = join(appPath, 'Contents/Resources/app.asar');
  const packagedIcon = await readFile(join(appPath, 'Contents/Resources/branding/icon.png'));
  if (!packagedIcon.equals(await readFile(join(desktop, 'build/icon.png')))) throw new Error('Packaged Dock icon does not match the AstraGit icon source.');
  const archiveFiles = new Set(asar.listPackage(archive));
  const requiredFiles = ['dist/main/main.js', 'dist/main/releaseInstaller.js', 'dist/main/releaseUpdateService.js', 'dist/main/releaseArtifact.js', 'dist/main/homebrewUpdateService.js', 'dist/main/homebrewInstaller.js', 'dist/preload/index.cjs', 'dist/renderer/index.html', 'LICENSE', 'THIRD_PARTY_NOTICES.md'];
  for (const name of ['git-server', 'git-core', 'ai-runtime', 'shared', 'storage']) {
    requiredFiles.push(`node_modules/@astragit/${name}/dist/index.js`);
  }
  for (const file of requiredFiles) {
    if (!archiveFiles.has(`/${file}`)) throw new Error(`Application archive is missing ${file}`);
  }
  for (const file of archiveFiles) {
    if (asar.statFile(archive, file.slice(1)).link) throw new Error(`Application archive contains an unresolved link: ${file}`);
  }
  const packagedManifest = JSON.parse(asar.extractFile(archive, 'package.json').toString());
  if (packagedManifest.name !== 'astragit' || packagedManifest.version !== manifest.version) throw new Error('Incorrect packaged application identity.');
  await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', appPath]);
  let signed = false;
  let notarized = false;
  if (releaseBuild && signingConfigured) {
    // 根据实际 App 证明签名与公证，不用环境变量伪造清单能力。
    const { spawnSync } = await import('node:child_process');
    const details = spawnSync('/usr/bin/codesign', ['-dv', '--verbose=4', appPath], { encoding: 'utf8' });
    signed = /^TeamIdentifier=[A-Z0-9]{10}$/mu.test(details.stderr ?? '');
    if (!signed) throw new Error('配置了正式签名，但实际产物没有 Developer ID 团队。');
    if (notarizationConfigured) { await run('/usr/bin/xcrun', ['stapler', 'validate', appPath]); await run('/usr/sbin/spctl', ['--assess', '--type', 'execute', appPath]); notarized = true; }
  }
  await writeFile(join(output, 'build-info.json'), `${JSON.stringify({
    productName, appId, version: manifest.version, architecture: process.arch,
    electronVersion, application: appPath, signing: signed ? 'Developer ID' : 'ad-hoc', notarized,
    archiveSha256: createHash('sha256').update(await readFile(archive)).digest('hex'),
    archiveEntries: archiveFiles.size, builtAt: new Date().toISOString(),
  }, null, 2)}\n`);
  if (releaseBuild) {
    const fileName = `AstraGit-${manifest.version}-${process.arch}.dmg`;
    const artifact = join(output, fileName);
    const bytes = await readFile(artifact);
    await run('/usr/bin/hdiutil', ['verify', artifact]);
    await writeFile(join(output, `artifact-${process.arch}.json`), JSON.stringify({ version: manifest.version, signed, notarized, artifact: { arch: process.arch, kind: 'dmg', fileName, sha256: createHash('sha256').update(bytes).digest('hex'), sizeBytes: bytes.length } }, null, 2) + '\n');
  }
  console.info(`\n正式应用: ${appPath}\nBundle ID: ${appId}\n签名: ${signed ? 'Developer ID' : 'ad-hoc'}; 公证: ${notarized}`);
} finally {
  await rm(stagingRoot, { recursive: true, force: true });
}
