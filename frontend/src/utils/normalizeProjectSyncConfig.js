/**
 * Normalize sync config from Tauri IPC (snake_case or camelCase) to snake_case for the UI.
 * @param {object | null | undefined} raw
 * @returns {object | null}
 */
export function normalizeProjectSyncConfig(raw) {
  if (!raw || typeof raw !== "object") return null;
  const providerType = raw.provider_type ?? raw.providerType ?? "";
  return {
    provider_type: typeof providerType === "string" ? providerType : String(providerType ?? ""),
    local_assets_path: raw.local_assets_path ?? raw.localAssetsPath ?? null,
    s3_bucket: raw.s3_bucket ?? raw.s3Bucket ?? null,
    s3_region: raw.s3_region ?? raw.s3Region ?? null,
    s3_prefix: raw.s3_prefix ?? raw.s3Prefix ?? null,
    s3_endpoint: raw.s3_endpoint ?? raw.s3Endpoint ?? null,
    aws_credentials_configured: Boolean(
      raw.aws_credentials_configured ?? raw.awsCredentialsConfigured,
    ),
    credentials_storage: raw.credentials_storage ?? raw.credentialsStorage ?? null,
  };
}

/**
 * Build invoke payload for set_project_sync_config (camelCase + snake_case aliases on Rust).
 * @param {object} form
 */
export function toSetProjectSyncConfigPayload(form) {
  const providerType = form.provider_type ?? form.providerType ?? "";
  return {
    provider_type: providerType,
    providerType,
    local_assets_path: form.local_assets_path ?? form.localAssetsPath ?? null,
    localAssetsPath: form.local_assets_path ?? form.localAssetsPath ?? null,
    s3_bucket: form.s3_bucket ?? form.s3Bucket ?? null,
    s3Bucket: form.s3_bucket ?? form.s3Bucket ?? null,
    s3_region: form.s3_region ?? form.s3Region ?? null,
    s3Region: form.s3_region ?? form.s3Region ?? null,
    s3_prefix: form.s3_prefix ?? form.s3Prefix ?? null,
    s3Prefix: form.s3_prefix ?? form.s3Prefix ?? null,
    s3_endpoint: form.s3_endpoint ?? form.s3Endpoint ?? null,
    s3Endpoint: form.s3_endpoint ?? form.s3Endpoint ?? null,
    access_key_id: form.access_key_id ?? form.accessKeyId ?? null,
    accessKeyId: form.access_key_id ?? form.accessKeyId ?? null,
    secret_access_key: form.secret_access_key ?? form.secretAccessKey ?? null,
    secretAccessKey: form.secret_access_key ?? form.secretAccessKey ?? null,
  };
}
