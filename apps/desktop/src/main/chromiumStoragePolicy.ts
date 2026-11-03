/**
 * 用户明确选择与 Astra/Zeus 相同的 macOS 浏览器存储策略。
 * 必须在 ready、Session 或窗口创建之前执行。仅影响 Chromium Safe Storage；
 * AI API 密钥继续由 git-server 的独立原生钥匙串保存。
 */
export function configureChromiumStorage(commandLine: { appendSwitch(name: string): void }, platform = process.platform): void {
  if (platform === 'darwin') commandLine.appendSwitch('use-mock-keychain');
}
