import { appendFileSync } from 'node:fs';

const refName = process.env.GITHUB_REF_NAME;
if (!refName) {
  throw new Error('GITHUB_REF_NAME is not set');
}

const prefix = refName.includes('-rc') ? 'rc' : 'stable';
appendFileSync(process.env.GITHUB_OUTPUT, `prefix=${prefix}\n`);
console.log(`Uploading to s3://gitoza-releases/${prefix}/${refName}/`);
