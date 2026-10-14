// Catalog fields and thinking-level selection adapted from pi-ai 0.87.1 (MIT).
// Copyright (c) 2025 Mario Zechner; see THIRD_PARTY_NOTICES.md.
export type CatalogThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface CatalogModel {
  id: string;
  name: string;
  reasoning: boolean;
  input: readonly string[];
  contextWindow: number;
  thinkingLevelMap?: Partial<Record<CatalogThinkingLevel, string | null>>;
  compat?: unknown;
}

const levels: CatalogThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

export function getSupportedThinkingLevels(model: CatalogModel): CatalogThinkingLevel[] {
  if (!model.reasoning) return ['off'];
  return levels.filter((level) => {
    const mapped = model.thinkingLevelMap?.[level];
    if (mapped === null) return false;
    if (level === 'xhigh' || level === 'max') return mapped !== undefined;
    return true;
  });
}
