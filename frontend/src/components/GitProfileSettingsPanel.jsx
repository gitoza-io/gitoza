import { useCallback, useEffect, useMemo, useState } from "react";
import { User } from "lucide-react";
import { getGitProfile, setGitProfile } from "../services/api";
import { getInvokeErrorMessage } from "../utils/invokeError";
import { INPUT_BASE_CLASS, SECONDARY_BUTTON_CLASS } from "../constants/uiRadius";

const inputCls = INPUT_BASE_CLASS;
const saveBtnCls = SECONDARY_BUTTON_CLASS;

function strField(value) {
  return (value ?? "").trim();
}

function mapProfileToForm(profile) {
  return {
    globalName: strField(profile?.global_user_name ?? profile?.globalUserName),
    globalEmail: strField(profile?.global_user_email ?? profile?.globalUserEmail),
    localName: strField(profile?.local_user_name ?? profile?.localUserName),
    localEmail: strField(profile?.local_user_email ?? profile?.localUserEmail),
    effectiveName: strField(profile?.effective_user_name ?? profile?.effectiveUserName),
    effectiveEmail: strField(profile?.effective_user_email ?? profile?.effectiveUserEmail),
  };
}

function IdentityFields({ name, email, onNameChange, onEmailChange, disabled, nameId, emailId }) {
  return (
    <>
      <label className="block" htmlFor={nameId}>
        <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted dark:text-slate-400">
          Display name
        </span>
        <input
          id={nameId}
          type="text"
          className={inputCls}
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          disabled={disabled}
          autoComplete="name"
          placeholder="Leave blank to unset"
        />
      </label>
      <label className="block" htmlFor={emailId}>
        <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted dark:text-slate-400">
          Email
        </span>
        <input
          id={emailId}
          type="email"
          className={inputCls}
          value={email}
          onChange={(e) => onEmailChange(e.target.value)}
          disabled={disabled}
          autoComplete="email"
          placeholder="Leave blank to unset"
        />
      </label>
    </>
  );
}

function EffectiveIdentityPreview({ workspace, name, email }) {
  const title = workspace ? "Active in this workspace" : "Your global identity";
  const subtitle = workspace
    ? "This is the name and email Git uses here — for commits, comments, and updated_by."
    : "Connect a workspace to see repository-specific overrides.";

  return (
    <div
      className="rounded-ui border border-slate-200 p-4 dark:border-slate-700"
      aria-live="polite"
    >
      <div className="flex items-start gap-3">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300"
          aria-hidden
        >
          <User className="h-4 w-4" strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {title}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted dark:text-slate-400">{subtitle}</p>
          <div className="mt-4 grid gap-3">
            <div>
              <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Display name
              </span>
              <p className="mt-1 text-base font-semibold leading-snug text-slate-900 dark:text-slate-100">
                {name || "—"}
              </p>
            </div>
            <div>
              <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Email
              </span>
              <p className="mt-1 break-all text-sm leading-snug text-slate-700 dark:text-slate-300">
                {email || "—"}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Settings panel for Git identity (global + repository scopes).
 *
 * @param {{ repoSlug: string | null, readOnly?: boolean, onProfileSaved?: () => void }} props
 */
function GitProfileSettingsPanel({ repoSlug, readOnly = false, onProfileSaved }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [profile, setProfile] = useState(null);
  const [globalName, setGlobalName] = useState("");
  const [globalEmail, setGlobalEmail] = useState("");
  const [localName, setLocalName] = useState("");
  const [localEmail, setLocalEmail] = useState("");

  const loadProfile = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const p = await getGitProfile(repoSlug);
      setProfile(p);
      const form = mapProfileToForm(p);
      setGlobalName(form.globalName);
      setGlobalEmail(form.globalEmail);
      setLocalName(form.localName);
      setLocalEmail(form.localEmail);
    } catch (err) {
      setError(getInvokeErrorMessage(err) || "Failed to load Git profile.");
    } finally {
      setLoading(false);
    }
  }, [repoSlug]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const initialForm = useMemo(() => mapProfileToForm(profile), [profile]);

  const effectiveName = repoSlug
    ? strField(profile?.effective_user_name ?? profile?.effectiveUserName)
    : initialForm.globalName;
  const effectiveEmail = repoSlug
    ? strField(profile?.effective_user_email ?? profile?.effectiveUserEmail)
    : initialForm.globalEmail;

  const unchanged =
    globalName.trim() === initialForm.globalName &&
    globalEmail.trim() === initialForm.globalEmail &&
    localName.trim() === initialForm.localName &&
    localEmail.trim() === initialForm.localEmail;

  const handleSave = async () => {
    setError("");
    setSuccess(false);
    setSaving(true);
    try {
      const updated = await setGitProfile({
        globalUserName: globalName.trim(),
        globalUserEmail: globalEmail.trim(),
        localUserName: localName.trim(),
        localUserEmail: localEmail.trim(),
        repo: repoSlug,
      });
      setProfile(updated);
      const form = mapProfileToForm(updated);
      setGlobalName(form.globalName);
      setGlobalEmail(form.globalEmail);
      setLocalName(form.localName);
      setLocalEmail(form.localEmail);
      setSuccess(true);
      onProfileSaved?.();
    } catch (err) {
      setError(getInvokeErrorMessage(err) || "Failed to save Git profile.");
    } finally {
      setSaving(false);
    }
  };

  const saveDisabled = readOnly || saving || loading || unchanged;
  const effectiveEmailMissing = !loading && !effectiveEmail;

  const clearSuccess = () => setSuccess(false);

  return (
    <div className="space-y-4 text-sm text-slate-700 dark:text-slate-300">
      <div>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Profile</h2>
        <p className="mt-2 leading-relaxed">
          Edit global and repository Git identity separately. Empty fields unset that value in the
          chosen scope. Repository values override global when set.
        </p>
      </div>

      {!loading ? (
        <EffectiveIdentityPreview
          workspace={Boolean(repoSlug)}
          name={effectiveName}
          email={effectiveEmail}
        />
      ) : null}

      {loading ? (
        <p className="text-muted dark:text-slate-400">Loading profile…</p>
      ) : (
        <>
          <div className="space-y-3 rounded-ui border border-slate-200 p-4 dark:border-slate-700">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Global identity
              </h3>
              <p className="mt-0.5 text-xs text-muted dark:text-slate-400">
                Machine-wide default (<code className="text-[11px]">~/.gitconfig</code>)
              </p>
            </div>
            <IdentityFields
              nameId="git-global-name"
              emailId="git-global-email"
              name={globalName}
              email={globalEmail}
              onNameChange={(v) => {
                setGlobalName(v);
                clearSuccess();
              }}
              onEmailChange={(v) => {
                setGlobalEmail(v);
                clearSuccess();
              }}
              disabled={readOnly || saving}
            />
          </div>

          {repoSlug ? (
            <div className="space-y-3 rounded-ui border border-slate-200 p-4 dark:border-slate-700">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Repository identity
                </h3>
                <p className="mt-0.5 text-xs text-muted dark:text-slate-400">
                  This workspace only (<code className="text-[11px]">.git/config</code>)
                </p>
              </div>
              <IdentityFields
                nameId="git-local-name"
                emailId="git-local-email"
                name={localName}
                email={localEmail}
                onNameChange={(v) => {
                  setLocalName(v);
                  clearSuccess();
                }}
                onEmailChange={(v) => {
                  setLocalEmail(v);
                  clearSuccess();
                }}
                disabled={readOnly || saving}
              />
            </div>
          ) : (
            <p className="text-xs text-muted dark:text-slate-400">
              Connect a workspace to edit repository identity.
            </p>
          )}

          <div className="flex justify-end">
            <button
              type="button"
              className={saveBtnCls}
              onClick={handleSave}
              disabled={saveDisabled}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>

          {effectiveEmailMissing ? (
            <p className="rounded-ui border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-100/90">
              No effective email is configured. Set a global or repository email so Confirm Changes
              can create commits linked to your account.
            </p>
          ) : null}
        </>
      )}

      {error ? (
        <p className="rounded-ui border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-800 dark:text-red-200">
          {error}
        </p>
      ) : null}

      {success ? (
        <p className="rounded-ui border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-900 dark:text-emerald-100">
          Git identity saved.
        </p>
      ) : null}
    </div>
  );
}

export default GitProfileSettingsPanel;
