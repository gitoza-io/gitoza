import { S3Client } from '@aws-sdk/client-s3';

export function parseS3Uri(s3Uri) {
  const match = /^s3:\/\/([^/]+)\/(.*)$/.exec(s3Uri);
  if (!match) {
    throw new Error(`Invalid S3 URI: ${s3Uri}`);
  }

  const [, bucket, prefix] = match;
  const keyPrefix = prefix.endsWith('/') ? prefix : `${prefix}/`;
  return { bucket, keyPrefix };
}

export function createR2Client() {
  const endpoint = process.env.R2_ENDPOINT_URL;
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error(
      'R2_ENDPOINT_URL, AWS_ACCESS_KEY_ID, and AWS_SECRET_ACCESS_KEY are required',
    );
  }

  return new S3Client({
    region: process.env.AWS_DEFAULT_REGION ?? 'auto',
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  });
}
