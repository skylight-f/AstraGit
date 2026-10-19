import { homebrewCask, homebrewTap } from '@astragit/shared';

export const distributionAppName = 'AstraGit';
export const astragitHomebrewCask = homebrewCask;
export const astragitDistribution = { homebrewEnabled: true, homebrewTap, cask: 'astragit' } as const;
