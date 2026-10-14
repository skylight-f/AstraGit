import { parseReleaseManifest } from '../packages/shared/src/releaseUpdate.ts';

export function renderHomebrewCask(value) {
  const manifest = parseReleaseManifest(value);
  const arm = manifest.artifacts.find(a => a.arch === 'arm64');
  const intel = manifest.artifacts.find(a => a.arch === 'x64');
  if (!arm || !intel) throw new Error('Homebrew 发布必须包含两个 Mac 架构。');
  return `cask "astragit" do
  arch arm: "arm64", intel: "x64"

  version "${manifest.version}"
  sha256 arm:   "${arm.sha256}",
         intel: "${intel.sha256}"

  url "https://github.com/skylight-f/AstraGit/releases/download/v#{version}/AstraGit-#{version}-#{arch}.dmg"
  name "AstraGit"
  desc "Git workbench with AI commit messages and multi-repository commits"
  homepage "https://github.com/skylight-f/AstraGit"

  depends_on macos: ">= ${manifest.minimumSystemVersion}"

  app "AstraGit.app"

  uninstall quit: "com.astragit.desktop"

  zap trash: [
    "~/Library/Application Support/AstraGit",
    "~/Library/Caches/com.astragit.desktop",
    "~/Library/Logs/AstraGit",
    "~/Library/Preferences/com.astragit.desktop.plist",
  ]
end
`;
}
