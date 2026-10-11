import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MANIFEST_FILENAMES } from './build-platform-release-manifest.mjs';

const manifestsDir = process.argv[2];
if (!manifestsDir) {
  throw new Error('Usage: node build-release-webhook-payload.mjs <manifests-dir>');
}

const manifests = MANIFEST_FILENAMES.map((filename) => {
  const filePath = join(manifestsDir, filename);
  let raw;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch {
    throw new Error(`missing manifest: ${filename} (under ${manifestsDir})`);
  }
  return JSON.parse(raw);
});

const [{ tag, version, channel }] = manifests;

for (const manifest of manifests.slice(1)) {
  if (manifest.tag !== tag || manifest.version !== version || manifest.channel !== channel) {
    throw new Error(
      `manifest mismatch: expected tag=${tag} version=${version} channel=${channel}, got tag=${manifest.tag} version=${manifest.version} channel=${manifest.channel}`,
    );
  }
}

const payload = {
  tag,
  version,
  channel,
  platforms: manifests.map(({ target, arch, updater_r2_key, installer_r2_key, signature }) => ({
    target,
    arch,
    updater_r2_key,
    signature,
    installer_r2_key,
  })),
};

process.stdout.write(JSON.stringify(payload));
