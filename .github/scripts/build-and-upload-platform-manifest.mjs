import { PutObjectCommand } from '@aws-sdk/client-s3';
import { createR2Client, parseS3Uri } from './r2-client.mjs';
import {
  buildPlatformManifest,
  getPlatformConfig,
} from './build-platform-release-manifest.mjs';

const assetsDir = process.argv[2];
const platform = process.argv[3];
const s3Uri = process.argv[4];

if (!assetsDir || !platform || !s3Uri) {
  throw new Error(
    'Usage: node build-and-upload-platform-manifest.mjs <assets-dir> <platform> <s3-prefix-uri>',
  );
}

const manifest = buildPlatformManifest(assetsDir, platform);
const { manifestName } = getPlatformConfig(platform);
const { bucket, keyPrefix } = parseS3Uri(s3Uri);
const key = `${keyPrefix}_meta/${manifestName}`;

const client = createR2Client();
await client.send(
  new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: JSON.stringify(manifest),
    ContentType: 'application/json',
  }),
);

console.log(`Uploaded ${manifestName} -> s3://${bucket}/${key}`);
