import { useEffect, useRef } from 'react';
import { ArrowLeft } from '@phosphor-icons/react/dist/csr/ArrowLeft';
import type { DashboardClient } from './apiClient.js';
import type { AppLanguage, LanguagePreference } from './applicationPreferences.js';
import { ModelSettings } from './ModelSettings.js';
import { Button } from './ui/Button.js';
import { ApplicationUpdateSettings } from './ApplicationUpdateSettings.js';
import type { ApplicationUpdates } from './useApplicationUpdates.js';

export type SettingsSection = 'general' | 'models' | 'updates';

export function Settings(props: { client: DashboardClient; language: AppLanguage; languagePreference: LanguagePreference; onLanguageChange: (value: LanguagePreference) => void; onClose: () => void; onModelsChanged: () => void; section: SettingsSection; onSectionChange: (section: SettingsSection) => void; update: ApplicationUpdates; updateDisabled: boolean }) {
  const zh = props.language === 'zh-CN';
  const { section, onSectionChange } = props;
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);
  return <main className="gitapp-settings-page macos-ai-app theme-light" aria-labelledby="gitapp-settings-heading">
    <header className="gitapp-settings-header">
      <h1 id="gitapp-settings-heading" ref={heading} tabIndex={-1}>{zh ? '设置' : 'Settings'}</h1>
      <Button variant="secondary" size="compact" onClick={props.onClose}><ArrowLeft size={14} aria-hidden="true" />{zh ? '返回' : 'Back'}</Button>
    </header>
    <div className="gitapp-settings-body">
      <nav className="gitapp-settings-tabs" aria-label={zh ? '设置分类' : 'Settings categories'}>
        <button type="button" aria-current={section === 'general' ? 'page' : undefined} onClick={() => onSectionChange('general')}>{zh ? '通用' : 'General'}</button>
        <button type="button" aria-current={section === 'models' ? 'page' : undefined} onClick={() => onSectionChange('models')}>{zh ? 'AI 模型' : 'AI models'}</button>
        <button type="button" aria-current={section === 'updates' ? 'page' : undefined} onClick={() => onSectionChange('updates')}>{zh ? '应用更新' : 'App updates'}</button>
      </nav>
      <div className="gitapp-settings-panel" key={section}>
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
        </section> : section === 'updates' ? <ApplicationUpdateSettings zh={zh} update={props.update} disabled={props.updateDisabled} /> : <ModelSettings embedded client={props.client} language={props.language} onClose={props.onClose} onChanged={props.onModelsChanged} />}
      </div>
    </div>
  </main>;
}
