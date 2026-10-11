import { useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Key,
  Link2,
  Loader2,
  Shield,
  Terminal,
  X,
} from "lucide-react";
import { GITOZA_WORK_BRANCH } from "../constants/git";
import { useGitConnect } from "../hooks/useGitConnect";
import { createPlayground } from "../services/api";
import OnboardingPageShell from "./OnboardingPageShell";
import SshSetupGuide from "./SshSetupGuide";

const HANDBOOK_SSH_URL = "git@github.com:gitoza-io/gitoza-handbook.git";
const HANDBOOK_HTTPS_URL = "https://github.com/gitoza-io/gitoza-handbook.git";

/**
 * @param {{
 *   onSuccess?: (slug?: string) => void,
 *   onClose?: () => void,
 *   variant?: "fullscreen" | "modal",
 * }} props
 */
function AddRepoWizard({ onSuccess, onClose, variant = "fullscreen" }) {
  const {
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
  } = useGitConnect({ onSuccess });

  const [playgroundLoading, setPlaygroundLoading] = useState(false);
  const [playgroundError, setPlaygroundError] = useState("");

  const handlePlayground = async () => {
    setPlaygroundError("");
    setError("");
    setPlaygroundLoading(true);
    try {
      const res = await createPlayground();
      onSuccess?.(res?.slug);
    } catch (err) {
      const message =
        err?.message || "Failed to create playground. Check that Git is installed.";
      setPlaygroundError(message);
    } finally {
      setPlaygroundLoading(false);
    }
  };

  const fillHandbookDemo = () => {
    setRemoteUrl(mode === "ssh" ? HANDBOOK_SSH_URL : HANDBOOK_HTTPS_URL);
    setError("");
    setPlaygroundError("");
  };

  const isModal = variant === "modal";
  const displayError = error || playgroundError;
  const handbookDemoControl = (
    <div className="mt-2">
      <button
        type="button"
        onClick={fillHandbookDemo}
        disabled={loading || playgroundLoading}
        className="text-sm text-blue-600 hover:underline disabled:opacity-50 dark:text-blue-400"
      >
        Use Gitoza handbook demo
      </button>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
        Official handbook sample. Public clone; read-only upstream — fork to customize.
      </p>
    </div>
  );
  const primaryBtnClass = (isLoading) =>
    `flex w-full items-center justify-center gap-2 rounded bg-blue-600 px-4 py-3 font-medium text-white transition hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 ${
      isLoading ? "cursor-wait" : "disabled:opacity-50"
    }`;
  const secondaryBtnClass = (isLoading) =>
    `flex w-full items-center justify-center gap-2 rounded border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-800 transition hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700 ${
      isLoading ? "cursor-wait" : "disabled:opacity-50"
    }`;

  const cardContent = (
    <div className="w-full max-w-lg rounded-ui border border-slate-200 bg-white p-8 shadow-lg dark:border-slate-700 dark:bg-slate-900/70">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="text-center md:text-left">
          <h1 id="add-repo-title" className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
            {isModal ? "Add New Workspace" : "Connect Repository"}
          </h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            Clone a remote Git repository. The app stores it locally for test case data. The work branch is{" "}
            <span className="font-mono text-slate-800 dark:text-slate-200">{GITOZA_WORK_BRANCH}</span> — it is
            created on the remote if it does not exist yet.
          </p>
        </div>
        {isModal && onClose && (
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-300"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      <div className="mb-6 flex rounded border border-slate-200 bg-slate-50 p-1 dark:border-slate-700 dark:bg-slate-800/50">
        <button
          type="button"
          onClick={() => setMode("ssh")}
          className={`flex flex-1 items-center justify-center gap-2 rounded-md py-2.5 text-sm font-medium transition ${
            mode === "ssh"
              ? "bg-white text-slate-900 shadow dark:bg-slate-700 dark:text-slate-100"
              : "text-slate-600 dark:text-slate-400"
          }`}
        >
          <Shield className="h-4 w-4" />
          SSH (Recommended)
        </button>
        <button
          type="button"
          onClick={() => setMode("https")}
          className={`flex flex-1 items-center justify-center gap-2 rounded-md py-2.5 text-sm font-medium transition ${
            mode === "https"
              ? "bg-white text-slate-900 shadow dark:bg-slate-700 dark:text-slate-100"
              : "text-slate-600 dark:text-slate-400"
          }`}
        >
          <Link2 className="h-4 w-4" />
          HTTPS / PAT
        </button>
      </div>

      {displayError && (
        <div className="mb-4 flex min-w-0 items-start gap-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1 break-all">{displayError}</span>
        </div>
      )}

      {mode === "ssh" ? (
        <div className="space-y-6">
          <SshSetupGuide systemKeyDetected={systemKeyDetected} />

          <div className="rounded border border-slate-200 bg-slate-50/50 p-4 dark:border-slate-700 dark:bg-slate-800/30">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-200 text-xs dark:bg-slate-600">
                1
              </span>
              Connect repository
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="ssh-url"
                  className="mb-1.5 flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300"
                >
                  <Terminal className="h-4 w-4" />
                  SSH URL
                </label>
                <input
                  id="ssh-url"
                  type="text"
                  value={remoteUrl}
                  onChange={(e) => setRemoteUrl(e.target.value)}
                  placeholder="git@github.com:owner/repo.git"
                  className="w-full rounded border border-slate-300 bg-white px-3 py-2.5 text-slate-900 placeholder-slate-400 outline-none ring-blue-400 transition focus:ring-2 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                  autoComplete="off"
                />
                {handbookDemoControl}
              </div>
              <button
                type="submit"
                disabled={loading || !canSubmitSsh}
                aria-busy={loading}
                className={primaryBtnClass(loading)}
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Cloning…
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4" />
                    {isModal ? "Add Workspace" : "Connect Repository"}
                  </>
                )}
              </button>
            </form>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label
              htmlFor="remote-url"
              className="mb-1.5 flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300"
            >
              <Link2 className="h-4 w-4" />
              Remote Git URL
            </label>
            <input
              id="remote-url"
              type="url"
              value={remoteUrl}
              onChange={(e) => setRemoteUrl(e.target.value)}
              placeholder="https://github.com/owner/repo.git"
              className="w-full rounded border border-slate-300 bg-slate-50 px-3 py-2.5 text-slate-900 placeholder-slate-400 outline-none ring-blue-400 transition focus:ring-2 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              autoComplete="url"
            />
            {handbookDemoControl}
          </div>
          <div>
            <label
              htmlFor="token"
              className="mb-1.5 flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300"
            >
              <Key className="h-4 w-4" />
              Personal Access Token (optional)
            </label>
            <input
              id="token"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Required for private repositories"
              className="w-full rounded border border-slate-300 bg-slate-50 px-3 py-2.5 text-slate-900 placeholder-slate-400 outline-none ring-blue-400 transition focus:ring-2 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              autoComplete="off"
            />
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              GitHub: Settings → Developer settings → Personal access tokens.
            </p>
          </div>
          <button
            type="submit"
            disabled={loading}
            aria-busy={loading}
            className={primaryBtnClass(loading)}
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Cloning…
              </>
            ) : (
              isModal ? "Add Workspace" : "Connect Repository"
            )}
          </button>
        </form>
      )}

      <div className="mt-8 border-t border-slate-200 pt-6 dark:border-slate-700">
        <p className="mb-3 text-center text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Or try without a remote
        </p>
        <button
          type="button"
          onClick={handlePlayground}
          disabled={loading || playgroundLoading}
          aria-busy={playgroundLoading}
          className={secondaryBtnClass(playgroundLoading)}
        >
          {playgroundLoading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Setting up playground…
            </>
          ) : (
            "Try playground — no remote repository"
          )}
        </button>
        <p className="mt-2 text-center text-xs text-slate-500 dark:text-slate-400">
          Local sandbox on this device. Connect a repository later to sync with your team.
        </p>
      </div>
    </div>
  );

  if (isModal) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-repo-title"
      >
        <div
          className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
          aria-hidden="true"
          onClick={onClose}
        />
        <div
          className="relative z-10 max-h-[90vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {cardContent}
        </div>
      </div>
    );
  }

  return (
    <OnboardingPageShell
      className="bg-slate-50 dark:bg-slate-950"
      contentClassName="px-4 py-8"
    >
      <div className="mx-auto w-full max-w-lg">{cardContent}</div>
    </OnboardingPageShell>
  );
}

export default AddRepoWizard;
