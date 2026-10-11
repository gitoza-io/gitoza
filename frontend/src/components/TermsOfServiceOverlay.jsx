import FramelessWindowChrome from "./FramelessWindowChrome";
import TermsParagraph from "../legal/TermsParagraph";
import { TERMS_OF_SERVICE_FOOTER, TERMS_OF_SERVICE_SECTIONS } from "../legal/terms.en";

function TermsOfServiceOverlay({
  versionLabel,
  onDecline,
  onAgree,
  declineDisabled = false,
  agreeDisabled = false,
  error = "",
}) {
  return (
    <div className="fixed inset-0 z-[9999] flex flex-col overflow-hidden bg-slate-50 text-slate-900">
      <FramelessWindowChrome />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-slate-50">
        <header
          className="shrink-0 border-b border-slate-200 bg-white px-8 py-5"
          aria-busy={versionLabel == null}
        >
          <p className="text-xs uppercase tracking-wide text-slate-500">Gitoza Terms of Service</p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900">Please review and accept to continue</h1>
          <p className="mt-2 text-sm text-slate-600">
            {versionLabel == null ? (
              <span className="inline-flex items-center gap-2 text-slate-400" aria-busy="true">
                <span
                  className="h-3 w-3 animate-spin rounded-full border-2 border-slate-400 border-t-transparent"
                  aria-hidden
                />
                <span>…</span>
              </span>
            ) : (
              versionLabel
            )}
          </p>
        </header>

        <section className="main-content-scroll min-h-0 flex-1 overflow-y-auto px-8 py-6">
          <div className="mx-auto w-full max-w-5xl space-y-6 text-sm leading-6 text-slate-700">
            {TERMS_OF_SERVICE_SECTIONS.map((section) => (
              <article key={section.title} className="space-y-2">
                <h2 className="text-base font-semibold text-slate-900">{section.title}</h2>
                {section.paragraphs.map((paragraph) => (
                  <TermsParagraph key={paragraph} text={paragraph} />
                ))}
              </article>
            ))}
            {TERMS_OF_SERVICE_FOOTER ? (
              <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                {TERMS_OF_SERVICE_FOOTER}
              </p>
            ) : null}
          </div>
        </section>

        <footer className="shrink-0 border-t border-slate-200 bg-white px-8 py-4">
          {error ? (
            <p className="mb-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          ) : null}
          <div className="mx-auto flex w-full max-w-5xl flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onDecline}
              disabled={declineDisabled}
              className="rounded border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Decline
            </button>
            <button
              type="button"
              onClick={onAgree}
              disabled={agreeDisabled}
              className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Agree & Continue
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

export default TermsOfServiceOverlay;
