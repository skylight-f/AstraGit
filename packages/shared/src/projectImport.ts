export interface ScannedGitProject {
  localPath: string;
  name: string;
  alreadyAdded: boolean;
}

export interface ProjectDirectoryScan {
  root: string;
  items: ScannedGitProject[];
  skipped: number;
}
