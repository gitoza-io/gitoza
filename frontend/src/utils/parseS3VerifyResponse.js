import { normalizeProjectSyncConfig } from "./normalizeProjectSyncConfig";

/**
 * @param {unknown} raw
 * @returns {{
 *   status: string,
 *   config: ReturnType<typeof normalizeProjectSyncConfig> | null,
 *   autoConfigured: boolean,
 *   message: string | null,
 *   globalBlueprint: object | null,
 * }}
 */
export function parseS3VerifyResponse(raw) {
  if (!raw || typeof raw !== "object") {
    return {
      status: "needs_setup",
      config: null,
      autoConfigured: false,
      message: null,
      globalBlueprint: null,
    };
  }
  const status = typeof raw.status === "string" ? raw.status : "needs_setup";
  return {
    status,
    config: raw.config ? normalizeProjectSyncConfig(raw.config) : null,
    autoConfigured: Boolean(raw.auto_configured ?? raw.autoConfigured),
    message: typeof raw.message === "string" ? raw.message : null,
    globalBlueprint: raw.global_blueprint ?? raw.globalBlueprint ?? null,
  };
}
