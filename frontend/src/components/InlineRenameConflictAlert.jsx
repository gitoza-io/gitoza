/**
 * Inline alert shown below a rename input when the target name already exists.
 *
 * @param {object} props
 * @param {string} props.name - Conflicting file or folder name (shown bold in copy)
 */
export default function InlineRenameConflictAlert({ name }) {
  if (!name) return null;

  return (
    <div
      className="min-w-0 break-all rounded border border-red-300 bg-red-50 px-2 py-1.5 text-xs text-red-800 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300"
      role="alert"
    >
      A file or folder <strong className="font-semibold">{name}</strong> already exists at this
      location. Please choose a different name.
    </div>
  );
}
