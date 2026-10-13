import assert from 'node:assert/strict';
import test from 'node:test';
import {
  githubReleaseInstallerPlatformFamily,
  isGitHubReleaseInstallerAsset,
} from './release-artifact-utils.mjs';

test('accepts versioned installers only (no sigs)', () => {
  const v = '2.0.0';
  assert.equal(isGitHubReleaseInstallerAsset(`Gitoza_${v}_x64-setup.exe`, v), true);
  assert.equal(isGitHubReleaseInstallerAsset(`Gitoza_${v}_aarch64.dmg`, v), true);
  assert.equal(isGitHubReleaseInstallerAsset(`Gitoza_${v}_amd64.AppImage`, v), true);
});

test('rejects sigs, updater bundles, wrong version, and unrelated files', () => {
  const v = '2.0.0';
  assert.equal(isGitHubReleaseInstallerAsset(`Gitoza_${v}_x64-setup.exe.sig`, v), false);
  assert.equal(isGitHubReleaseInstallerAsset(`Gitoza_${v}_amd64.AppImage.sig`, v), false);
  assert.equal(isGitHubReleaseInstallerAsset(`Gitoza_${v}_aarch64.app.tar.gz`, v), false);
  assert.equal(isGitHubReleaseInstallerAsset(`Gitoza_${v}_aarch64.app.tar.gz.sig`, v), false);
  assert.equal(isGitHubReleaseInstallerAsset('Gitoza_1.1.7_x64-setup.exe', v), false);
  assert.equal(isGitHubReleaseInstallerAsset('readme.txt', v), false);
});

test('platform family from installer names', () => {
  assert.equal(githubReleaseInstallerPlatformFamily('Gitoza_2.0.0_x64-setup.exe'), 'windows');
  assert.equal(githubReleaseInstallerPlatformFamily('Gitoza_2.0.0_aarch64.dmg'), 'darwin');
  assert.equal(githubReleaseInstallerPlatformFamily('Gitoza_2.0.0_amd64.AppImage'), 'linux');
  assert.equal(githubReleaseInstallerPlatformFamily('other.bin'), null);
});
