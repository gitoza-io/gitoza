import { useState } from "react";
import { Trash2 } from "lucide-react";
import Tooltip from "./Tooltip";

function formatTimestamp(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

/** @param {string} author */
/** @param {string} currentAuthor */
export function commentAuthorMatches(author, currentAuthor) {
  const me = (currentAuthor ?? "").trim();
  if (!me) return false;
  return (author ?? "").trim() === me;
}

/**
 * Minimal comment thread with post input.
 *
 * @param {{
 *   comments?: import("../types/comments.js").Comment[],
 *   currentAuthor?: string,
 *   onPost?: (text: string) => void | Promise<void>,
 *   onDelete?: (index: number) => void | Promise<void>,
 *   disabled?: boolean,
 *   posting?: boolean,
 * }} props
 */
function CommentStream({
  comments = [],
  currentAuthor = "",
  onPost,
  onDelete,
  disabled = false,
  posting = false,
}) {
  const canPost = typeof onPost === "function";
  const canDelete = typeof onDelete === "function" && !disabled;
  const [draft, setDraft] = useState("");
  const [deletingIndex, setDeletingIndex] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const text = draft.trim();
    if (!canPost || !text || disabled || posting) return;
    setDraft("");
    await onPost(text);
  };

  const handleDelete = async (index) => {
    if (!canDelete || deletingIndex != null || posting) return;
    setDeletingIndex(index);
    try {
      await onDelete(index);
    } finally {
      setDeletingIndex(null);
    }
  };

  const showPostForm = canPost;
  const showEmpty = comments.length === 0 && !showPostForm;

  if (showEmpty) return null;

  return (
    <section className="min-w-0 border-t border-slate-200 pt-6 dark:border-slate-700">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Comments
      </h3>
      {comments.length > 0 ? (
        <ul className="mb-3 space-y-2">
          {comments.map((c, i) => {
            const mine = commentAuthorMatches(c.author, currentAuthor);
            const showDelete = canDelete && mine;
            return (
              <li
                key={`${c.timestamp}-${i}`}
                className="min-w-0 rounded-md border border-slate-100 bg-slate-50/80 px-2.5 py-2 text-sm dark:border-slate-700/80 dark:bg-slate-800/50"
              >
                <div className="mb-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                  <span className="min-w-0 flex-1 font-medium text-slate-700 dark:text-slate-300">
                    {c.author || "Unknown"}
                  </span>
                  <time dateTime={c.timestamp}>{formatTimestamp(c.timestamp)}</time>
                  {showDelete ? (
                    <Tooltip label="Delete comment" placement="top">
                      <button
                        type="button"
                        onClick={() => handleDelete(i)}
                        disabled={deletingIndex != null || posting}
                        className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-red-600 disabled:opacity-50 dark:hover:bg-slate-700 dark:hover:text-red-400"
                        aria-label="Delete comment"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </Tooltip>
                  ) : null}
                </div>
                <p className="whitespace-pre-wrap break-words text-slate-800 dark:text-slate-200">{c.text}</p>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mb-3 text-xs text-slate-400 dark:text-slate-500">No comments yet.</p>
      )}
      {showPostForm ? (
        <form onSubmit={handleSubmit} className="flex flex-col gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Write a comment…"
            rows={2}
            disabled={disabled || posting}
            className="w-full resize-y overflow-x-hidden rounded border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-900 outline-none ring-indigo-400 placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
            aria-label="Comment text"
          />
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={disabled || posting || !draft.trim()}
              className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {posting ? "Posting…" : "Post Comment"}
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

export default CommentStream;
