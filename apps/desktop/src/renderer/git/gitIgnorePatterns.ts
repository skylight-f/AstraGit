export type GitIgnorePreset = 'paths' | 'names' | 'extensions' | 'directories' | 'custom';
const special = new Set(['\\', '*', '?', '[', ']', '#', '!', ' ']);
const escape = (value: string) => Array.from(value, character => special.has(character) ? `\\${character}` : character).join('');

/** Exact paths escape Git wildcards; presets remain visible and editable before saving. */
export function gitIgnorePatterns(paths: string[], preset: Exclude<GitIgnorePreset, 'custom'>, directory?: string): string[] | null {
  const targets = directory ? [directory.replace(/\/$/u, '') + '/'] : paths;
  if (targets.some(path => /[\0\r\n]/u.test(path))) return null;
  const patterns: string[] = [];
  for (const path of targets) {
    const clean = path.replace(/\/$/u, ''); const name = clean.split('/').at(-1)!;
    if (preset === 'paths') patterns.push('/' + escape(path));
    else if (preset === 'names') patterns.push(escape(name) + (path.endsWith('/') ? '/' : ''));
    else if (preset === 'directories') {
      const parent = path.endsWith('/') ? clean : clean.includes('/') ? clean.slice(0, clean.lastIndexOf('/')) : '';
      if (!parent) return null;
      patterns.push('/' + escape(parent) + '/');
    } else {
      const dot = name.lastIndexOf('.'); if (path.endsWith('/') || dot <= 0 || dot === name.length - 1) return null;
      patterns.push('*' + escape(name.slice(dot)));
    }
  }
  return [...new Set(patterns)];
}
