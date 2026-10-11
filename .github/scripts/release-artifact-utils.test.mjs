import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  canonicalMacUpdaterName,
  filterReleaseArtifacts,
  findVersionedArtifact,
  isMacUpdaterArtifact,
  isMatchingReleaseArtifact,
  matchesReleaseVersion,
  parseMacInstallerArch,
  validateReleaseAssetNames,
} from './release-artifact-utils.mjs';

describe('matchesReleaseVersion', () => {
  it('matches current tag version in artifact names', () => {
    assert.equal(
      matchesReleaseVersion('Gitoza_1.0.3-rc.2_x64-setup.exe', '1.0.3-rc.2'),
      true,
    );
    assert.equal(
      matchesReleaseVersion('Gitoza_1.0.0_x64-setup.exe', '1.0.0'),
      true,
    );
  });

  it('rejects stale artifact names', () => {
    assert.equal(
      matchesReleaseVersion('Gitoza_1.0.3-rc.1_x64-setup.exe', '1.0.3-rc.2'),
      false,
    );
  });
});

describe('isMatchingReleaseArtifact', () => {
  it('accepts release artifact patterns for the current version', () => {
    assert.equal(
      isMatchingReleaseArtifact('Gitoza_1.0.3-rc.2_x64-setup.exe', '1.0.3-rc.2'),
      true,
    );
    assert.equal(
      isMatchingReleaseArtifact('Gitoza_1.0.3-rc.2_amd64.AppImage', '1.0.3-rc.2'),
      true,
    );
  });

  it('rejects non-artifact files even when version matches', () => {
    assert.equal(
      isMatchingReleaseArtifact('Gitoza_1.0.3-rc.2_notes.txt', '1.0.3-rc.2'),
      false,
    );
  });
});

describe('filterReleaseArtifacts', () => {
  it('keeps only artifacts for the requested version', () => {
    const paths = [
      '/bundle/nsis/Gitoza_1.0.3-rc.1_x64-setup.exe',
      '/bundle/nsis/Gitoza_1.0.3-rc.2_x64-setup.exe',
      '/bundle/nsis/Gitoza_1.0.3-rc.2_x64-setup.exe.sig',
    ];

    const filtered = filterReleaseArtifacts(paths, '1.0.3-rc.2');
    assert.deepEqual(
      filtered.map((filePath) => filePath.split('/').pop()),
      ['Gitoza_1.0.3-rc.2_x64-setup.exe', 'Gitoza_1.0.3-rc.2_x64-setup.exe.sig'],
    );
  });
});

describe('validateReleaseAssetNames', () => {
  it('throws when stale files are present', () => {
    try {
      validateReleaseAssetNames(
        ['Gitoza_1.0.3-rc.1_x64-setup.exe', 'Gitoza_1.0.3-rc.2_x64-setup.exe'],
        '1.0.3-rc.2',
      );
      assert.fail('expected validateReleaseAssetNames to throw');
    } catch (error) {
      assert.match(String(error), /do not match version 1\.0\.3-rc\.2/);
    }
  });

  it('accepts a homogeneous version set', () => {
    assert.doesNotThrow(() =>
      validateReleaseAssetNames(
        ['Gitoza_1.0.3-rc.2_x64-setup.exe', 'Gitoza_1.0.3-rc.2_x64-setup.exe.sig'],
        '1.0.3-rc.2',
      ),
    );
  });
});

describe('macOS updater artifact naming', () => {
  it('detects Tauri updater bundle filenames', () => {
    assert.equal(isMacUpdaterArtifact('Gitoza.app.tar.gz'), true);
    assert.equal(isMacUpdaterArtifact('Gitoza.app.tar.gz.sig'), true);
    assert.equal(isMacUpdaterArtifact('Gitoza_1.0.3-rc.3_aarch64.dmg'), false);
  });

  it('renames unversioned updater bundles to canonical release names', () => {
    assert.equal(
      canonicalMacUpdaterName('Gitoza.app.tar.gz', '1.0.3-rc.3', 'aarch64'),
      'Gitoza_1.0.3-rc.3_aarch64.app.tar.gz',
    );
    assert.equal(
      canonicalMacUpdaterName('Gitoza.app.tar.gz.sig', '1.0.3-rc.3', 'aarch64'),
      'Gitoza_1.0.3-rc.3_aarch64.app.tar.gz.sig',
    );
  });

  it('parses arch from the staged dmg filename', () => {
    assert.equal(
      parseMacInstallerArch('Gitoza_1.0.3-rc.3_aarch64.dmg'),
      'aarch64',
    );
  });
});

describe('findVersionedArtifact', () => {
  it('returns the single matching artifact for a version', () => {
    const assetsDir = mkdtempSync(join(tmpdir(), 'gitoza-release-assets-'));
    writeFileSync(join(assetsDir, 'Gitoza_1.0.3-rc.1_x64-setup.exe'), 'old');
    writeFileSync(join(assetsDir, 'Gitoza_1.0.3-rc.2_x64-setup.exe'), 'new');

    const match = findVersionedArtifact(assetsDir, '*-setup.exe', '1.0.3-rc.2');
    assert.match(match, /Gitoza_1\.0\.3-rc\.2_x64-setup\.exe$/);
  });

  it('throws when no versioned artifact exists', () => {
    const assetsDir = mkdtempSync(join(tmpdir(), 'gitoza-release-assets-'));
    writeFileSync(join(assetsDir, 'Gitoza_1.0.3-rc.1_x64-setup.exe'), 'old');

    assert.throws(
      () => findVersionedArtifact(assetsDir, '*-setup.exe', '1.0.3-rc.2'),
      /missing artifact matching/,
    );
  });
});
