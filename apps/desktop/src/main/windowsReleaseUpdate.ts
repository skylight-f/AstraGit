import { spawn } from 'node:child_process';
import { win32 } from 'node:path';
import { releasePageUrl, releaseRepository, type WindowsReleaseArtifact } from '@astragit/shared';
import { execFile } from './releaseVerification.js';
import { createRelaunchEnvironment } from './systemProxyEnvironment.js';

export async function readWindowsRelease(fetchRelease: typeof fetch, arch: string) {
  const response = await fetchRelease('https://api.github.com/repos/' + releaseRepository + '/releases/latest', {
    headers: { accept: 'application/vnd.github+json', 'cache-control': 'no-cache' },
    redirect: 'error',
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error('检查 Windows 更新失败：HTTP ' + response.status);
  const source = await response.text();
  if (source.length > 512_000) throw new Error('Windows 发布信息过大。');
  const release = JSON.parse(source) as { tag_name?: unknown; draft?: unknown; prerelease?: unknown; assets?: unknown } | null;
  if (release?.draft !== false || release.prerelease !== false || typeof release.tag_name !== 'string' || !/^v\d+\.\d+\.\d+$/u.test(release.tag_name) || !Array.isArray(release.assets)) {
    throw new Error('Windows 正式发布信息无效。');
  }
  const version = release.tag_name.slice(1);
  const fileName = 'AstraGit-' + version + '-win-x64-setup.exe';
  const downloadUrl = releasePageUrl + '/download/' + release.tag_name + '/' + fileName;
  const matches = release.assets.filter(asset => asset?.name === fileName);
  let artifact: WindowsReleaseArtifact | null = null;
  if (arch === 'x64' && matches.length === 1) {
    const asset = matches[0];
    if (asset.state === 'uploaded' && asset.browser_download_url === downloadUrl && typeof asset.digest === 'string' && /^sha256:[a-f0-9]{64}$/u.test(asset.digest) && Number.isSafeInteger(asset.size) && asset.size >= 100_000 && asset.size <= 2 * 1024 ** 3) {
      artifact = { arch: 'x64', kind: 'exe', fileName, downloadUrl, sha256: asset.digest.slice(7), sizeBytes: asset.size };
    }
  }
  return { version, artifact };
}

// electron-builder's NSIS UUIDv5 of com.astragit.desktop. Keep the identity of existing installers.
const installRegistryKey = 'Software\\b8149867-736e-52d4-a5f9-55a9f621a22a';
const windowsSystemDirectory = () => win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32');
const powerShell = () => win32.join(windowsSystemDirectory(), 'WindowsPowerShell/v1.0/powershell.exe');
const scriptArguments = (script: string) => ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')];
type InstallScope = 'currentuser' | 'allusers';

// An all-users NSIS install can remove a second per-user install. Only update it
// automatically when it is the sole registered installation for this user.
const readScopeScript = [
  "function Get-AstraGitInstallScope($executable) {",
  "  $directory = [IO.Path]::GetDirectoryName($executable)",
  "  $user = (Get-ItemProperty -LiteralPath 'HKCU:\\" + installRegistryKey + "' -Name InstallLocation -ErrorAction SilentlyContinue).InstallLocation",
  "  $machine = (Get-ItemProperty -LiteralPath 'HKLM:\\" + installRegistryKey + "' -Name InstallLocation -ErrorAction SilentlyContinue).InstallLocation",
  "  if ($user -and [IO.Path]::GetFullPath($user).TrimEnd('\\') -eq $directory) { return 'currentuser' }",
  "  if (!$user -and $machine -and [IO.Path]::GetFullPath($machine).TrimEnd('\\') -eq $directory) { return 'allusers' }",
  "}",
].join('\n');

export async function readWindowsInstallScope(executable: string): Promise<InstallScope | null> {
  if (win32.basename(executable).toLowerCase() !== 'astragit.exe') return null;
  const script = readScopeScript + '\nGet-AstraGitInstallScope $env:ASTRAGIT_UPGRADE_EXE';
  const { stdout } = await execFile(powerShell(), scriptArguments(script), {
    env: { ...process.env, ASTRAGIT_UPGRADE_EXE: executable }, timeout: 8_000, windowsHide: true,
  });
  const scope = stdout.trim();
  return scope === 'currentuser' || scope === 'allusers' ? scope : null;
}

// Windows keeps a running executable locked. A system process waits for Main to
// close Git and SQLite, then verifies the cached bytes again and runs NSIS.
const installScript = [
  "$ErrorActionPreference = 'Stop'",
  readScopeScript,
  "$executable = $env:ASTRAGIT_UPGRADE_EXE",
  "$directory = [IO.Path]::GetDirectoryName($executable)",
  "$logPath = Join-Path $env:ASTRAGIT_USER_DATA_DIR 'updates/windows-install.log'",
  "function Write-UpdateLog($message) { Add-Content -LiteralPath $logPath -Value $message -ErrorAction SilentlyContinue }",
  "Set-Content -LiteralPath $logPath -Value 'Waiting for the previous AstraGit process.' -ErrorAction SilentlyContinue",
  "try {",
  "  $old = Get-Process -Id ([int]$env:ASTRAGIT_UPGRADE_PID) -ErrorAction SilentlyContinue",
  "  if ($old -and !$old.WaitForExit(120000)) { throw 'AstraGit did not exit in time.' }",
  "  if ((Get-AstraGitInstallScope $executable) -ne $env:ASTRAGIT_UPGRADE_SCOPE) { throw 'AstraGit installation scope changed.' }",
  "  $installer = $env:ASTRAGIT_UPGRADE_INSTALLER",
  "  if ((Get-Item -LiteralPath $installer).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'The update installer was replaced.' }",
  "  if ((Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash -ne $env:ASTRAGIT_UPGRADE_SHA) { throw 'The update installer failed SHA-256 verification.' }",
  "  $setupOptions = @{ FilePath = $installer; WorkingDirectory = [IO.Path]::GetDirectoryName($installer); ArgumentList = @('/S', '--updated', ('/' + $env:ASTRAGIT_UPGRADE_SCOPE)); PassThru = $true }",
  "  if ($env:ASTRAGIT_UPGRADE_SCOPE -eq 'allusers') { $setupOptions.Verb = 'RunAs' }",
  "  Write-UpdateLog ('Starting the verified installer in scope ' + $env:ASTRAGIT_UPGRADE_SCOPE + '.')",
  "  $setup = Start-Process @setupOptions",
  "  Write-UpdateLog ('Installer process started with PID ' + $setup.Id + '.')",
  "  $setup.WaitForExit()",
  "  Write-UpdateLog ('Installer exit code: ' + $setup.ExitCode)",
  "  if ($setup.ExitCode -ne 0) { throw ('Windows installer exit code: ' + $setup.ExitCode) }",
  "  $installed = [Diagnostics.FileVersionInfo]::GetVersionInfo($executable)",
  "  $version = '{0}.{1}.{2}' -f $installed.FileMajorPart, $installed.FileMinorPart, $installed.FileBuildPart",
  "  if ($version -ne $env:ASTRAGIT_UPGRADE_VERSION) { throw 'The requested version was not installed.' }",
  "} catch {",
  "  Write-UpdateLog ('Update failed: ' + $_.Exception.Message)",
  "  if ($old -and !$old.HasExited) { exit 1 }",
  "  $env:ASTRAGIT_WINDOWS_UPDATE_ERROR = $_.Exception.Message",
  "}",
  "try {",
  "  $launch = New-Object System.Diagnostics.ProcessStartInfo",
  "  $launch.FileName = $executable",
  "  $launch.WorkingDirectory = $directory",
  "  $launch.UseShellExecute = $false",
  "  foreach ($key in @($launch.EnvironmentVariables.Keys)) {",
  "    if ($key -like 'ASTRAGIT_UPGRADE_*') { $launch.EnvironmentVariables.Remove($key) }",
  "  }",
  "  $application = [Diagnostics.Process]::Start($launch)",
  "  Write-UpdateLog ('AstraGit restarted with PID ' + $application.Id + '.')",
  "} catch {",
  "  Write-UpdateLog ('AstraGit restart failed: ' + $_.Exception.Message)",
  "  exit 1",
  "}",
].join('\n');

export async function launchWindowsUpdate(input: { executable: string; installer: string; sha256: string; version: string; dataDirectory: string; mainPid: number }) {
  const scope = await readWindowsInstallScope(input.executable);
  if (!scope) throw new Error('Windows 安装位置已变化，请重新检查更新。');
  const child = spawn(powerShell(), scriptArguments(installScript), {
    detached: true, windowsHide: true, stdio: 'ignore', cwd: windowsSystemDirectory(),
    env: {
      ...createRelaunchEnvironment(),
      ASTRAGIT_USER_DATA_DIR: input.dataDirectory,
      ASTRAGIT_UPGRADE_EXE: input.executable,
      ASTRAGIT_UPGRADE_INSTALLER: input.installer,
      ASTRAGIT_UPGRADE_SHA: input.sha256,
      ASTRAGIT_UPGRADE_VERSION: input.version,
      ASTRAGIT_UPGRADE_SCOPE: scope,
      ASTRAGIT_UPGRADE_PID: String(input.mainPid),
    },
  });
  await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  child.unref();
}
