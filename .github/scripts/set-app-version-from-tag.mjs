import { readFileSync, writeFileSync } from 'node:fs';

const refName = process.env.GITHUB_REF_NAME;
if (!refName) {
  throw new Error('GITHUB_REF_NAME is not set');
}

const version = refName.replace(/^v/, '');
const channel = refName.includes('-rc') ? 'rc' : 'stable';
// Public update API host (not a GitHub secret — baked into release binaries).
const UPDATE_API_BASE = 'https://license-server-production-4ec4.up.railway.app';
const endpoint = `${UPDATE_API_BASE}/updates/${channel}/{{target}}/{{arch}}/{{current_version}}`;

console.log(`App version: ${version} (update channel: ${channel})`);

const configPath = 'src-tauri/tauri.conf.json';
const config = JSON.parse(readFileSync(configPath, 'utf8'));
config.version = version;

if (!config.plugins?.updater) {
  throw new Error('tauri.conf.json missing plugins.updater');
}
config.plugins.updater.endpoints = [endpoint];

writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

const written = JSON.parse(readFileSync(configPath, 'utf8'));
if (written.version !== version || written.plugins?.updater?.endpoints?.[0] !== endpoint) {
  throw new Error('Failed to write version/updater endpoints to tauri.conf.json');
}
