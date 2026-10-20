import { useState } from 'react';
import type { DashboardClient } from './apiClient.js';
import type { AppLanguage, LanguagePreference } from './applicationPreferences.js';
import { ModelSettings } from './ModelSettings.js';
import { Button } from './ui/Button.js';
import { ModalPortal } from './ui/ModalPortal.js';
import { ApplicationUpdateSettings } from './ApplicationUpdateSettings.js';
import type { ApplicationUpdates } from './useApplicationUpdates.js';

export type SettingsSection = 'general' | 'models' | 'updates';

export function Settings(props: { client: DashboardClient; language: AppLanguage; languagePreference: LanguagePreference; onLanguageChange: (value: LanguagePreference) => void; onClose: () => void; onModelsChanged: () => void; initialSection?: SettingsSection; update: ApplicationUpdates; updateDisabled: boolean }) {
  const zh = props.language === 'zh-CN';
  const [section, setSection] = useState<SettingsSection>(props.initialSection ?? 'general');
  return <ModalPortal role="dialog" aria-label={zh ? '设置' : 'Settings'} rootClassName="gitapp-settings-root" onDismiss={props.onClose}>
    <div className="gitapp-settings-panel">
      <header className="gitapp-settings-header">
        <h2>{zh ? '设置' : 'Settings'}</h2>
        <Button onClick={props.onClose}>{zh ? '完成' : 'Done'}</Button>
      </header>
      <nav className="gitapp-settings-tabs" aria-label={zh ? '设置分类' : 'Settings categories'}>
        <button type="button" aria-pressed={section === 'general'} onClick={() => setSection('general')}>{zh ? '通用' : 'General'}</button>
        <button type="button" aria-pressed={section === 'models'} onClick={() => setSection('models')}>{zh ? 'AI 模型' : 'AI models'}</button>
        <button type="button" aria-pressed={section === 'updates'} onClick={() => setSection('updates')}>{zh ? '应用更新' : 'App updates'}</button>
      </nav>
      {section === 'general' ? <section className="gitapp-settings-section">
        <h3>{zh ? '语言' : 'Language'}</h3>
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
  </ModalPortal>;
}
