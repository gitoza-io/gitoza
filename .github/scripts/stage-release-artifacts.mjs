import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import {
  canonicalMacUpdaterName,
  collectFiles,
  filterReleaseArtifacts,
  getReleaseVersion,
  isMacUpdaterArtifact,
  isReleaseArtifact,
  matchesReleaseVersion,
  parseMacInstallerArch,
} from './release-artifact-utils.mjs';

const bundleRoot = process.argv[2];
if (!bundleRoot) {
  throw new Error('Usage: node stage-release-artifacts.mjs <bundle_root>');
}

const version = getReleaseVersion();

function listArtifactCandidates(directory) {
  return collectFiles(directory).filter((filePath) =>
    isReleaseArtifact(basename(filePath)),
  );
}

// Self-hosted runners reuse the workspace; drop leftovers from prior tags.
rmSync('release-assets', { recursive: true, force: true });
mkdirSync('release-assets', { recursive: true });

const candidates = listArtifactCandidates(bundleRoot);
const stale = candidates.filter(
  (filePath) => !matchesReleaseVersion(basename(filePath), version),
);
const staged = filterReleaseArtifacts(candidates, version);

if (staged.length === 0) {
  throw new Error(
    `No release artifacts found for version ${version} under ${bundleRoot}`,
  );
}

for (const filePath of stale) {
  const name = basename(filePath);
  if (isMacUpdaterArtifact(name)) {
    console.log(`Deferred macOS updater artifact for rename: ${name}`);
  } else {
    console.log(`Skipped stale artifact: ${name}`);
  }
}

for (const filePath of staged) {
  copyFileSync(filePath, join('release-assets', basename(filePath)));
}

const stagedDmg = staged
  .map((filePath) => basename(filePath))
  .find((name) => name.toLowerCase().endsWith('.dmg'));
const macArch = (stagedDmg && parseMacInstallerArch(stagedDmg)) || 'aarch64';

const macUpdaters = candidates.filter((filePath) => {
  const name = basename(filePath);
  return isMacUpdaterArtifact(name) && !matchesReleaseVersion(name, version);
});

if (macUpdaters.length > 0) {
  const updaterNames = macUpdaters.map((filePath) => basename(filePath));
  const tarGz = updaterNames.filter((name) => /\.app\.tar\.gz$/i.test(name));
  const tarGzSig = updaterNames.filter((name) => /\.app\.tar\.gz\.sig$/i.test(name));

  if (tarGz.length !== 1 || tarGzSig.length !== 1) {
    throw new Error(
      `Expected one .app.tar.gz and one .app.tar.gz.sig for version ${version}, found: ${updaterNames.join(', ')}`,
    );
  }

  for (const filePath of macUpdaters) {
    const name = basename(filePath);
    const destName = canonicalMacUpdaterName(name, version, macArch);
    copyFileSync(filePath, join('release-assets', destName));
    console.log(`Staged macOS updater artifact (renamed): ${name} -> ${destName}`);
  }
}

console.log(`Staged artifacts for version ${version}:`);
for (const name of readdirSync('release-assets')) {
  console.log(`  ${name}`);
}
