import { useEffect, useRef } from 'react';
import type { DashboardClient } from './apiClient.js';
import type { AppLanguage, LanguagePreference } from './applicationPreferences.js';
import { ModelSettings } from './ModelSettings.js';
import { ApplicationUpdateSettings } from './ApplicationUpdateSettings.js';
import type { ApplicationUpdates } from './useApplicationUpdates.js';

export type SettingsSection = 'general' | 'models' | 'updates';

export function Settings(props: { client: DashboardClient; language: AppLanguage; languagePreference: LanguagePreference; onLanguageChange: (value: LanguagePreference) => void; onModelsChanged: () => void; section: SettingsSection; onSectionChange: (section: SettingsSection) => void; update: ApplicationUpdates; updateDisabled: boolean }) {
  const zh = props.language === 'zh-CN';
  const { section, onSectionChange } = props;
  const page = useRef<HTMLElement>(null);
  useEffect(() => { page.current?.focus({ preventScroll: true }); }, []);
  return <main ref={page} tabIndex={-1} className="gitapp-settings-page macos-ai-app theme-light" aria-label={zh ? '设置' : 'Settings'}>
    <div className="gitapp-settings-body">
      <nav className="gitapp-settings-tabs" aria-label={zh ? '设置分类' : 'Settings categories'}>
        <button type="button" aria-current={section === 'general' ? 'page' : undefined} onClick={() => onSectionChange('general')}>{zh ? '通用' : 'General'}</button>
        <button type="button" aria-current={section === 'models' ? 'page' : undefined} onClick={() => onSectionChange('models')}>{zh ? 'AI 模型' : 'AI models'}</button>
        <button type="button" aria-current={section === 'updates' ? 'page' : undefined} onClick={() => onSectionChange('updates')}>{zh ? '应用更新' : 'App updates'}</button>
      </nav>
      <div className={section === 'models' ? 'gitapp-settings-panel gitapp-model-panel' : 'gitapp-settings-panel'} key={section}>
        {section === 'general' ? <section className="gitapp-settings-section">
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
        </section> : section === 'updates' ? <ApplicationUpdateSettings zh={zh} update={props.update} disabled={props.updateDisabled} /> : <ModelSettings client={props.client} language={props.language} onChanged={props.onModelsChanged} />}
      </div>
    </div>
  </main>;
}
