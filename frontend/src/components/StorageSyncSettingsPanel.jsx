import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { isTauri } from "../utils/tauriEnv";
import { getInvokeErrorMessage } from "../utils/invokeError";
import {
  verifyAndResolveS3State,
  linkRepoToGlobalS3Profile,
  probeGlobalS3Onboarding,
} from "../services/api";
import { isStorageSyncConfigured } from "../utils/isStorageSyncConfigured";
import { normalizeProjectSyncConfig } from "../utils/normalizeProjectSyncConfig";
import { parseS3VerifyResponse } from "../utils/parseS3VerifyResponse";
import { INPUT_BASE_CLASS, SECONDARY_BUTTON_CLASS } from "../constants/uiRadius";

const inputCls = INPUT_BASE_CLASS;
const secondaryBtnCls = SECONDARY_BUTTON_CLASS;

const PROVIDERS = [
  { id: "unconfigured", label: "Unconfigured" },
  {
    id: "local_path",
    label: "Local Sync Folder (OneDrive / Dropbox / Google Drive)",
  },
  { id: "cloud_api", label: "Cloud Object Storage (S3-Compatible)" },
];

function providerFromConfig(cfg) {
  const normalized = normalizeProjectSyncConfig(cfg);
  const t = (normalized?.provider_type ?? "").trim().toLowerCase();
  if (t === "local_path" || t === "cloud_api") return t;
  return "unconfigured";
}

function providerLabel(providerId) {
  return PROVIDERS.find((p) => p.id === providerId)?.label ?? providerId;
}

function displayOptional(value) {
  const s = typeof value === "string" ? value.trim() : "";
  return s || "Not set";
}

/**
 * @param {{ label: string, value: string, mono?: boolean }} props
 */
function DashboardDetailRow({ label, value, mono = false }) {
  return (
    <div className="grid grid-cols-1 gap-1 border-b border-emerald-200/60 py-2.5 last:border-b-0 dark:border-emerald-800/40 sm:grid-cols-[minmax(0,11rem)_1fr] sm:gap-x-4">
      <dt className="text-xs font-semibold uppercase tracking-wide text-emerald-900/70 dark:text-emerald-200/70">
        {label}
      </dt>
      <dd
        className={`text-sm text-emerald-950 dark:text-emerald-50 ${mono ? "break-all font-mono" : ""}`}
      >
        {value}
      </dd>
    </div>
  );
}

/**
 * @param {{
 *   saved: ReturnType<typeof normalizeProjectSyncConfig>,
 *   credentialsConfigured: boolean,
 *   readOnly: boolean,
 *   formDisabled: boolean,
 *   success: boolean,
 *   onChangeSettings: () => void,
 * }} props
 */
function StorageSyncStatusDashboard({
  saved,
  credentialsConfigured,
  readOnly,
  formDisabled,
  success,
  onChangeSettings,
}) {
  const savedProvider = providerFromConfig(saved);
  const changeDisabled = readOnly || formDisabled;

  return (
    <div className="space-y-4">
      <div
        className="rounded-ui border border-emerald-200 bg-emerald-50 px-4 py-4 text-emerald-900 dark:border-emerald-800/80 dark:bg-emerald-950/40 dark:text-emerald-100"
        role="status"
        aria-live="polite"
      >
        <p className="text-sm font-semibold">🟢 Storage Sync Status: Active</p>

        <dl className="mt-4">
          <DashboardDetailRow label="Selected Provider" value={providerLabel(savedProvider)} />

          {savedProvider === "local_path" ? (
            <>
              <DashboardDetailRow
                label="Sync folder"
                value={displayOptional(saved?.local_assets_path)}
                mono
              />
              <p className="mt-4 rounded-ui border border-emerald-300/60 bg-white/50 px-3 py-2 text-xs leading-relaxed text-emerald-900 dark:border-emerald-700/50 dark:bg-emerald-950/30 dark:text-emerald-100">
                The local sync folder path is stored only on this device.
              </p>
            </>
          ) : null}

          {savedProvider === "cloud_api" ? (
            <>
              <DashboardDetailRow label="Bucket Name" value={displayOptional(saved?.s3_bucket)} />
              <DashboardDetailRow label="Region" value={displayOptional(saved?.s3_region)} />
              <DashboardDetailRow label="Prefix" value={displayOptional(saved?.s3_prefix)} />
              <DashboardDetailRow label="Endpoint URL" value={displayOptional(saved?.s3_endpoint)} />
            </>
          ) : null}
        </dl>

        {savedProvider === "cloud_api" ? (
          credentialsConfigured ? (
            <p className="mt-4 rounded-ui border border-emerald-300/60 bg-white/50 px-3 py-2 text-xs leading-relaxed text-emerald-900 dark:border-emerald-700/50 dark:bg-emerald-950/30 dark:text-emerald-100">
              Security credentials are stored in your system keychain (macOS Keychain, Windows
              Credential Manager, or Linux Secret Service).
            </p>
          ) : (
            <p className="mt-4 rounded-ui border border-amber-300/60 bg-amber-50/80 px-3 py-2 text-xs leading-relaxed text-amber-950 dark:border-amber-700/50 dark:bg-amber-950/30 dark:text-amber-100">
              AWS credentials are not saved on this device yet. Open Change Storage Settings to add
              access keys before cloud upload will work.
            </p>
          )
        ) : null}

      </div>

      {success ? (
        <p className="rounded-ui border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-200">
          Storage sync settings saved.
        </p>
      ) : null}

      <button
        type="button"
        onClick={onChangeSettings}
        disabled={changeDisabled}
        className="rounded-ui bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-40 dark:bg-indigo-500 dark:hover:bg-indigo-600"
      >
        Change Storage Settings
      </button>
    </div>
  );
}

function GlobalStorageOnboardingCard({
  globalBlueprint,
  linking,
  readOnly,
  onLink,
  onManualSetup,
}) {
  const bucket =
    globalBlueprint?.s3_bucket ?? globalBlueprint?.s3Bucket ?? "unknown";

  return (
    <div
      className="rounded-ui border border-indigo-200 bg-indigo-50 px-4 py-5 text-indigo-950 dark:border-indigo-800/80 dark:bg-indigo-950/40 dark:text-indigo-100"
      role="region"
      aria-labelledby="global-storage-onboarding-title"
    >
      <p id="global-storage-onboarding-title" className="text-sm leading-relaxed">
        Found an active global storage profile on this device (Bucket:{" "}
        <span className="font-mono font-semibold">{bucket}</span>).
      </p>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <button
          type="button"
          onClick={onLink}
          disabled={readOnly || linking}
          className="rounded-ui bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-40 dark:bg-indigo-500 dark:hover:bg-indigo-600"
        >
          {linking ? "Linking…" : "Link Repo to Global Storage Profile"}
        </button>
        <button
          type="button"
          onClick={onManualSetup}
          disabled={readOnly || linking}
          className={secondaryBtnCls}
        >
          Replace global profile and configure manually
        </button>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-indigo-900/80 dark:text-indigo-200/80">
        Linking copies the saved bucket layout into this repo only. Manual configuration
        opens the form; saving updates credentials in the system keychain and overwrites{" "}
        <code className="font-mono">global_s3_blueprint.json</code> on this device, then
        updates this repo&apos;s settings.
      </p>
    </div>
  );
}

function clearS3FormFields(setters) {
  setters.setS3Bucket("");
  setters.setS3Region("");
  setters.setS3Prefix("");
  setters.setS3Endpoint("");
  setters.setAccessKeyId("");
  setters.setSecretAccessKey("");
}

/** Placeholder while on-mount S3 verify runs (non-blocking; provider list stays below). */
function StorageSyncDashboardSkeleton() {
  return (
    <div
      className="animate-pulse rounded-ui border border-slate-200 bg-slate-50 px-4 py-4 dark:border-slate-700 dark:bg-slate-900/50"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="h-4 w-56 max-w-full rounded bg-slate-200 dark:bg-slate-700" />
      <div className="mt-4 space-y-3">
        <div className="h-3 w-full rounded bg-slate-200 dark:bg-slate-700" />
        <div className="h-3 w-11/12 rounded bg-slate-200 dark:bg-slate-700" />
        <div className="h-3 w-2/3 rounded bg-slate-200 dark:bg-slate-700" />
      </div>
      <p className="mt-4 text-sm text-slate-600 dark:text-slate-300">Verifying S3 connection…</p>
    </div>
  );
}

function cloudLayoutFingerprint(cfg) {
  const normalized = normalizeProjectSyncConfig(cfg);
  if (providerFromConfig(normalized) !== "cloud_api") return "";
  return [
    normalized?.s3_bucket ?? "",
    normalized?.s3_region ?? "",
    normalized?.s3_prefix ?? "",
    normalized?.s3_endpoint ?? "",
  ].join("|");
}

/**
 * @param {{
 *   repoSlug: string | null,
 *   readOnly?: boolean,
 *   config: object | null,
 *   onSave: (payload: object) => Promise<void>,
 *   onConfigUpdated?: (config: object) => void,
 * }} props
 */
export default function StorageSyncSettingsPanel({
  repoSlug,
  readOnly = false,
  config,
  onSave,
  onConfigUpdated,
}) {
  const [provider, setProvider] = useState("unconfigured");
  const [localPath, setLocalPath] = useState("");
  const [s3Bucket, setS3Bucket] = useState("");
  const [s3Region, setS3Region] = useState("");
  const [s3Prefix, setS3Prefix] = useState("");
  const [s3Endpoint, setS3Endpoint] = useState("");
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [s3BrokerStatus, setS3BrokerStatus] = useState("idle");
  const [s3ViewState, setS3ViewState] = useState(null);
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [probingGlobals, setProbingGlobals] = useState(false);
  const [linking, setLinking] = useState(false);
  const [s3Alert, setS3Alert] = useState(null);
  const [globalBlueprint, setGlobalBlueprint] = useState(null);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const credentialsInputRef = useRef(null);
  const verifyGenerationRef = useRef(0);

  const saved = normalizeProjectSyncConfig(config);
  const savedProvider = providerFromConfig(saved);
  const isConfigured = isStorageSyncConfigured(config);
  const localPathReady =
    savedProvider !== "local_path" || Boolean(saved?.local_assets_path?.trim());
  const cloudLayoutKey = useMemo(() => cloudLayoutFingerprint(config), [config]);

  const showActionLoadingOverlay = probingGlobals || verifying;

  const showBrokerChecking =
    s3BrokerStatus === "checking" &&
    savedProvider === "cloud_api" &&
    isConfigured &&
    !showActionLoadingOverlay;

  const showCloudDashboard =
    s3BrokerStatus === "active" &&
    s3ViewState === "dashboard" &&
    savedProvider === "cloud_api" &&
    !showActionLoadingOverlay &&
    !showBrokerChecking;

  const showLegacyDashboard =
    isConfigured && localPathReady && !isEditing && savedProvider !== "cloud_api";

  const showGlobalOnboarding =
    provider === "cloud_api" && s3ViewState === "card" && !probingGlobals;

  const showCloudForm =
    provider === "cloud_api" &&
    s3ViewState === "form" &&
    (s3BrokerStatus === "failed" ||
      s3BrokerStatus === "unconfigured" ||
      isEditing ||
      !isConfigured);

  const showSettingsForm =
    !showActionLoadingOverlay && !(showCloudDashboard || showLegacyDashboard);

  const applyConfigToForm = useCallback((raw, { clearMessages = true, clearSuccess = true } = {}) => {
    const normalized = normalizeProjectSyncConfig(raw);
    if (!normalized) return;
    setProvider(providerFromConfig(normalized));
    setLocalPath(normalized?.local_assets_path ?? "");
    setS3Bucket(normalized?.s3_bucket ?? "");
    setS3Region(normalized?.s3_region ?? "");
    setS3Prefix(normalized?.s3_prefix ?? "");
    setS3Endpoint(normalized?.s3_endpoint ?? "");
    setAccessKeyId("");
    setSecretAccessKey("");
    if (clearMessages) {
      setError(null);
      if (clearSuccess) setSuccess(false);
    }
  }, []);

  useEffect(() => {
    if (isEditing) return;
    applyConfigToForm(config, { clearSuccess: false });
  }, [config, applyConfigToForm, isEditing]);

  useEffect(() => {
    if (!repoSlug || readOnly) return;
    if (savedProvider === "local_path" && !localPathReady) {
      setIsEditing(true);
      setError("This repo uses Local Sync Folder. Choose your sync folder on this device.");
    }
  }, [repoSlug, readOnly, savedProvider, localPathReady]);

  const applyVerifyResult = useCallback(
    (result) => {
      const parsed = parseS3VerifyResponse(result);
      setGlobalBlueprint(parsed.globalBlueprint);

      if (parsed.status === "active" && parsed.config) {
        setS3BrokerStatus("active");
        setS3Alert(null);
        setIsEditing(false);
        setS3ViewState("dashboard");
        onConfigUpdated?.(parsed.config);
        applyConfigToForm(parsed.config, { clearMessages: true });
        return;
      }

      if (parsed.status === "expired_credentials") {
        setS3BrokerStatus("failed");
        setS3ViewState("form");
        setS3Alert({
          tone: "amber",
          message:
            parsed.message ||
            "Connection failed. Your global access keys may have expired. Please update credentials manually.",
        });
        if (parsed.config) {
          applyConfigToForm(parsed.config, { clearMessages: false });
        }
        setIsEditing(true);
        window.setTimeout(() => credentialsInputRef.current?.focus(), 0);
        return;
      }

      if (parsed.status === "bucket_mismatch") {
        setS3BrokerStatus("failed");
        setS3ViewState("form");
        setS3Alert({
          tone: "red",
          message:
            parsed.message ||
            "The repository S3 layout does not match this machine's saved global blueprint. Verify all fields and credentials before saving.",
        });
        if (parsed.config) {
          applyConfigToForm(parsed.config, { clearMessages: false });
        }
        setIsEditing(true);
        return;
      }

      if (parsed.status === "needs_setup") {
        setS3BrokerStatus("failed");
        setS3ViewState("form");
        setIsEditing(true);
        if (parsed.message) {
          setS3Alert({ tone: "amber", message: parsed.message });
        } else {
          setS3Alert({
            tone: "amber",
            message:
              "S3 connection could not be verified. Check bucket settings and credentials on this device.",
          });
        }
        if (parsed.config) {
          applyConfigToForm(parsed.config, { clearMessages: false });
        }
      }
    },
    [applyConfigToForm, onConfigUpdated],
  );

  const runS3Verify = useCallback(
    async ({ manageVerifyingState = true } = {}) => {
      if (!repoSlug || !isTauri()) return null;
      if (manageVerifyingState) {
        setVerifying(true);
      }
      setError(null);
      try {
        const raw = await verifyAndResolveS3State(repoSlug, { activate: false });
        applyVerifyResult(raw);
        return raw;
      } catch (err) {
        setS3BrokerStatus("failed");
        setS3ViewState("form");
        setIsEditing(true);
        setError(
          getInvokeErrorMessage(err, "Failed to verify S3 storage connection."),
        );
        return null;
      } finally {
        if (manageVerifyingState) {
          setVerifying(false);
        }
      }
    },
    [repoSlug, applyVerifyResult],
  );

  const triggerBrokerVerify = useCallback(async () => {
    if (!repoSlug || !isTauri() || savedProvider !== "cloud_api" || !isConfigured) {
      return null;
    }
    const gen = ++verifyGenerationRef.current;
    setS3BrokerStatus("checking");
    setS3ViewState(null);
    setError(null);
    try {
      const raw = await verifyAndResolveS3State(repoSlug, { activate: false });
      if (gen !== verifyGenerationRef.current) return null;
      applyVerifyResult(raw);
      return raw;
    } catch (err) {
      if (gen !== verifyGenerationRef.current) return null;
      setS3BrokerStatus("failed");
      setS3ViewState("form");
      setIsEditing(true);
      setError(
        getInvokeErrorMessage(err, "Failed to verify S3 storage connection."),
      );
      return null;
    }
  }, [repoSlug, savedProvider, isConfigured, applyVerifyResult]);

  useEffect(() => {
    if (isEditing) return;

    if (savedProvider !== "cloud_api") {
      setS3BrokerStatus("idle");
      setS3ViewState(null);
      return;
    }

    if (!isConfigured) {
      setS3BrokerStatus("unconfigured");
      setS3ViewState(null);
      return;
    }

    if (!repoSlug || !isTauri()) {
      setS3BrokerStatus("unconfigured");
      setS3ViewState("form");
      return;
    }

    const gen = ++verifyGenerationRef.current;
    setS3BrokerStatus("checking");
    setS3ViewState(null);

    let cancelled = false;
    (async () => {
      setError(null);
      try {
        const raw = await verifyAndResolveS3State(repoSlug, { activate: false });
        if (cancelled || gen !== verifyGenerationRef.current) return;
        applyVerifyResult(raw);
      } catch (err) {
        if (cancelled || gen !== verifyGenerationRef.current) return;
        setS3BrokerStatus("failed");
        setS3ViewState("form");
        setIsEditing(true);
        setError(
          getInvokeErrorMessage(err, "Failed to verify S3 storage connection."),
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    repoSlug,
    savedProvider,
    isConfigured,
    cloudLayoutKey,
    isEditing,
    applyVerifyResult,
  ]);

  const runGlobalProbe = useCallback(async () => {
    if (!isTauri()) {
      setS3BrokerStatus("unconfigured");
      setS3ViewState("form");
      return;
    }
    setProbingGlobals(true);
    setError(null);
    try {
      const raw = await probeGlobalS3Onboarding();
      const available = Boolean(raw?.available);
      const blueprint = raw?.global_blueprint ?? raw?.globalBlueprint ?? null;
      if (available && blueprint) {
        setGlobalBlueprint(blueprint);
        setS3BrokerStatus("unconfigured");
        setS3ViewState("card");
      } else {
        setGlobalBlueprint(null);
        setS3BrokerStatus("unconfigured");
        setS3ViewState("form");
        clearS3FormFields({
          setS3Bucket,
          setS3Region,
          setS3Prefix,
          setS3Endpoint,
          setAccessKeyId,
          setSecretAccessKey,
        });
      }
    } catch (err) {
      setGlobalBlueprint(null);
      setS3BrokerStatus("unconfigured");
      setS3ViewState("form");
      setError(
        getInvokeErrorMessage(err, "Failed to check for a global storage profile."),
      );
    } finally {
      setProbingGlobals(false);
    }
  }, []);

  const handleLinkGlobalProfile = useCallback(async () => {
    if (!repoSlug || !isTauri() || readOnly) return;
    setLinking(true);
    setError(null);
    setS3Alert(null);
    try {
      const raw = await linkRepoToGlobalS3Profile(repoSlug);
      applyVerifyResult(raw);
      const parsed = parseS3VerifyResponse(raw);
      if (parsed.status !== "active") {
        setS3BrokerStatus("failed");
        setS3ViewState("form");
        setIsEditing(true);
      }
    } catch (err) {
      setS3BrokerStatus("failed");
      setS3ViewState("form");
      setIsEditing(true);
      setError(
        getInvokeErrorMessage(err, "Failed to link repository to global storage profile."),
      );
    } finally {
      setLinking(false);
    }
  }, [repoSlug, readOnly, applyVerifyResult]);

  const handleChooseManualS3Setup = useCallback(() => {
    setS3BrokerStatus("unconfigured");
    setS3ViewState("form");
    setGlobalBlueprint(null);
    setS3Alert(null);
    clearS3FormFields({
      setS3Bucket,
      setS3Region,
      setS3Prefix,
      setS3Endpoint,
      setAccessKeyId,
      setSecretAccessKey,
    });
  }, []);

  const handleProviderChange = useCallback(
    (id) => {
      setProvider(id);
      setS3Alert(null);
      setGlobalBlueprint(null);

      if (id === "cloud_api") {
        if (savedProvider === "cloud_api" && isConfigured) {
          setIsEditing(false);
          void triggerBrokerVerify();
          return;
        }
        if (isTauri() && repoSlug) {
          runGlobalProbe();
        } else {
          setS3BrokerStatus("unconfigured");
          setS3ViewState("form");
        }
        return;
      }

      setS3BrokerStatus("idle");
      setS3ViewState(null);
    },
    [repoSlug, savedProvider, isConfigured, runGlobalProbe, triggerBrokerVerify],
  );

  const credentialsConfigured = Boolean(saved?.aws_credentials_configured);
  const formDisabled = readOnly || !repoSlug || saving;

  const handleBrowse = useCallback(async () => {
    if (!isTauri()) return;
    try {
      const selected = await open({
        directory: true,
        multiple: false,
      });
      const path = Array.isArray(selected) ? selected[0] : selected;
      if (typeof path === "string" && path.trim()) {
        setLocalPath(path.trim());
      }
    } catch (err) {
      setError(err?.message || String(err) || "Failed to open folder picker");
    }
  }, []);

  const handleEnterEditMode = useCallback(() => {
    applyConfigToForm(config);
    setS3Alert(null);
    setIsEditing(true);
    if (savedProvider === "cloud_api") {
      setS3ViewState("form");
    }
  }, [applyConfigToForm, config, savedProvider]);

  const handleCancel = useCallback(() => {
    applyConfigToForm(config);
    setS3Alert(null);
    setError(null);
    setIsEditing(false);
    if (savedProvider === "cloud_api" && isConfigured) {
      void triggerBrokerVerify();
    }
  }, [applyConfigToForm, config, savedProvider, isConfigured, triggerBrokerVerify]);

  const handleSave = useCallback(async () => {
    if (!repoSlug || !onSave) return;
    if (provider === "local_path" && !localPath.trim()) {
      setError("Choose a local assets folder before saving.");
      return;
    }
    setSaving(true);
    setError(null);
    setSuccess(false);
    setS3Alert(null);
    try {
      const providerType = provider === "unconfigured" ? "" : provider;
      const payload = {
        provider_type: providerType,
        local_assets_path:
          provider === "local_path" ? localPath.trim() || null : null,
        s3_bucket: provider === "cloud_api" ? s3Bucket.trim() || null : null,
        s3_region: provider === "cloud_api" ? s3Region.trim() || null : null,
        s3_prefix:
          provider === "cloud_api" && s3Prefix.trim() ? s3Prefix.trim() : null,
        s3_endpoint:
          provider === "cloud_api" && s3Endpoint.trim()
            ? s3Endpoint.trim()
            : null,
        access_key_id:
          provider === "cloud_api" && accessKeyId.trim()
            ? accessKeyId.trim()
            : null,
        secret_access_key:
          provider === "cloud_api" && secretAccessKey.trim()
            ? secretAccessKey.trim()
            : null,
      };
      if (provider === "cloud_api" && isTauri()) {
        setVerifying(true);
        try {
          await onSave(payload);
          setAccessKeyId("");
          setSecretAccessKey("");
          const raw = await runS3Verify({ manageVerifyingState: false });
          if (raw) {
            const parsed = parseS3VerifyResponse(raw);
            if (parsed.status === "active") {
              setSuccess(true);
              window.setTimeout(() => setSuccess(false), 3000);
            }
          }
        } finally {
          setVerifying(false);
        }
      } else {
        await onSave(payload);
        setAccessKeyId("");
        setSecretAccessKey("");
        setSuccess(true);
        setIsEditing(false);
        if (provider !== "cloud_api") {
          setS3ViewState(null);
          setGlobalBlueprint(null);
          setS3Alert(null);
        }
        window.setTimeout(() => setSuccess(false), 3000);
      }
    } catch (err) {
      setError(err?.message || String(err) || "Failed to save storage sync settings");
    } finally {
      setSaving(false);
    }
  }, [
    repoSlug,
    onSave,
    provider,
    localPath,
    s3Bucket,
    s3Region,
    s3Prefix,
    s3Endpoint,
    accessKeyId,
    secretAccessKey,
    runS3Verify,
  ]);

  if (!repoSlug) {
    return (
      <p className="rounded-ui border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-100/90">
        Connect a workspace to configure storage sync.
      </p>
    );
  }

  return (
    <div className="space-y-5 text-sm text-slate-700 dark:text-slate-300">
      <div>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Storage Sync</h2>
        <p className="mt-2 leading-relaxed">
          Team-visible settings are stored in{" "}
          <code className="rounded-ui bg-slate-200 px-1 py-0.5 text-xs dark:bg-slate-800">
            .gitoza/config.json
          </code>{" "}
          in your Git repository. Use <strong>Confirm Changes</strong> to share them. S3-compatible
          credentials are stored only on this device in the system keychain. Default bucket
          layout is saved under{" "}
          <code className="rounded-ui bg-slate-200 px-1 py-0.5 text-xs dark:bg-slate-800">
            ~/.gitoza/sync_secrets/global_s3_blueprint.json
          </code>
          .
        </p>
      </div>

      <div className="rounded-ui border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/40">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          Test Automation (CI JUnit)
        </h3>
        <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
          Upload JUnit XML from GitHub Actions or Azure Pipelines into the same storage bucket or
          shared folder. Use the path pattern{" "}
          <code className="rounded-ui bg-slate-200 px-1 py-0.5 text-xs dark:bg-slate-800">
            {"{repo_slug}/test_results/{pipeline}/{date}/{build_id}/junit.xml"}
          </code>
          . Optional{" "}
          <code className="rounded-ui bg-slate-200 px-1 py-0.5 text-xs dark:bg-slate-800">
            meta.json
          </code>{" "}
          can include branch, commit, and CI URL. Open the <strong>Test Automation</strong> view and
          click <strong>Refresh</strong> to index results. See{" "}
          <code className="rounded-ui bg-slate-200 px-1 py-0.5 text-xs dark:bg-slate-800">
            docs/arch/automation/README-ci-upload.md
          </code>{" "}
          in the repository for CI snippets.
        </p>
      </div>

      {showActionLoadingOverlay ? (
        <div
          className="flex flex-col items-center justify-center gap-3 rounded-ui border border-slate-200 bg-slate-50 px-6 py-12 dark:border-slate-700 dark:bg-slate-900/50"
          role="status"
          aria-live="polite"
        >
          <div
            className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent dark:border-indigo-400"
            aria-hidden
          />
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {probingGlobals
              ? "Checking for a global storage profile…"
              : "Verifying S3 connection…"}
          </p>
        </div>
      ) : null}

      {showBrokerChecking ? <StorageSyncDashboardSkeleton /> : null}

      {!showActionLoadingOverlay &&
      !showBrokerChecking &&
      (showCloudDashboard || showLegacyDashboard) ? (
        <StorageSyncStatusDashboard
          saved={saved}
          credentialsConfigured={credentialsConfigured}
          readOnly={readOnly}
          formDisabled={formDisabled}
          success={success}
          onChangeSettings={handleEnterEditMode}
        />
      ) : showSettingsForm ? (
        <>
          {s3BrokerStatus === "failed" && savedProvider === "cloud_api" ? (
            <p
              className="rounded-ui border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-800 dark:text-red-200"
              role="alert"
            >
              {s3Alert?.message ||
                error ||
                "S3 storage connection failed. Update credentials or bucket settings below."}
            </p>
          ) : null}
          <fieldset className="space-y-2" disabled={formDisabled}>
            <legend className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
              Provider
            </legend>
            {PROVIDERS.map(({ id, label }) => (
              <label
                key={id}
                className="flex cursor-pointer items-start gap-3 rounded-ui border border-slate-200 p-3 dark:border-slate-700"
              >
                <input
                  type="radio"
                  name="storage-provider"
                  className="mt-0.5 h-4 w-4 shrink-0"
                  checked={provider === id}
                  onChange={() => handleProviderChange(id)}
                />
                <span className="min-w-0 flex-1">{label}</span>
              </label>
            ))}
          </fieldset>

          {provider === "local_path" ? (
            <div className="space-y-2">
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
                Local assets folder
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  className={inputCls}
                  value={localPath}
                  onChange={(e) => setLocalPath(e.target.value)}
                  placeholder="/path/to/shared/assets"
                  disabled={formDisabled}
                />
                {isTauri() ? (
                  <button
                    type="button"
                    onClick={handleBrowse}
                    disabled={formDisabled}
                    className={`shrink-0 ${secondaryBtnCls}`}
                  >
                    Browse
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          {provider === "cloud_api" ? (
            showGlobalOnboarding ? (
              <GlobalStorageOnboardingCard
                globalBlueprint={globalBlueprint}
                linking={linking}
                readOnly={readOnly}
                onLink={handleLinkGlobalProfile}
                onManualSetup={handleChooseManualS3Setup}
              />
            ) : showCloudForm ? (
              <div className="space-y-4">
                {s3Alert ? (
                  <p
                    className={`rounded-ui border px-3 py-2 text-sm ${
                      s3Alert.tone === "red"
                        ? "border-red-500/30 bg-red-500/10 text-red-800 dark:text-red-200"
                        : "border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-100"
                    }`}
                    role="alert"
                  >
                    {s3Alert.message}
                  </p>
                ) : null}

                {globalBlueprint && s3Alert?.tone === "red" ? (
                  <div className="rounded-ui border border-amber-300/60 bg-amber-50/80 px-3 py-2 text-xs text-amber-950 dark:border-amber-700/50 dark:bg-amber-950/30 dark:text-amber-100">
                    <p className="font-semibold">Machine global blueprint</p>
                    <ul className="mt-1 list-inside list-disc font-mono">
                      <li>Bucket: {displayOptional(globalBlueprint.s3_bucket ?? globalBlueprint.s3Bucket)}</li>
                      <li>Region: {displayOptional(globalBlueprint.s3_region ?? globalBlueprint.s3Region)}</li>
                      <li>Prefix: {displayOptional(globalBlueprint.s3_prefix ?? globalBlueprint.s3Prefix)}</li>
                      <li>Endpoint: {displayOptional(globalBlueprint.s3_endpoint ?? globalBlueprint.s3Endpoint)}</li>
                    </ul>
                  </div>
                ) : null}

                <div className="space-y-2">
                  <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
                    S3 bucket
                  </label>
                  <input
                    type="text"
                    className={inputCls}
                    value={s3Bucket}
                    onChange={(e) => setS3Bucket(e.target.value)}
                    disabled={formDisabled}
                  />
                </div>
                <div className="space-y-2">
                  <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
                    S3 region
                  </label>
                  <input
                    type="text"
                    className={inputCls}
                    value={s3Region}
                    onChange={(e) => setS3Region(e.target.value)}
                    placeholder="eu-central-1"
                    disabled={formDisabled}
                  />
                </div>
                <div className="space-y-2">
                  <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
                    S3 prefix (optional)
                  </label>
                  <input
                    type="text"
                    className={inputCls}
                    value={s3Prefix}
                    onChange={(e) => setS3Prefix(e.target.value)}
                    placeholder="assets/"
                    disabled={formDisabled}
                  />
                </div>
                <div className="space-y-2">
                  <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
                    S3 endpoint URL (optional)
                  </label>
                  <input
                    type="text"
                    className={inputCls}
                    value={s3Endpoint}
                    onChange={(e) => setS3Endpoint(e.target.value)}
                    placeholder="e.g., https://<account_id>.r2.cloudflarestorage.com"
                    disabled={formDisabled}
                  />
                </div>
                <div className="rounded-ui border border-slate-200 p-3 dark:border-slate-700">
                  <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
                    Credentials are stored in your system keychain on this device only.
                    {credentialsConfigured
                      ? " Leave fields blank to keep existing keys."
                      : " Both fields are required on first save."}
                  </p>
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-slate-600 dark:text-slate-400">
                        Access key ID
                      </label>
                      <input
                        ref={credentialsInputRef}
                        type="password"
                        autoComplete="off"
                        className={inputCls}
                        value={accessKeyId}
                        onChange={(e) => setAccessKeyId(e.target.value)}
                        placeholder={
                          credentialsConfigured ? "Leave blank to keep existing" : "AKIA…"
                        }
                        disabled={formDisabled}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-slate-600 dark:text-slate-400">
                        Secret access key
                      </label>
                      <input
                        type="password"
                        autoComplete="off"
                        className={inputCls}
                        value={secretAccessKey}
                        onChange={(e) => setSecretAccessKey(e.target.value)}
                        placeholder={
                          credentialsConfigured ? "Leave blank to keep existing" : "••••••••"
                        }
                        disabled={formDisabled}
                      />
                    </div>
                  </div>
                </div>
              </div>
            ) : null
          ) : null}

          {error ? (
            <p className="rounded-ui border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-800 dark:text-red-200">
              {error}
            </p>
          ) : null}
          {success ? (
            <p className="rounded-ui border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-200">
              Storage sync settings saved.
            </p>
          ) : null}

          {!showGlobalOnboarding ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleSave}
                disabled={formDisabled || (provider === "cloud_api" && !showCloudForm)}
                className="rounded-ui bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-40 dark:bg-indigo-500 dark:hover:bg-indigo-600"
              >
                {saving ? "Saving…" : "Save Sync Settings"}
              </button>
              {isConfigured ? (
                <button
                  type="button"
                  onClick={handleCancel}
                  disabled={saving}
                  className={secondaryBtnCls}
                >
                  Cancel
                </button>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
