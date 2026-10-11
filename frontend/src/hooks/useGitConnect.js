import { useEffect, useState } from "react";
import { connectRepo, getSshStatus } from "../services/api";
import { GITOZA_WORK_BRANCH } from "../constants/git";

/**
 * Encapsulates Git connection and authentication state and logic for the
 * Add Repository wizard (SSH/HTTPS toggle, clone).
 * Used by AddRepoWizard and can be reused in settings or other flows.
 *
 * @param {{ onSuccess?: (slug?: string) => void }} options - onSuccess called after a successful clone with the new workspace slug
 */
export function useGitConnect({ onSuccess } = {}) {
  const [mode, setMode] = useState("ssh");
  const [remoteUrl, setRemoteUrl] = useState("");
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [systemKeyDetected, setSystemKeyDetected] = useState(false);

  useEffect(() => {
    if (mode === "ssh") {
      getSshStatus()
        .then((d) => setSystemKeyDetected(Boolean(d.system_key_detected)))
        .catch(() => {});
    }
  }, [mode]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    const url = remoteUrl.trim();
    if (!url) {
      setError("Please enter the repository URL.");
      return;
    }
    if (mode === "ssh" && !url.startsWith("git@")) {
      setError("SSH URL must start with git@ (e.g. git@github.com:owner/repo.git)");
      return;
    }
    setLoading(true);
    try {
      const res = await connectRepo({
        connection_type: mode,
        remote_url: url,
        branch: GITOZA_WORK_BRANCH,
        personal_access_token: mode === "https" ? (token.trim() || null) : null,
      });
      onSuccess?.(res?.slug);
    } catch (err) {
      const message =
        err?.response?.data?.detail ||
        err?.message ||
        "Failed to connect. Check the URL and credentials.";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const canSubmitSsh = remoteUrl.trim().startsWith("git@");

  return {
    mode,
    setMode,
    remoteUrl,
    setRemoteUrl,
    token,
    setToken,
    loading,
    error,
    setError,
    systemKeyDetected,
    canSubmitSsh,
    handleSubmit,
  };
}
