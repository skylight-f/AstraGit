import { useEffect, useRef } from 'react';
import type { DashboardClient } from './apiClient.js';
import type { AppLanguage, LanguagePreference } from './applicationPreferences.js';
import { CommitUsageSettings } from './CommitUsageSettings.js';
import { ModelSettings } from './ModelSettings.js';
import { ApplicationUpdateSettings } from './ApplicationUpdateSettings.js';
import type { ApplicationUpdates } from './useApplicationUpdates.js';

export type SettingsSection = 'general' | 'models' | 'usage' | 'updates';

export function Settings(props: { client: DashboardClient; language: AppLanguage; languagePreference: LanguagePreference; onLanguageChange: (value: LanguagePreference) => void; autoFetchEnabled: boolean; onAutoFetchChange: (enabled: boolean) => void; onModelsChanged: () => void; section: SettingsSection; onSectionChange: (section: SettingsSection) => void; update: ApplicationUpdates; updateDisabled: boolean }) {
  const zh = props.language === 'zh-CN';
  const { section, onSectionChange } = props;
  const page = useRef<HTMLElement>(null);
  useEffect(() => { page.current?.focus({ preventScroll: true }); }, []);
  return <main ref={page} tabIndex={-1} className="gitapp-settings-page macos-ai-app theme-light" aria-label={zh ? '设置' : 'Settings'}>
    <div className="gitapp-settings-body">
      <nav className="gitapp-settings-tabs" aria-label={zh ? '设置分类' : 'Settings categories'}>
        <button type="button" aria-current={section === 'general' ? 'page' : undefined} onClick={() => onSectionChange('general')}>{zh ? '通用' : 'General'}</button>
        <button type="button" aria-current={section === 'models' ? 'page' : undefined} onClick={() => onSectionChange('models')}>{zh ? 'AI 模型' : 'AI models'}</button>
        <button type="button" aria-current={section === 'usage' ? 'page' : undefined} onClick={() => onSectionChange('usage')}>{zh ? 'AI 用量' : 'AI usage'}</button>
        <button type="button" aria-current={section === 'updates' ? 'page' : undefined} onClick={() => onSectionChange('updates')}>{zh ? '应用更新' : 'App updates'}</button>
      </nav>
      <div className={section === 'models' ? 'gitapp-settings-panel gitapp-model-panel' : 'gitapp-settings-panel'} key={section}>
        {section === 'general' ? <><section className="gitapp-settings-section">
          <h2>{zh ? '语言' : 'Language'}</h2>
          <label className="gitapp-language-setting">
            <span>{zh ? '界面语言' : 'Interface language'}</span>
            <select value={props.languagePreference} onChange={event => props.onLanguageChange(event.target.value as LanguagePreference)}>
              <option value="system">{zh ? '跟随系统' : 'Follow system'}</option>
              <option value="zh-CN">简体中文</option>
              <option value="en-US">English</option>
            </select>
          </label>
          <p>{zh ? '切换后立即生效，重新打开应用后保留。' : 'Changes apply immediately and are remembered when you reopen the app.'}</p>
        </section>
        <section className="gitapp-settings-section">
          <h2>Git</h2>
          <label className="gitapp-auto-fetch-setting">
            <input type="checkbox" checked={props.autoFetchEnabled} onChange={event => props.onAutoFetchChange(event.target.checked)} aria-describedby="auto-fetch-description" />
            {zh ? '自动抓取远程更新' : 'Automatically fetch remote updates'}
          </label>
          <p id="auto-fetch-description">{zh ? '打开项目、切换仓库或回到窗口时，后台抓取当前仓库。每个仓库五分钟内最多尝试一次。' : 'Fetch the current repository in the background when opening a project, switching repositories, or returning to the window. Each repository is checked at most once every five minutes.'}</p>
        </section></> : section === 'usage' ? <CommitUsageSettings client={props.client} zh={zh} /> : section === 'updates' ? <ApplicationUpdateSettings zh={zh} update={props.update} disabled={props.updateDisabled} /> : <ModelSettings client={props.client} language={props.language} onChanged={props.onModelsChanged} />}
      </div>
    </div>
  </main>;
}
