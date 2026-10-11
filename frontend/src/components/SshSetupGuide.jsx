import { CheckCircle2, Key } from "lucide-react";

const GIT_HOST_HINTS = `
GitHub: Settings → SSH and GPG keys → New SSH key → paste your public key.
GitLab: Preferences → SSH Keys → paste and add.
Bitbucket: Personal settings → SSH keys → Add key.
`.trim();

function isWindowsPlatform() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const platform = navigator.platform || "";
  return /Win/i.test(ua) || /Win/i.test(platform);
}

function WindowsSteps() {
  return (
    <ol className="list-decimal space-y-2 pl-5 text-xs text-slate-600 dark:text-slate-400">
      <li>
        Open <strong className="font-medium text-slate-700 dark:text-slate-300">PowerShell</strong> and run:{" "}
        <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-slate-800 dark:bg-slate-800 dark:text-slate-200">
          ssh-keygen -t ed25519
        </code>{" "}
        (press Enter for the default file location).
      </li>
      <li>
        Show your public key:{" "}
        <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-slate-800 dark:bg-slate-800 dark:text-slate-200">
          type %USERPROFILE%\.ssh\id_ed25519.pub
        </code>
      </li>
      <li>Copy the full line and add it to your Git server (see below).</li>
      <li>
        Optional test:{" "}
        <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-slate-800 dark:bg-slate-800 dark:text-slate-200">
          ssh -T git@github.com
        </code>
      </li>
    </ol>
  );
}

function UnixSteps() {
  return (
    <ol className="list-decimal space-y-2 pl-5 text-xs text-slate-600 dark:text-slate-400">
      <li>
        Open <strong className="font-medium text-slate-700 dark:text-slate-300">Terminal</strong> and run:{" "}
        <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-slate-800 dark:bg-slate-800 dark:text-slate-200">
          ssh-keygen -t ed25519
        </code>{" "}
        (press Enter for the default file location).
      </li>
      <li>
        Show your public key:{" "}
        <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-slate-800 dark:bg-slate-800 dark:text-slate-200">
          cat ~/.ssh/id_ed25519.pub
        </code>
      </li>
      <li>Copy the full line and add it to your Git server (see below).</li>
      <li>
        Optional test:{" "}
        <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-slate-800 dark:bg-slate-800 dark:text-slate-200">
          ssh -T git@github.com
        </code>
      </li>
    </ol>
  );
}

/**
 * OS-specific instructions for creating and registering an SSH key with a Git host.
 */
function SshSetupGuide({ systemKeyDetected }) {
  const isWindows = isWindowsPlatform();

  if (systemKeyDetected) {
    return (
      <div className="flex items-start gap-2 rounded border border-emerald-200 bg-emerald-50/80 px-3 py-2.5 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-100">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          Using your system SSH key ({isWindows ? "%USERPROFILE%\\.ssh" : "~/.ssh"}). The app uses the same key as
          Git on the command line.
        </span>
      </div>
    );
  }

  return (
    <div className="rounded border border-slate-200 bg-slate-50/50 p-4 dark:border-slate-700 dark:bg-slate-800/30">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300">
        <Key className="h-4 w-4" />
        Set up SSH before connecting
      </div>
      <p className="mb-3 text-xs text-slate-600 dark:text-slate-400">
        Create an SSH key outside this app ({isWindows ? "Windows" : "macOS / Linux"}), then add the public key to your
        Git server.
      </p>
      {isWindows ? <WindowsSteps /> : <UnixSteps />}
      <p className="mt-3 whitespace-pre-line text-xs text-slate-600 dark:text-slate-400">{GIT_HOST_HINTS}</p>
    </div>
  );
}

export default SshSetupGuide;
