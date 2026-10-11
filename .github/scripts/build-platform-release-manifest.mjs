import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import {
  findVersionedArtifact,
} from './release-artifact-utils.mjs';

const PLATFORM_CONFIG = {
  windows: { target: 'windows', arch: 'x86_64', manifestName: 'windows.json' },
  macos: { target: 'darwin', arch: 'aarch64', manifestName: 'darwin.json' },
  linux: { target: 'linux', arch: 'x86_64', manifestName: 'linux.json' },
};

export function getReleaseContext(tag = process.env.GITHUB_REF_NAME) {
  if (!tag) {
    throw new Error('GITHUB_REF_NAME is not set');
  }

  const version = tag.replace(/^v/, '');
  const channel = tag.includes('-rc') ? 'rc' : 'stable';
  const prefix = `${channel}/${tag}`;

  return { tag, version, channel, prefix };
}

export function getPlatformConfig(platform) {
  const config = PLATFORM_CONFIG[platform];
  if (!config) {
    throw new Error(`Unsupported platform: ${platform} (expected windows, macos, or linux)`);
  }
  return config;
}

export const MANIFEST_FILENAMES = Object.values(PLATFORM_CONFIG).map(
  (config) => config.manifestName,
);

export function buildPlatformManifest(assetsDir, platform) {
  const { tag, version, channel, prefix } = getReleaseContext();
  const { target, arch } = getPlatformConfig(platform);

  let updaterBase;
  let installerBase;
  let signature;

  if (platform === 'windows') {
    // Gitoza_<version>_x64-setup.exe
    updaterBase = basename(findVersionedArtifact(assetsDir, '*-setup.exe', version));
    signature = readFileSync(
      findVersionedArtifact(assetsDir, '*-setup.exe.sig', version),
      'utf8',
    );
    installerBase = updaterBase;
  } else if (platform === 'macos') {
    // Gitoza_<version>_aarch64.app.tar.gz and Gitoza_<version>_aarch64.dmg
    updaterBase = basename(findVersionedArtifact(assetsDir, '*.app.tar.gz', version));
    signature = readFileSync(
      findVersionedArtifact(assetsDir, '*.app.tar.gz.sig', version),
      'utf8',
    );
    installerBase = basename(findVersionedArtifact(assetsDir, '*.dmg', version));
  } else if (platform === 'linux') {
    // Gitoza_<version>_amd64.AppImage
    updaterBase = basename(findVersionedArtifact(assetsDir, '*.AppImage', version));
    signature = readFileSync(
      findVersionedArtifact(assetsDir, '*.AppImage.sig', version),
      'utf8',
    );
    installerBase = updaterBase;
  } else {
    throw new Error(`Unsupported platform: ${platform}`);
  }

  return {
    tag,
    version,
    channel,
    target,
    arch,
    updater_r2_key: `${prefix}/${updaterBase}`,
    installer_r2_key: `${prefix}/${installerBase}`,
    signature,
  };
}

import { pathToFileURL } from 'node:url';

const isMainModule =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  const assetsDir = process.argv[2];
  const platform = process.argv[3];

  if (!assetsDir || !platform) {
    throw new Error(
      'Usage: node build-platform-release-manifest.mjs <assets-dir> <platform>',
    );
  }

  process.stdout.write(JSON.stringify(buildPlatformManifest(assetsDir, platform)));
}
