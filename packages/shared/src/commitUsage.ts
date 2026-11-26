export interface CommitGenerationUsage {
  providerId: string;
  providerName: string;
  modelId: string;
  modelName: string;
  totalTokens: number | null;
}

export interface CommitUsageRow extends Omit<CommitGenerationUsage, 'totalTokens'> {
  day: string;
  projectId: string;
  projectName: string;
  generations: number;
  reportedGenerations: number;
  totalTokens: number;
}

/** Bucket a generation by the local calendar day shown in the desktop app. */
export function commitUsageDay(date: Date): string {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}
