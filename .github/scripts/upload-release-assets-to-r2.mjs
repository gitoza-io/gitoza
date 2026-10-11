import { PutObjectCommand } from '@aws-sdk/client-s3';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createR2Client, parseS3Uri } from './r2-client.mjs';
import {
  getReleaseVersion,
  validateReleaseAssetNames,
} from './release-artifact-utils.mjs';

const assetsDir = process.argv[2];
const s3Uri = process.argv[3];

if (!assetsDir || !s3Uri) {
  throw new Error('Usage: node upload-release-assets-to-r2.mjs <assets-dir> <s3-uri>');
}

const version = getReleaseVersion();
const files = readdirSync(assetsDir);
validateReleaseAssetNames(files, version);

const { bucket, keyPrefix } = parseS3Uri(s3Uri);
const client = createR2Client();

for (const name of files) {
  const key = `${keyPrefix}${name}`;
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: readFileSync(join(assetsDir, name)),
    }),
  );
  console.log(`Uploaded ${name} -> s3://${bucket}/${key}`);
}
