/** Decode Git's C quoted paths without treating octal escapes as JSON escapes. */
export function decodeGitQuotedPath(raw: string): string | null {
  if (!raw.startsWith('"')) return raw;
  if (!raw.endsWith('"')) return null;
  const bytes: number[] = [];
  const escapes: Record<string, number> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, '\\': 92 };
  for (let index = 1; index < raw.length - 1;) {
    if (raw[index] !== '\\') {
      const character = String.fromCodePoint(raw.codePointAt(index)!);
      bytes.push(...Buffer.from(character)); index += character.length; continue;
    }
    const octal = /^[0-7]{1,3}/u.exec(raw.slice(index + 1));
    if (octal) { bytes.push(parseInt(octal[0], 8)); index += octal[0].length + 1; continue; }
    const escaped = escapes[raw[index + 1]!];
    if (escaped === undefined) return null;
    bytes.push(escaped); index += 2;
  }
  return Buffer.from(bytes).toString('utf8');
}
/** Encode repository paths for Git patch headers (JSON uses different control escapes). */
export function quoteGitPath(path: string): string {
  return JSON.stringify(path).replace(/\\u00([0-9a-f]{2})/giu, (_, hex: string) => `\\${parseInt(hex, 16).toString(8).padStart(3, '0')}`);
}
