import { compareReleaseVersions, describeUserFacingError, redactUserFacingErrorDetails } from '@astragit/shared';
import type { ReleaseUpdateStatus as DesktopReleaseUpdateStatus, HomebrewUpdateIndicatorState } from '@astragit/shared';
import type { DirectReleaseUpdateService as ReleaseUpdateService } from './releaseUpdateService.js';
export type { HomebrewUpdateIndicatorState } from '@astragit/shared';
import { type HomebrewInstalledUpdate, type HomebrewPreparedUpdate, type HomebrewUpdateProgress, type HomebrewUpdateService, isTransientHomebrewDownloadError } from './homebrewUpdateService.js';
import { createNativeUpdateProgressHost, type NativeUpdateProgressHost, type NativeUpdateProgressState } from './nativeUpdateProgress.js';

/** 下载完成与已安装待重启分别由 method 和 phase 表达。 */
export type HomebrewUpdateIndicatorPhase = 'idle' | 'available' | 'manual' | 'downloaded' | 'preparing' | 'retrying' | 'ready' | 'failed';
export type HomebrewUpdateAction = 'check' | 'prepare' | 'restart';


export interface HomebrewUpdateController {
  showOrCheck(): Promise<void>;
  /** Renderer 用户动作仍交给唯一控制器串行处理，不创建另一条下载或安装链路。 */
  performAction(action: HomebrewUpdateAction): Promise<HomebrewUpdateIndicatorState>;
  checkAutomatically(input?: { blockedPrepareVersion?: string | null }): Promise<boolean>;
  getIndicatorState(): HomebrewUpdateIndicatorState;
  restoreIndicatorState(state: HomebrewUpdateIndicatorState): void;
  onIndicatorState(listener: (state: HomebrewUpdateIndicatorState) => void): () => void;
  onCheckCompleted(listener: (checkedAt: string) => void): () => void;
  close(): void;
}

interface CreateHomebrewUpdateControllerOptions {
  helperPath: string;
  language: () => 'zh-CN' | 'en-US';
  loadUpdateStatus: () => Promise<DesktopReleaseUpdateStatus>;
  homebrew: HomebrewUpdateService;
  /** DMG 安装复用已有直接更新与安装交接。 */
  direct: ReleaseUpdateService;
  /** 仅在用户点击后打开经过 Main 校验的官方发布页。 */
  openDownloadPage: (url: string) => Promise<void>;
  currentVersion: string;
  canInstall: () => void;
  onInstallReady: (activate: () => void | Promise<void>) => Promise<boolean>;
  retryDelaysMs?: readonly number[];
  /** 隔离测试注入窗口，不改变生产更新策略。 */
  createHost?: typeof createNativeUpdateProgressHost;
}

/** 窗口状态区分下载完成和自动安装准备完成。 */
type ControllerPhase = 'idle' | 'checking' | 'available' | 'manual' | 'downloaded' | 'preparing' | 'ready' | 'installing' | 'failed' | 'upToDate';

/** 失败阶段决定提示与可执行动作，不从失败状态推断下载故障。 */
type UpdateFailureStep = 'check' | 'prepare' | 'download' | 'install';

/** 两种更新方式共享窗口、状态与调度，安装仍由各自服务完成。 */
type PreparedUpdate = (HomebrewPreparedUpdate & { method: 'homebrew' }) | { method: 'direct'; update: DesktopReleaseUpdateStatus };

const defaultRetryDelaysMs = [60_000, 5 * 60_000] as const;

/** 原生窗口可以隐藏或重启，但唯一后台更新任务不因窗口生命周期重复执行。 */
export function createHomebrewUpdateController(options: CreateHomebrewUpdateControllerOptions): HomebrewUpdateController {
  let host: NativeUpdateProgressHost | null = null;
  let phase: ControllerPhase = 'idle';
  let hidden = false;
  let closed = false;
  let currentUpdate: DesktopReleaseUpdateStatus | null = null;
  let prepared: PreparedUpdate | null = null;
  let installed: HomebrewInstalledUpdate | null = null;
  /** 每次重新检查安装记录，不根据最初下载方式永久推断。 */
  let updateMethod: 'homebrew' | 'direct' | null = null;
  let lastState: NativeUpdateProgressState | null = null;
  let lastFailureStep: UpdateFailureStep = 'check';
  let operation: Promise<void> | null = null;
  let indicatorState = idleIndicator(options.currentVersion);
  const indicatorListeners = new Set<(state: HomebrewUpdateIndicatorState) => void>();
  const checkCompletedListeners = new Set<(checkedAt: string) => void>();
  const retryDelaysMs = options.retryDelaysMs ?? defaultRetryDelaysMs;

  async function ensureHost(): Promise<NativeUpdateProgressHost> {
    if (host) return host;
    const created = await (options.createHost ?? createNativeUpdateProgressHost)({
      executablePath: options.helperPath,
      language: options.language,
    });
    host = created;
    created.onAction((action) => {
      if (action === 'closed' || action === 'later' || action === 'close') {
        hidden = true;
        return;
      }
      hidden = false;
      if (action === 'download') void runExclusive(() => prepareUpdate(false));
      else if (action === 'check') void runExclusive(() => checkForUpdate(true, true).then(() => undefined));
      else if (action === 'open_download_page') void runExclusive(openDownloadPage);
      else if (action === 'open_installer') void runExclusive(openDownloadedUpdate);
      else if (action === 'restart') void runExclusive(installPreparedUpdate);
      else if (action === 'retry') {
        if (lastFailureStep === 'install' && prepared) void runExclusive(installPreparedUpdate);
        else if (lastFailureStep === 'prepare' || lastFailureStep === 'download' || updateMethod === 'homebrew') void runExclusive(() => prepareUpdate(false));
        else void runExclusive(() => checkForUpdate(true, true).then(() => undefined));
      }
    });
    created.onExit(() => {
      if (host === created) host = null;
      hidden = true;
    });
    if (lastState) created.update({ ...lastState, present: !hidden });
    return created;
  }

  function runExclusive(task: () => Promise<void>): Promise<void> {
    if (operation) return operation;
    const running = task().finally(() => {
      if (operation === running) operation = null;
    });
    operation = running;
    return running;
  }

  function setIndicator(next: Omit<HomebrewUpdateIndicatorState, 'updatedAt'> & { updatedAt?: string }): void {
    indicatorState = {
      ...(updateMethod ? { method: updateMethod } : {}),
      ...next,
      updatedAt: next.updatedAt ?? new Date().toISOString(),
    };
    for (const listener of indicatorListeners) listener({ ...indicatorState });
  }

  async function publish(state: NativeUpdateProgressState): Promise<void> {
    lastState = { ...state, present: !hidden };
    if (hidden && !host) return;
    const currentHost = await ensureHost();
    currentHost.update(lastState);
  }

  async function checkForUpdate(present: boolean, updateIndicator: boolean): Promise<DesktopReleaseUpdateStatus | null> {
    phase = 'checking';
    lastFailureStep = 'check';
    if (present) {
      await publish(copyFor(options.language(), 'checking', options.currentVersion));
      (await ensureHost()).show();
    }
    try {
      const update = await retryOperation(options.loadUpdateStatus, 2);
      currentUpdate = update;
      const checkedAt = validIsoDate(update.checkedAt) ?? new Date().toISOString();
      for (const listener of checkCompletedListeners) listener(checkedAt);
      // 已确认安装的新版本等待用户重启；清单变化不能撤销磁盘事实或再次执行升级。
      if (prepared?.method === 'homebrew' && samePreparedUpdate(prepared, update)) {
        currentUpdate = readyUpdate(prepared);
        updateMethod = 'homebrew';
        phase = 'ready';
        if (updateIndicator) setIndicator(indicatorForReady(options.language(), currentUpdate, 'homebrew'));
        if (present) await publish(copyFor(options.language(), 'ready', options.currentVersion, currentUpdate, 'homebrew'));
        return currentUpdate;
      }
      if (update.status === 'up_to_date') {
        prepared = null;
        installed = null;
        phase = 'upToDate';
        if (updateIndicator) setIndicator(idleIndicator(options.currentVersion));
        if (present) await publish(copyFor(options.language(), 'upToDate', options.currentVersion, update));
        return update;
      }
      if (!hasNewerVersion(update)) throw new Error(update.reason || '暂时无法取得可用更新。', { cause: update.error });
      updateMethod = (await options.homebrew.isManaged()) ? 'homebrew' : 'direct';
      if (updateMethod === 'direct' && (update.status !== 'available' || !update.artifact)) {
        await publishManualUpdate(update);
        return update;
      }
      const manualReason = updateMethod === 'direct' ? await options.direct.manualInstallReason(update) : null;
      if (manualReason) {
        await publishManualUpdate(update);
        return update;
      }
      if (prepared && prepared.method === updateMethod && samePreparedUpdate(prepared, update)) {
        phase = 'ready';
        if (updateIndicator) setIndicator(indicatorForReady(options.language(), update, updateMethod));
        if (present) await publish(copyFor(options.language(), 'ready', options.currentVersion, update, updateMethod));
        return update;
      }
      prepared = null;
      installed = null;
      phase = 'available';
      if (updateIndicator) setIndicator(indicatorForAvailable(options.language(), update, updateMethod));
      if (present) await publish(copyFor(options.language(), 'available', options.currentVersion, update, updateMethod));
      return update;
    } catch (error) {
      if (prepared?.method === 'homebrew' && samePreparedUpdate(prepared, prepared.update)) {
        currentUpdate = readyUpdate(prepared);
        phase = 'ready';
        setIndicator(indicatorForReady(options.language(), currentUpdate, 'homebrew'));
        if (present) await publish(copyFor(options.language(), 'ready', options.currentVersion, currentUpdate, 'homebrew'));
        // 检查确实失败，调度器稍后再检查；已安装更新仍可直接重启。
        return null;
      }
      await publishFailure(error, 'check');
      return null;
    }
  }

  async function prepareUpdate(automatic: boolean): Promise<void> {
    if (!currentUpdate || !updateMethod || phase === 'failed' || !canPrepareUpdate(currentUpdate, updateMethod)) {
      const loaded = await checkForUpdate(!automatic, true);
      if (!loaded || !updateMethod || !canPrepareUpdate(loaded, updateMethod)) return;
    }
    if (prepared?.method === 'homebrew' && samePreparedUpdate(prepared, currentUpdate!)) return;
    // 手动安装版本只在用户点击后下载；缺少匹配产物时仍保留发布页入口。
    if (phase === 'manual' && (automatic || !currentUpdate?.artifact)) return;
    phase = 'preparing';
    lastFailureStep = updateMethod === 'homebrew' ? 'install' : 'prepare';
    const update = currentUpdate!;
    setIndicator(indicatorForPreparing(options.language(), update, updateMethod!));
    for (let attempt = 0; ; attempt += 1) {
      try {
        /** 两条下载路径只用真实进度驱动同一窗口。 */
        const onProgress = (progress: HomebrewUpdateProgress): void => {
          lastFailureStep = updateMethod === 'homebrew' ? 'install' : progress.phase === 'downloading' || progress.phase === 'reconnecting' ? 'download' : 'prepare';
          setIndicator(indicatorFromProgress(options.language(), progress, update, updateMethod!));
          void publish(progressCopy(options.language(), progress, update, updateMethod === 'direct'));
        };
        if (updateMethod === 'homebrew') {
          options.canInstall();
          prepared = { ...(await options.homebrew.prepare(update, onProgress)), method: 'homebrew' };
        } else {
          const result = await options.direct.download(onProgress);
          if (!result.accepted) throw new Error(result.reason);
          prepared = { method: 'direct', update: result.update };
          currentUpdate = result.update;
          if (await options.direct.manualInstallReason(result.update)) {
            await publishManualUpdate(result.update);
            return;
          }
        }
        phase = 'ready';
        const ready = readyUpdate(prepared);
        currentUpdate = ready;
        setIndicator(indicatorForReady(options.language(), ready, prepared.method));
        await publish(copyFor(options.language(), 'ready', options.currentVersion, ready, prepared.method));
        return;
      } catch (error) {
        const retryDelayMs = retryDelaysMs[attempt];
        if (updateMethod === 'direct' && automatic && retryDelayMs !== undefined && isTransientUpdateDownloadError(error)) {
          const retryAt = new Date(Date.now() + retryDelayMs).toISOString();
          setIndicator(indicatorForRetry(options.language(), update, retryAt));
          await publish(retryCopy(options.language(), retryAt));
          await wait(retryDelayMs);
          if (closed) return;
          phase = 'preparing';
          setIndicator(indicatorForPreparing(options.language(), update, 'direct'));
          continue;
        }
        prepared = null;
        await publishFailure(error, lastFailureStep);
        return;
      }
    }
  }

  async function installPreparedUpdate(): Promise<void> {
    if (!prepared) {
      await prepareUpdate(false);
      if (!prepared) return;
    }
    lastFailureStep = 'install';
    try {
      if (prepared.method === 'direct' && (await options.direct.manualInstallReason(prepared.update))) {
        await publishManualUpdate(prepared.update);
        return;
      }
      options.canInstall();
      phase = 'installing';
      await publish(copyFor(options.language(), 'installing', options.currentVersion, readyUpdate(prepared), prepared.method));
      if (prepared.method === 'direct' && await options.homebrew.isManaged()) throw new Error('AstraGit 的安装管理方式已变化，请重新检查更新。');
      /** 用户取消退出时保留下载结果；直接安装由原安装器完成退出后的替换。 */
      let accepted: boolean;
      if (prepared.method === 'direct') {
        const result = await options.direct.install();
        if (!result.accepted) {
          prepared = null;
          await checkForUpdate(true, true);
          return;
        }
        accepted = result.restartAccepted === true;
      } else {
        /** brew 已在后台完成安装；退出前仅复验将要重启的真实 App。 */
        const preparedHomebrew = prepared;
        accepted = await options.onInstallReady(async () => {
          const currentHost = await ensureHost();
          installed = await options.homebrew.install(preparedHomebrew, (progress) => {
            void publish(progressCopy(options.language(), progress, preparedHomebrew.update));
          });
          currentHost.relaunchAfterProcessExit({ pid: process.pid, ...installed! });
        });
      }
      if (!accepted) {
        phase = 'ready';
        const ready = readyUpdate(prepared);
        setIndicator(indicatorForReady(options.language(), ready, prepared.method));
        await publish(copyFor(options.language(), 'ready', options.currentVersion, ready, prepared.method));
      }
    } catch (error) {
      await publishFailure(error, 'install');
    }
  }

  /** 手动安装仍可在窗口下载；同一版本已下载时保留打开安装包入口。 */
  async function publishManualUpdate(update: DesktopReleaseUpdateStatus): Promise<void> {
    /** 只复用本次进程中已经完成校验的直接下载。 */
    const downloaded = update.status === 'available' && prepared?.method === 'direct' && samePreparedUpdate(prepared, update);
    if (!downloaded) prepared = null;
    installed = null;
    phase = downloaded ? 'downloaded' : 'manual';
    const state = manualCopy(options.language(), update, downloaded);
    setIndicator({ phase, currentVersion: options.currentVersion, latestVersion: update.latestVersion, detail: state.detail });
    await publish(state);
  }

  /** 打开安装包只响应用户点击；重新检查版本后由下载服务复验磁盘文件。 */
  async function openDownloadedUpdate(): Promise<void> {
    if (!(await checkForUpdate(false, true))) return;
    try {
      if (phase !== 'downloaded' || prepared?.method !== 'direct') {
        await showCurrent();
        return;
      }
      /** 打开操作不会触发重启、安装器或 Homebrew。 */
      const result = await options.direct.openDownloaded();
      if (!result.accepted) {
        prepared = null;
        await checkForUpdate(true, true);
      }
    } catch (error) {
      prepared = null;
      await publishFailure(error, 'prepare');
    }
  }

  /** 保存脱敏后的真实原因，恢复窗口时不用通用错误覆盖它。 */
  async function publishFailure(error: unknown, step: UpdateFailureStep): Promise<void> {
    phase = 'failed';
    lastFailureStep = step;
    const state = failedCopy(options.language(), error, step, updateMethod === 'homebrew' && !prepared && step === 'install');
    setIndicator({
      phase: 'failed',
      currentVersion: options.currentVersion,
      latestVersion: currentUpdate?.latestVersion ?? null,
      detail: state.detail,
      failure: { step, title: state.title, technicalDetail: state.technicalDetail, canRetry: state.canRetry === true },
    });
    await publish(state);
  }

  /** 点击下载页面前重新读取发布信息，持久化状态不能直接决定外部地址。 */
  async function openDownloadPage(): Promise<void> {
    const update = await checkForUpdate(false, true);
    if (!update) return;
    try {
      if (phase === 'manual' && !update.artifact) await options.openDownloadPage(update.releasePageUrl);
      else await showCurrent();
    } catch (error) {
      await publishFailure(error, 'check');
    }
  }

  async function showCurrent(): Promise<void> {
    hidden = false;
    const currentHost = await ensureHost();
    if (lastState) currentHost.update({ ...lastState, present: true });
    currentHost.show();
  }

  async function checkAutomatically(input?: { blockedPrepareVersion?: string | null }): Promise<boolean> {
    hidden = true;
    let loaded = false;
    await runExclusive(async () => {
      const previousIndicator = indicatorState;
      const update = await checkForUpdate(false, false);
      if (!update) return;
      loaded = true;
      if (update.status === 'up_to_date') {
        setIndicator(idleIndicator(options.currentVersion));
        return;
      }
      if (phase === 'manual' || phase === 'downloaded') return;
      const failedHomebrewUpgrade = previousIndicator.method === 'homebrew' && previousIndicator.failure?.step === 'install';
      if ((failedHomebrewUpgrade || input?.blockedPrepareVersion === update.latestVersion) && previousIndicator.failure?.step !== 'check' && previousIndicator.phase === 'failed' && previousIndicator.latestVersion === update.latestVersion) {
        phase = 'failed';
        setIndicator({ ...previousIndicator, updatedAt: new Date().toISOString() });
        lastFailureStep = previousIndicator.failure?.step ?? 'check';
        lastState = nativeStateFromIndicator(options.language(), previousIndicator);
        return;
      }
      if (phase === 'ready' && prepared) {
        setIndicator(indicatorForReady(options.language(), readyUpdate(prepared), prepared.method));
        return;
      }
      setIndicator(indicatorForAvailable(options.language(), update, updateMethod ?? 'direct'));
      await prepareUpdate(true);
    });
    return loaded;
  }

  async function performAction(action: HomebrewUpdateAction): Promise<HomebrewUpdateIndicatorState> {
    if (closed) return { ...indicatorState };
    // 更新按钮承载后台状态；显式详情入口才展示原生更新窗口。
    hidden = true;
    if (action === 'check') await checkAutomatically();
    else if (action === 'prepare') {
      const canPrepare = phase === 'available' || (phase === 'failed' && (lastFailureStep === 'prepare' || lastFailureStep === 'download' || (updateMethod === 'homebrew' && !prepared)));
      if (canPrepare) await runExclusive(() => prepareUpdate(true));
      else if (operation) await operation;
    } else if (action === 'restart' && phase === 'ready') {
      if (prepared) await runExclusive(installPreparedUpdate);
      else {
        // 持久化 ready 不能代替本进程的安装复验；先由服务重新读取安装事实。
        await runExclusive(() => prepareUpdate(true));
      }
    }
    return { ...indicatorState };
  }

  return {
    performAction,
    showOrCheck: () => {
      if (phase === 'preparing' || phase === 'installing' || (phase === 'ready' && prepared) || (phase === 'available' && currentUpdate) || (phase === 'failed' && lastState?.state === 'failed')) return showCurrent();
      hidden = false;
      return runExclusive(() => checkForUpdate(true, true).then(() => undefined));
    },
    checkAutomatically,
    getIndicatorState: () => ({ ...indicatorState }),
    restoreIndicatorState: (state) => {
      if (!isIndicatorState(state) || state.currentVersion !== options.currentVersion || state.phase === 'idle') return;
      indicatorState = { ...state };
      updateMethod = state.method ?? null;
      phase = state.phase === 'ready' ? 'ready' : state.phase === 'failed' ? 'failed' : state.phase === 'manual' || state.phase === 'downloaded' ? state.phase : 'available';
      lastFailureStep = state.failure?.step ?? 'check';
      lastState = nativeStateFromIndicator(options.language(), state);
    },
    onIndicatorState: (listener) => {
      indicatorListeners.add(listener);
      return () => indicatorListeners.delete(listener);
    },
    onCheckCompleted: (listener) => {
      checkCompletedListeners.add(listener);
      return () => checkCompletedListeners.delete(listener);
    },
    close: () => {
      closed = true;
      host?.close();
      host = null;
      indicatorListeners.clear();
      checkCompletedListeners.clear();
    },
  };
}

/** Homebrew 已安装版本是待重启事实；直接下载仍核对对应清单摘要。 */
function samePreparedUpdate(prepared: PreparedUpdate, update: DesktopReleaseUpdateStatus): boolean {
  if (prepared.method === 'homebrew') {
    try { return compareReleaseVersions(prepared.installed.version, prepared.update.currentVersion) > 0; }
    catch { return false; }
  }
  return prepared.update.latestVersion === update.latestVersion && prepared.update.artifact?.sha256 === update.artifact?.sha256;
}

function readyUpdate(prepared: PreparedUpdate): DesktopReleaseUpdateStatus {
  return prepared.method === 'homebrew' ? { ...prepared.update, latestVersion: prepared.installed.version } : prepared.update;
}

function hasNewerVersion(update: DesktopReleaseUpdateStatus): boolean {
  try { return compareReleaseVersions(update.latestVersion, update.currentVersion) > 0; }
  catch { return false; }
}

function canPrepareUpdate(update: DesktopReleaseUpdateStatus, method: 'homebrew' | 'direct'): boolean {
  return method === 'homebrew' ? hasNewerVersion(update) : update.status === 'available' && Boolean(update.artifact);
}

function idleIndicator(currentVersion: string): HomebrewUpdateIndicatorState {
  return {
    phase: 'idle',
    currentVersion,
    latestVersion: null,
    detail: '',
    updatedAt: new Date().toISOString(),
  };
}

function indicatorForAvailable(language: 'zh-CN' | 'en-US', update: DesktopReleaseUpdateStatus, method: 'homebrew' | 'direct'): Omit<HomebrewUpdateIndicatorState, 'updatedAt'> {
  return {
    phase: 'available',
    currentVersion: update.currentVersion,
    latestVersion: update.latestVersion,
    detail: method === 'homebrew'
      ? language === 'zh-CN' ? `AstraGit ${update.latestVersion} 可用，将通过 Homebrew 在后台升级。` : `AstraGit ${update.latestVersion} is available and will be upgraded through Homebrew in the background.`
      : language === 'zh-CN' ? `AstraGit ${update.latestVersion} 可用，正在准备后台下载。` : `AstraGit ${update.latestVersion} is available and will be downloaded in the background.`,
  };
}

function indicatorForPreparing(language: 'zh-CN' | 'en-US', update: DesktopReleaseUpdateStatus, method: 'homebrew' | 'direct'): Omit<HomebrewUpdateIndicatorState, 'updatedAt'> {
  return {
    phase: 'preparing',
    currentVersion: update.currentVersion,
    latestVersion: update.latestVersion,
    detail: method === 'homebrew'
      ? language === 'zh-CN' ? '正在通过 Homebrew 后台升级 AstraGit，你可以继续工作。' : 'Upgrading AstraGit through Homebrew in the background. You can keep working.'
      : language === 'zh-CN' ? `正在下载并校验 AstraGit ${update.latestVersion}。` : `Downloading and verifying AstraGit ${update.latestVersion}.`,
  };
}

function indicatorFromProgress(language: 'zh-CN' | 'en-US', progress: HomebrewUpdateProgress, update: DesktopReleaseUpdateStatus, method: 'homebrew' | 'direct'): Omit<HomebrewUpdateIndicatorState, 'updatedAt'> {
  const ratio = progress.downloadedBytes !== undefined && progress.totalBytes !== undefined && progress.totalBytes > 0 ? Math.min(1, progress.downloadedBytes / progress.totalBytes) : undefined;
  return {
    ...indicatorForPreparing(language, update, method),
    detail: progressCopy(language, progress, update, method === 'direct').detail,
    ...(ratio === undefined ? {} : { progress: ratio }),
  };
}

function indicatorForRetry(language: 'zh-CN' | 'en-US', update: DesktopReleaseUpdateStatus, retryAt: string): Omit<HomebrewUpdateIndicatorState, 'updatedAt'> {
  return {
    phase: 'retrying',
    currentVersion: update.currentVersion,
    latestVersion: update.latestVersion,
    detail: language === 'zh-CN' ? `下载暂时中断，将自动重试 AstraGit ${update.latestVersion}。` : `The download was interrupted and AstraGit ${update.latestVersion} will be retried automatically.`,
    retryAt,
  };
}

function indicatorForReady(language: 'zh-CN' | 'en-US', update: DesktopReleaseUpdateStatus, method: 'homebrew' | 'direct'): Omit<HomebrewUpdateIndicatorState, 'updatedAt'> {
  return {
    phase: 'ready',
    currentVersion: update.currentVersion,
    latestVersion: update.latestVersion,
    detail: method === 'homebrew'
      ? language === 'zh-CN' ? `AstraGit ${update.latestVersion} 已通过 Homebrew 安装，重启后生效。` : `AstraGit ${update.latestVersion} is installed through Homebrew. Restart to use the new version.`
      : language === 'zh-CN' ? `AstraGit ${update.latestVersion} 已下载并通过校验，等待你决定何时重启。` : `AstraGit ${update.latestVersion} is downloaded and verified, waiting for you to choose when to restart.`,
    progress: 1,
  };
}

/** 下载和安装分开表达，未满足自动安装条件时不承诺重启后自动替换。 */
function manualCopy(language: 'zh-CN' | 'en-US', update: DesktopReleaseUpdateStatus, downloaded: boolean): NativeUpdateProgressState {
  const zh = language === 'zh-CN';
  if (downloaded) {
    return {
      state: 'downloaded',
      title: zh ? '安装包已下载' : 'Installer Downloaded',
      detail: zh
        ? `AstraGit ${update.latestVersion} 已下载并通过校验。打开安装包后，请结束工作并退出 AstraGit，将新版拖入“应用程序”完成替换。`
        : `AstraGit ${update.latestVersion} is downloaded and verified. Open the installer, finish your work and quit AstraGit, then drag the new app into Applications.`,
    };
  }
  return {
    state: update.artifact ? 'available' : 'manual',
    title: zh ? '发现新版本' : 'A New Version Is Available',
    detail: update.artifact
      ? zh
        ? `AstraGit ${update.latestVersion} 可用。可在此下载并校验安装包，下载后需要手动替换应用。`
        : `AstraGit ${update.latestVersion} is available. Download and verify it here, then replace the app manually.`
      : zh
        ? `AstraGit ${update.latestVersion} 可用，但暂无匹配此 Mac 的安装包。请前往下载页面查看。`
        : `AstraGit ${update.latestVersion} is available, but no installer matches this Mac. Visit the download page for details.`,
  };
}

function copyFor(language: 'zh-CN' | 'en-US', state: 'checking' | 'available' | 'upToDate' | 'ready' | 'installing', currentVersion: string, update?: DesktopReleaseUpdateStatus, method: 'homebrew' | 'direct' = 'direct'): NativeUpdateProgressState {
  const zh = language === 'zh-CN';
  const latestVersion = update?.latestVersion ?? currentVersion;
  if (state === 'checking') {
    return {
      state,
      title: zh ? '正在检查更新' : 'Checking for Updates',
      detail: zh ? '正在检查是否有可安装的新版本。' : 'Checking whether a new version is available to install.',
      progressCaption: zh ? '正在检查最新版本' : 'Checking the latest version',
    };
  }
  if (state === 'available') {
    return {
      state,
      title: zh ? '发现新版本' : 'A New Version Is Available',
      detail: method === 'homebrew'
        ? zh ? `当前版本 ${currentVersion}，最新版本 ${latestVersion}。Homebrew 会在后台完成升级，重启后生效。` : `Current version ${currentVersion}; latest version ${latestVersion}. Homebrew will upgrade the app in the background. Restart when ready.`
        : zh ? `当前版本 ${currentVersion}，最新版本 ${latestVersion}。AstraGit 可以在后台下载并校验更新。` : `Current version ${currentVersion}; latest version ${latestVersion}. AstraGit can download and verify the update in the background.`,
      ...(method === 'homebrew' ? { primaryActionTitle: zh ? '更新' : 'Update' } : {}),
    };
  }
  if (state === 'upToDate') {
    return {
      state,
      title: zh ? 'AstraGit 已是最新版本' : 'AstraGit Is Up to Date',
      detail: zh ? `当前版本 ${currentVersion}。` : `Current version ${currentVersion}.`,
    };
  }
  if (state === 'ready') {
    return {
      state,
      title: method === 'homebrew' ? zh ? '更新已安装' : 'Update Installed' : zh ? '更新已下载' : 'Update Downloaded',
      detail: method === 'homebrew'
        ? zh ? `AstraGit ${latestVersion} 已通过 Homebrew 安装。点击“立即重启”切换到新版。` : `AstraGit ${latestVersion} is installed through Homebrew. Choose Restart Now to use the new version.`
        : zh ? `AstraGit ${latestVersion} 已下载并通过校验。点击“立即重启”后才会安装并切换到新版。` : `AstraGit ${latestVersion} has been downloaded and verified. It will only be installed after you choose Restart Now.`,
    };
  }
  if (method === 'homebrew') return {
    state,
    title: zh ? '正在重启 AstraGit' : 'Restarting AstraGit',
    detail: zh ? '正在核对已安装的应用，随后重新打开 AstraGit。' : 'Checking the installed app before reopening AstraGit.',
    progressCaption: zh ? '正在重启' : 'Restarting',
  };
  return {
    state,
    title: zh ? '正在安装更新' : 'Installing Update',
    detail: zh ? `正在使用已缓存的 AstraGit ${latestVersion} 安装包。安装成功后 AstraGit 会重新打开。` : `Installing the cached AstraGit ${latestVersion} update. AstraGit will reopen after installation succeeds.`,
    progressCaption: zh ? `正在安装 AstraGit ${latestVersion}` : `Installing AstraGit ${latestVersion}`,
  };
}

function progressCopy(language: 'zh-CN' | 'en-US', progress: HomebrewUpdateProgress, update: DesktopReleaseUpdateStatus, direct = false): NativeUpdateProgressState {
  const zh = language === 'zh-CN';
  if (progress.phase === 'updating') {
    return {
      state: 'updating',
      title: zh ? '正在更新 Homebrew 信息' : 'Updating Homebrew Information',
      detail: zh ? '正在更新安装信息，你可以继续使用 AstraGit。' : 'Updating installation information. You can keep using AstraGit.',
      progressCaption: zh ? '正在更新 Homebrew 信息' : 'Updating Homebrew information',
    };
  }
  if (progress.phase === 'verifying') {
    return {
      state: 'verifying',
      title: zh ? '正在校验更新' : 'Verifying Update',
      detail: !direct
        ? zh ? '正在核对 Homebrew 已安装的 AstraGit。' : 'Checking the AstraGit app installed by Homebrew.'
        : zh ? `正在检查 AstraGit ${update.latestVersion} 更新包是否完整。` : `Checking that the AstraGit ${update.latestVersion} update package is complete.`,
      progressCaption: !direct ? zh ? '正在核对已安装应用' : 'Checking installed app' : zh ? '正在校验下载内容' : 'Verifying downloaded update',
    };
  }
  if (progress.phase === 'reconnecting') {
    return {
      state: 'downloading',
      title: zh ? '正在重新连接' : 'Reconnecting Download',
      detail: zh
        ? `AstraGit 正在为 ${update.artifact?.fileName ?? update.latestVersion} 建立新的下载连接，并保留已下载内容。`
        : `AstraGit is opening a new download connection for ${update.artifact?.fileName ?? update.latestVersion} while keeping downloaded data.`,
      progressCaption: zh ? `第 ${progress.reconnectCount ?? 1} 次重新连接` : `Reconnect ${progress.reconnectCount ?? 1}`,
    };
  }
  if (progress.phase === 'installing') return direct ? copyFor(language, 'installing', update.currentVersion, update) : {
    state: 'installing',
    title: zh ? '正在通过 Homebrew 升级' : 'Upgrading through Homebrew',
    detail: zh ? 'Homebrew 正在下载并安装 AstraGit，你可以继续工作。完成后再决定何时重启。' : 'Homebrew is downloading and installing AstraGit. You can keep working and choose when to restart after it finishes.',
    progressCaption: zh ? '正在运行 brew upgrade' : 'Running brew upgrade',
  };
  const totalBytes = progress.totalBytes;
  const downloadedBytes = progress.downloadedBytes;
  const ratio = downloadedBytes !== undefined && totalBytes !== undefined && totalBytes > 0 ? Math.min(1, downloadedBytes / totalBytes) : undefined;
  const reconnectCount = progress.reconnectCount ?? 0;
  const speedText = progress.bytesPerSecond === undefined ? null : formatByteRate(progress.bytesPerSecond);
  const percentText = ratio === undefined ? null : formatPercent(ratio);
  return {
    state: 'downloading',
    title: zh ? '正在下载 AstraGit 更新' : 'Downloading AstraGit Update',
    detail: zh
      ? `正在下载 AstraGit ${update.latestVersion}${reconnectCount > 0 ? `；已重新连接 ${reconnectCount} 次` : ''}。你可以继续使用 AstraGit。`
      : `Downloading AstraGit ${update.latestVersion}${reconnectCount > 0 ? `; reconnected ${reconnectCount} time${reconnectCount === 1 ? '' : 's'}` : ''}. You can keep using AstraGit.`,
    progressCaption: zh ? `正在下载 AstraGit ${update.latestVersion}` : `Downloading AstraGit ${update.latestVersion}`,
    canReconnect: false,
    ...(ratio === undefined ? {} : { progress: ratio }),
    ...(percentText === null ? {} : { progressText: speedText === null ? percentText : `${percentText} · ${speedText}` }),
  };
}

function retryCopy(language: 'zh-CN' | 'en-US', retryAt: string): NativeUpdateProgressState {
  const zh = language === 'zh-CN';
  return {
    state: 'downloading',
    title: zh ? '下载暂时中断' : 'Download Interrupted',
    detail: zh ? `AstraGit 将在 ${formatLocalTime(retryAt, language)} 自动重试。` : `AstraGit will retry automatically at ${formatLocalTime(retryAt, language)}.`,
    progressCaption: zh ? '等待自动重试' : 'Waiting to retry',
  };
}

function failedCopy(language: 'zh-CN' | 'en-US', error: unknown, step: UpdateFailureStep, allowUpgradeRetry = false): NativeUpdateProgressState {
  const zh = language === 'zh-CN';
  const explanation = describeUserFacingError(error, language);
  const technicalDetail = redactUserFacingErrorDetails(explanation.details);
  // 下载失败只有已识别的短暂中断可以直接重试；安装失败先处理具体原因。
  const canRetry = allowUpgradeRetry || (step !== 'install' && (explanation.action === 'retry' || isTransientUpdateDownloadError(error)));
  const copy = {
    check: {
      title: zh ? '无法检查更新' : 'Could Not Check for Updates',
    },
    prepare: {
      title: zh ? '无法准备更新' : 'Could Not Prepare Update',
    },
    download: {
      title: zh ? '更新下载失败' : 'Update Download Failed',
    },
    install: {
      title: zh ? '更新安装失败' : 'Update Installation Failed',
    },
  }[step];
  return {
    state: 'failed',
    title: copy.title,
    detail: explanation.message,
    canRetry,
    ...(technicalDetail.trim() ? { technicalDetail: technicalDetail.trim() } : {}),
  };
}

function nativeStateFromIndicator(language: 'zh-CN' | 'en-US', state: HomebrewUpdateIndicatorState): NativeUpdateProgressState {
  const zh = language === 'zh-CN';
  if (state.phase === 'downloaded') return { state: 'downloaded', title: zh ? '安装包已下载' : 'Installer Downloaded', detail: state.detail, present: false };
  if (state.phase === 'ready') {
    return {
      state: 'ready',
      title: state.method === 'homebrew' ? zh ? '更新已安装' : 'Update Installed' : zh ? '更新已就绪' : 'Update Ready',
      detail: state.detail,
      present: false,
    };
  }
  if (state.phase === 'failed')
    return {
      state: 'failed',
      title: state.failure?.title ?? (zh ? '更新未完成' : 'Update Incomplete'),
      detail: state.detail,
      technicalDetail: state.failure?.technicalDetail,
      canRetry: state.failure?.canRetry === true && (state.failure.step !== 'install' || state.method === 'homebrew'),
      present: false,
    };
  if (state.phase === 'manual') return { state: 'manual', title: zh ? '发现新版本' : 'A New Version Is Available', detail: state.detail, present: false };
  return {
    state: 'available',
    title: zh ? '发现新版本' : 'A New Version Is Available',
    detail: state.detail,
    present: false,
  };
}

function isIndicatorState(value: HomebrewUpdateIndicatorState): boolean {
  return (
    Boolean(value) &&
    ['idle', 'available', 'manual', 'downloaded', 'preparing', 'retrying', 'ready', 'failed'].includes(value.phase) &&
    (value.method === undefined || value.method === 'homebrew' || value.method === 'direct') &&
    typeof value.currentVersion === 'string' &&
    (value.latestVersion === null || typeof value.latestVersion === 'string') &&
    typeof value.detail === 'string' &&
    validIsoDate(value.updatedAt) !== null
  );
}

function validIsoDate(value: string | undefined): string | null {
  if (value === undefined) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function wait(delayMs: number): Promise<void> {
  return new Promise((resolveWait) => {
    const timer = setTimeout(resolveWait, delayMs);
    timer.unref();
  });
}

function formatPercent(ratio: number): string {
  return `${Math.min(100, Math.floor(Math.max(0, ratio) * 100))}%`;
}

function formatByteRate(bytesPerSecond: number): string {
  const normalized = Math.max(0, bytesPerSecond);
  if (normalized >= 1024 ** 2) return `${formatRateNumber(normalized / 1024 ** 2)} MiB/s`;
  if (normalized >= 1024) return `${formatRateNumber(normalized / 1024)} KiB/s`;
  return `${Math.round(normalized)} B/s`;
}

function formatRateNumber(value: number): string {
  return value >= 10 ? String(Math.round(value)) : value.toFixed(1);
}

function formatLocalTime(value: string, language: 'zh-CN' | 'en-US'): string {
  return new Intl.DateTimeFormat(language, { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

/** Release 检查只读取外部事实；临时失败允许两次短间隔重试。 */
async function retryOperation<T>(operation: () => Promise<T>, retryCount: number): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === retryCount) break;
      await delay(attempt === 0 ? 400 : 1_200);
    }
  }
  throw lastError;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

/** 仅网络下载中断可后台自动重试，校验及安装错误必须保留。 */
function isTransientUpdateDownloadError(error: unknown): boolean {
  return isTransientHomebrewDownloadError(error) || (error instanceof Error && typeof error.cause === 'object' && error.cause !== null && 'code' in error.cause && error.cause.code === 'ASTRAGIT_UPDATE_DOWNLOAD_INTERRUPTED');
}
