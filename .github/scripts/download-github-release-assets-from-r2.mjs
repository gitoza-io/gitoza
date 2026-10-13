import { GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { createWriteStream, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createR2Client, parseS3Uri } from './r2-client.mjs';
import {
  getReleaseVersion,
  githubReleaseInstallerPlatformFamily,
  isGitHubReleaseInstallerAsset,
} from './release-artifact-utils.mjs';

const outputDir = process.argv[2];
const s3Uri = process.argv[3];

if (!outputDir || !s3Uri) {
  throw new Error(
    'Usage: node download-github-release-assets-from-r2.mjs <output-dir> <s3-prefix-uri>',
  );
}

const version = getReleaseVersion();
const { bucket, keyPrefix } = parseS3Uri(s3Uri);
const client = createR2Client();

mkdirSync(outputDir, { recursive: true });

/** @type {string[]} */
const keys = [];
let continuationToken;

do {
  const listed = await client.send(
    new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: keyPrefix,
      ContinuationToken: continuationToken,
    }),
  );

  for (const object of listed.Contents ?? []) {
    const key = object.Key;
    if (!key || key.endsWith('/')) continue;
    if (key.includes('/_meta/') || key.startsWith(`${keyPrefix}_meta/`)) {
      continue;
    }
    const name = basename(key);
    if (isGitHubReleaseInstallerAsset(name, version)) {
      keys.push(key);
    }
  }

  continuationToken = listed.IsTruncated
    ? listed.NextContinuationToken
    : undefined;
} while (continuationToken);

if (keys.length === 0) {
  throw new Error(
    `No GitHub Release installers found for version ${version} under s3://${bucket}/${keyPrefix}`,
  );
}

const families = new Set();
for (const key of keys) {
  const name = basename(key);
  const family = githubReleaseInstallerPlatformFamily(name);
  if (family) families.add(family);

  const dest = join(outputDir, name);
  const response = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
  );
  if (!response.Body) {
    throw new Error(`Empty body for s3://${bucket}/${key}`);
  }
  await pipeline(response.Body, createWriteStream(dest));
  console.log(`Downloaded ${name} <- s3://${bucket}/${key}`);
}

for (const required of ['windows', 'darwin', 'linux']) {
  if (!families.has(required)) {
    throw new Error(
      `Missing ${required} installer for version ${version} under s3://${bucket}/${keyPrefix} (found: ${[...families].join(', ') || 'none'})`,
    );
  }
}

console.log(
  `GitHub Release assets ready (${keys.length} files): ${keys.map((k) => basename(k)).join(', ')}`,
);
