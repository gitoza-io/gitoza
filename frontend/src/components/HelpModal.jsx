import { useEffect, useRef } from "react";
import { BookOpen, Bug, ExternalLink, Mail, MessagesSquare } from "lucide-react";

import { SUPPORT_URLS } from "../constants/supportLinks";
import { openExternalUrl } from "../utils/openExternalUrl";

/** Discord brand mark — lucide-react does not ship Discord in this version. */
function DiscordIcon({ className }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
    >
      <path d="M20.317 4.37a19.8 19.8 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.74 19.74 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.12-.09.246-.19.372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.548-13.66a.06.06 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}

const SUPPORT_ITEMS = [
  {
    id: "documentation",
    label: "Documentation",
    description: "Guides and reference for using Gitoza.",
    icon: BookOpen,
    url: SUPPORT_URLS.documentation,
  },
  {
    id: "discord",
    label: "Join Discord",
    description: "Chat with the community and get help in real time.",
    icon: DiscordIcon,
    url: SUPPORT_URLS.discord,
  },
  {
    id: "discussions",
    label: "Community Forum",
    description: "Ask questions and share ideas with other users.",
    icon: MessagesSquare,
    url: SUPPORT_URLS.discussions,
  },
  {
    id: "bug-report",
    label: "Report a Bug",
    description: "File an issue on GitHub with steps to reproduce.",
    icon: Bug,
    url: SUPPORT_URLS.bugReport,
  },
  {
    id: "contact",
    label: "Contact Support",
    description: "Billing, privacy, and account questions.",
    icon: Mail,
    url: SUPPORT_URLS.contactSupport,
  },
];

/**
 * Help & support overlay — external links open in the system browser or mail app.
 *
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {(message: string, opts?: { title?: string }) => void} [props.onOpenError]
 */
export default function HelpModal({ open, onClose, onOpenError }) {
  const closeRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose?.();
      }
    };
    document.addEventListener("keydown", onKey);
    queueMicrotask(() => closeRef.current?.focus());
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const handleOpenLink = (url) => {
    openExternalUrl(url).catch(() => {
      onOpenError?.("Could not open link.", { title: "Open link failed" });
    });
  };

  return (
    <div
      className="fixed inset-0 z-[220] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="help-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        className="w-full max-w-md animate-dropdown-enter rounded-ui border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-slate-200 px-6 py-4 dark:border-slate-700">
          <h2
            id="help-modal-title"
            className="text-lg font-semibold text-slate-900 dark:text-slate-100"
          >
            Help &amp; support
          </h2>
        </div>

        <div className="space-y-2 px-4 py-4">
          {SUPPORT_ITEMS.map(({ id, label, description, icon: Icon, url }) => (
            <button
              key={id}
              type="button"
              onClick={() => handleOpenLink(url)}
              className="flex w-full items-start gap-3 rounded-ui border border-transparent px-3 py-3 text-left transition hover:border-slate-200 hover:bg-list-hover dark:hover:border-slate-700 dark:hover:bg-slate-800/80"
            >
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-ui bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                <Icon className="h-4 w-4" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-sm font-medium text-ink dark:text-slate-100">
                  {label}
                  <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted dark:text-slate-500" aria-hidden />
                </span>
                <span className="mt-0.5 block text-sm leading-snug text-muted dark:text-slate-400">
                  {description}
                </span>
              </span>
            </button>
          ))}
        </div>

        <div className="border-t border-slate-200 px-6 py-4 dark:border-slate-700">
          <button
            type="button"
            ref={closeRef}
            onClick={onClose}
            className="w-full rounded-ui bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
