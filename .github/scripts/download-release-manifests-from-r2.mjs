import { GetObjectCommand } from '@aws-sdk/client-s3';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createR2Client, parseS3Uri } from './r2-client.mjs';
import { MANIFEST_FILENAMES } from './build-platform-release-manifest.mjs';

const outputDir = process.argv[2];
const s3Uri = process.argv[3];

if (!outputDir || !s3Uri) {
  throw new Error(
    'Usage: node download-release-manifests-from-r2.mjs <output-dir> <s3-prefix-uri>',
  );
}

const { bucket, keyPrefix } = parseS3Uri(s3Uri);
const client = createR2Client();

mkdirSync(outputDir, { recursive: true });

for (const manifestName of MANIFEST_FILENAMES) {
  const key = `${keyPrefix}_meta/${manifestName}`;
  let response;

  try {
    response = await client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      }),
    );
  } catch (error) {
    throw new Error(
      `Missing release manifest s3://${bucket}/${key}: ${error.message}`,
    );
  }

  const body = await response.Body.transformToString();
  writeFileSync(join(outputDir, manifestName), body);
  console.log(`Downloaded ${manifestName} <- s3://${bucket}/${key}`);
}
