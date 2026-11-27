// Extracted from Zeus for AstraGit on 2026-10-09; package scope and app identity adapted locally.
/** UI preflight for concrete branch names; Git remains the final authority. */
export function gitBranchNameIssue(value: string): 'required' | 'whitespace' | 'invalid' | null {
  const name = value.trim();
  if (!name) return 'required';
  if (Array.from(name).some(character => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127)) return 'whitespace';
  if (name === '@' || name.startsWith('-') || name.startsWith('/') || name.endsWith('/') || name.endsWith('.') || name.includes('..') || name.includes('@{') || name.includes('//') || Array.from(name).some(character => '~^:?*[\\'.includes(character))) return 'invalid';
  if (name.split('/').some(segment => segment.startsWith('.') || segment.endsWith('.lock'))) return 'invalid';
  return null;
}
