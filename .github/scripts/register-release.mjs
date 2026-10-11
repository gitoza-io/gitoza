import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const manifestsDir = 'manifests';
const tag = process.env.GITHUB_REF_NAME;
const webhookUrl = process.env.LICENSE_SERVER_RELEASE_WEBHOOK_URL;
const webhookSecret = process.env.LICENSE_SERVER_RELEASE_WEBHOOK_SECRET;

if (!tag || !webhookUrl || !webhookSecret) {
  throw new Error('GITHUB_REF_NAME, LICENSE_SERVER_RELEASE_WEBHOOK_URL, and LICENSE_SERVER_RELEASE_WEBHOOK_SECRET are required');
}

const payloadProcess = spawnSync(
  process.execPath,
  ['.github/scripts/build-release-webhook-payload.mjs', manifestsDir],
  { encoding: 'utf8' },
);

if (payloadProcess.status !== 0) {
  process.stderr.write(payloadProcess.stderr || 'Failed to build webhook payload\n');
  process.exit(payloadProcess.status ?? 1);
}

const payload = payloadProcess.stdout;
const payloadJson = JSON.parse(payload);
const platformList = payloadJson.platforms.map((platform) => platform.target).join(', ');

console.log(`Registering release ${tag} (channel in payload)`);
console.log(`Platforms in payload: ${platformList}`);

const responseFile = join(mkdtempSync(join(tmpdir(), 'gitoza-webhook-')), 'response.txt');
const curl = spawnSync(
  'curl',
  [
    '-sS',
    '-o',
    responseFile,
    '-w',
    '%{http_code}',
    '-X',
    'POST',
    webhookUrl,
    '-H',
    'Content-Type: application/json',
    '-H',
    `X-Gitoza-Release-Webhook-Secret: ${webhookSecret}`,
    '-d',
    payload,
  ],
  { encoding: 'utf8' },
);

if (curl.status !== 0) {
  process.stderr.write(curl.stderr || 'curl failed\n');
  process.exit(curl.status ?? 1);
}

const httpCode = Number(curl.stdout.trim());
if (httpCode < 200 || httpCode >= 300) {
  console.error(`Webhook failed with HTTP ${httpCode}`);
  console.error('Response body:');
  console.error(readFileSync(responseFile, 'utf8'));
  process.exit(1);
}

console.log(`Webhook succeeded (HTTP ${httpCode})`);
