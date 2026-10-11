import { normalizeProjectSyncConfig } from "./normalizeProjectSyncConfig";

/**
 * True when `.gitoza/config.json` has a non-empty provider_type.
 * @param {object | null | undefined} cfg
 */
export function isStorageSyncConfigured(cfg) {
  const normalized = normalizeProjectSyncConfig(cfg);
  const provider = normalized?.provider_type?.trim().toLowerCase();
  if (!provider) return false;
  if (provider === "local_path") {
    return Boolean(normalized?.local_assets_path?.trim());
  }
  return true;
}
