// Extracted from Zeus for AstraGit on 2026-10-09; package scope and app identity adapted locally.
/** 新安装与旧设置缺省时使用的任务分支命名空间。 */
export const defaultTaskBranchPrefix = 'astragit';

/**
 * 将用户输入规范为不带结尾斜杠的 Git 分支前缀。
 * 这里只接受会稳定生成合法完整分支名的结构，完整分支仍由 Git 自身最终校验。
 */
export function normalizeTaskBranchPrefix(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  /** 设置界面允许用户自然地输入结尾斜杠，持久层统一去除。 */
  const normalized = value.trim().replace(/\/+$/u, '');
  if (!normalized || normalized.length > 100 || normalized === '@' || normalized.startsWith('-') || normalized.startsWith('/') || normalized.includes('..') || normalized.includes('@{') || normalized.includes('//')) return null;
  /** Git 禁止控制字符、空格和这些引用语法字符出现在分支名中。 */
  const containsForbiddenCharacter = Array.from(normalized).some((character) => {
    /** 单字符码点用于覆盖 Git 禁止的 ASCII 控制范围。 */
    const code = character.charCodeAt(0);
    return code <= 32 || code === 127 || '~^:?*[\\'.includes(character);
  });
  if (containsForbiddenCharacter) return null;
  /** 每一段都必须能安全地作为 refs/heads 下的路径段。 */
  const segments = normalized.split('/');
  if (segments.some((segment) => !segment || segment.startsWith('.') || segment.endsWith('.') || segment.toLowerCase().endsWith('.lock'))) return null;
  return normalized;
}
