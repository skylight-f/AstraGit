// Extracted from Zeus for AstraGit on 2026-10-09; package scope and app identity adapted locally.
import { randomBytes } from 'node:crypto';

/** 生成与 nanoid 等长的 URL 安全随机标识。 */
export function randomId(length: number): string {
  return randomBytes(length).toString('base64url').slice(0, length);
}
