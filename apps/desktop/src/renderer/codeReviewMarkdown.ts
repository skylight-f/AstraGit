import type { GitCodeReviewReport } from './apiClient.js';

const escapeText = (value: string) => value.replace(/\r?\n/g, ' ').replace(/[\\`*_{}[\]()#+.!|>~-]/g, '\\$&');
const list = (items: string[]) => items.map(item => `- ${item.replace(/\r?\n/g, '\n  ')}`).join('\n');

export function formatCodeReviewMarkdown(report: GitCodeReviewReport, projectName: string, zh: boolean, { completed, stale }: { completed: boolean; stale: boolean }): string {
  const label = (cn: string, en: string) => zh ? cn : en;
  const severity = { high: label('高风险', 'High'), medium: label('中风险', 'Medium'), low: label('低风险', 'Low') };
  const sections = [
    `# ${label('代码评审', 'Code review')} · ${escapeText(projectName)}`,
    list([
      `${label('模型：', 'Model: ')}${escapeText(report.model)}`,
      `${label('评审时间：', 'Reviewed at: ')}${escapeText(new Date(report.reviewedAt).toLocaleString(zh ? 'zh-CN' : 'en-US'))}`,
      `${label('改动范围：', 'Changes: ')}${report.mode === 'staged' ? label('仅已暂存改动', 'Staged changes only') : label('全部工作区改动', 'All working tree changes')}`,
      `${label('文件数：', 'Files: ')}${report.fileCount}`,
      `${label('评审仓库：', 'Repositories: ')}${report.repositories.filter(repo => repo.fileCount).map(repo => escapeText(repo.relativePath === '.' ? repo.name : repo.relativePath)).join(', ')}`,
    ]),
  ];
  if (!completed) sections.push(`> ${label('评审未完成，以下仅为已收到的部分结果。', 'Review incomplete. Only the received partial results are shown below.')}`);
  if (stale) sections.push(`> ${label('代码已变化或暂时无法核对，以下为上次结果，请重新评审。', 'Code has changed or cannot be verified. Results below are from the previous review.')}`);
  if (report.summary) sections.push(`## ${label('改动概述', 'Summary')}\n\n${report.summary}`);
  if (completed || report.impacts.length) sections.push(`## ${label('修改影响', 'Impact')}\n\n${report.impacts.length ? list(report.impacts) : label('未提供额外影响分析。', 'No additional impact analysis provided.')}`);
  sections.push(`## ${label('潜在问题', 'Potential issues')} (${report.findings.length})\n\n${report.findings.length ? report.findings.map((finding, index) => {
    const repository = report.repositories.find(repo => repo.id === finding.repositoryId);
    const location = `${repository?.name ?? finding.repositoryId} / ${finding.path}${finding.line ? `:${finding.line}` : ''}`;
    return `### ${index + 1}. [${severity[finding.severity]}] ${escapeText(finding.title)}\n\n${label('位置：', 'Location: ')}${escapeText(location)}\n\n${finding.detail}\n\n**${label('建议：', 'Suggestion:')}** ${finding.suggestion}`;
  }).join('\n\n') : completed ? label('在提供的差异范围内未发现明确问题，仍需结合实际运行验证。', 'No definite issues found within the provided diff. Runtime verification is still needed.') : label('尚未收到完整问题，评审完成前不能据此判断没有问题。', 'No complete findings received yet. This does not indicate a clean review.')}`);
  if (completed || report.checks.length) sections.push(`## ${label('建议验证', 'Suggested checks')}\n\n${report.checks.length ? list(report.checks) : label('未提供额外验证建议。', 'No additional checks suggested.')}`);
  if (report.limitations.length) sections.push(`## ${label('评审范围说明', 'Review coverage')}\n\n${list(report.limitations)}`);
  return `${sections.join('\n\n')}\n`;
}
