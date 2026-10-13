import { readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

export const ARTIFACT_PATTERNS = [
  /-setup\.exe$/i,
  /\.dmg$/i,
  /\.tar\.gz$/i,
  /\.AppImage$/i,
  /\.sig$/i,
];

export function getReleaseVersion(tag = process.env.GITHUB_REF_NAME) {
  if (!tag) {
    throw new Error('GITHUB_REF_NAME is not set');
  }
  return tag.replace(/^v/, '');
}

export function isReleaseArtifact(name) {
  return ARTIFACT_PATTERNS.some((pattern) => pattern.test(name));
}

export function matchesReleaseVersion(name, version) {
  return name.includes(`_${version}_`);
}

/** Tauri macOS updater bundles use ProductName.app.tar.gz (no version in the name). */
export function isMacUpdaterArtifact(name) {
  return /\.app\.tar\.gz(\.sig)?$/i.test(name);
}

export function parseMacInstallerArch(name) {
  const match = name.match(/_([a-z0-9-]+)\.dmg$/i);
  return match?.[1] ?? null;
}

export function canonicalMacUpdaterName(name, version, arch = 'aarch64') {
  const suffixMatch = name.match(/(\.app\.tar\.gz(?:\.sig)?)$/i);
  if (!suffixMatch) {
    throw new Error(`not a macOS updater artifact: ${name}`);
  }
  const productName = name.slice(0, -suffixMatch[1].length);
  return `${productName}_${version}_${arch}${suffixMatch[1]}`;
}

export function isMatchingReleaseArtifact(name, version) {
  return isReleaseArtifact(name) && matchesReleaseVersion(name, version);
}

export function collectFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    const fullPath = join(directory, entry);
    if (statSync(fullPath).isDirectory()) {
      files.push(...collectFiles(fullPath));
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

export function filterReleaseArtifacts(filePaths, version) {
  return filePaths.filter((filePath) =>
    isMatchingReleaseArtifact(basename(filePath), version),
  );
}

export function globPatternToRegExp(pattern) {
  return new RegExp(
    `^${pattern.replace(/\./g, '\\.').replace(/\*/g, '.*')}$`,
    'i',
  );
}

export function findVersionedArtifact(assetsDir, pattern, version) {
  const regex = globPatternToRegExp(pattern);
  const matches = collectFiles(assetsDir).filter((filePath) => {
    const name = basename(filePath);
    return regex.test(name) && matchesReleaseVersion(name, version);
  });

  if (matches.length === 0) {
    throw new Error(
      `missing artifact matching ${pattern} for version ${version} (under ${assetsDir})`,
    );
  }
  if (matches.length > 1) {
    const names = matches.map((filePath) => basename(filePath)).join(', ');
    throw new Error(
      `multiple artifacts matching ${pattern} for version ${version}: ${names}`,
    );
  }
  return matches[0];
}

export function validateReleaseAssetNames(names, version) {
  if (names.length === 0) {
    throw new Error('No release assets to validate');
  }

  const stale = names.filter((name) => !matchesReleaseVersion(name, version));
  if (stale.length > 0) {
    throw new Error(
      `release-assets contains files that do not match version ${version}: ${stale.join(', ')}`,
    );
  }
}

/**
 * End-user installers for GitHub Releases (not updater .app.tar.gz).
 * @param {string} name
 * @param {string} version
 */
export function isGitHubReleaseInstallerAsset(name, version) {
  if (!matchesReleaseVersion(name, version)) return false;
  if (/\.app\.tar\.gz(\.sig)?$/i.test(name)) return false;
  return (
    /-setup\.exe(\.sig)?$/i.test(name) ||
    /\.dmg(\.sig)?$/i.test(name) ||
    /\.AppImage(\.sig)?$/i.test(name)
  );
}

/** @param {string} name */
export function githubReleaseInstallerPlatformFamily(name) {
  if (/-setup\.exe(\.sig)?$/i.test(name)) return 'windows';
  if (/\.dmg(\.sig)?$/i.test(name)) return 'darwin';
  if (/\.AppImage(\.sig)?$/i.test(name)) return 'linux';
  return null;
}
