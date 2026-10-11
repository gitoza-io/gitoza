import { useCallback, useEffect, useState } from "react";
import { isTauri } from "../utils/tauriEnv.js";
import {
  checkForUpdatesManual,
  getLastUpdateResult,
  installPendingUpdate,
} from "../services/updater.js";
import { SUPPORT_URLS } from "../constants/supportLinks.js";

function formatVersionLabel(version) {
  if (!version) return "";
  const trimmed = String(version).trim();
  return trimmed.startsWith("v") || trimmed.startsWith("V") ? trimmed : `V${trimmed}`;
}

/**
 * Manual update check/install state for Settings → General.
 */
export function useAboutUpdates() {
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState(null);
  const [result, setResult] = useState(() => getLastUpdateResult());

  useEffect(() => {
    setResult(getLastUpdateResult());
  }, []);

  const handleCheck = useCallback(async () => {
    if (!isTauri() || checking) return;
    setChecking(true);
    setInstallError(null);
    try {
      const next = await checkForUpdatesManual();
      setResult(next);
    } finally {
      setChecking(false);
    }
  }, [checking]);

  const handleInstall = useCallback(async () => {
    if (result?.kind !== "available" || !result.update || installing) return;
    setInstalling(true);
    setInstallError(null);
    try {
      await installPendingUpdate(result.update);
    } catch (error) {
      setInstallError(error?.message || "Update installation failed.");
      setInstalling(false);
    }
  }, [result, installing]);

  const versionLabel = formatVersionLabel(result?.version);

  let statusMessage = "Check for the latest version.";
  if (!isTauri()) {
    statusMessage = "Updates are available in the desktop app.";
  } else if (checking) {
    statusMessage = "Checking for updates…";
  } else if (result?.kind === "none") {
    statusMessage = "You're up to date.";
  } else if (result?.kind === "available") {
    statusMessage = `${versionLabel} is available.`;
  } else if (result?.kind === "error") {
    statusMessage = result.error;
  }

  return {
    isTauriDesktop: isTauri(),
    checking,
    installing,
    installError,
    result,
    statusMessage,
    releaseNotesUrl: SUPPORT_URLS.changelog,
    handleCheck,
    handleInstall,
  };
}
