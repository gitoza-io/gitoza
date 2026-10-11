import { renderMarkdown } from "./TestCaseDetailModal";
import UpdatedByLine from "./UpdatedByLine";
import { MetadataFieldRead } from "./MetadataField";
import { getTagColorClass } from "../utils/tagColor";
import { formatWikiStatusLabel, wikiStatusValueClassName } from "../utils/wikiStatus";

/**
 * Read-only wiki page — title, page id, markdown body.
 */
function WikiDetailView({
  page,
  repoSlug = null,
  pageIdRowExtra = null,
  scrollEndContent = null,
  onOpenTicket = null,
  onOpenWikiPage = null,
}) {
  if (!page) return null;
  const title = page.title || page.page_id || "Untitled";
  const pageId = page.page_id || "—";
  const status = page.status ?? "draft";
  const tags = page.tags ?? [];

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <header className="shrink-0 border-b border-slate-200 px-3 py-3 dark:border-slate-700">
        <h2 className="text-lg font-bold leading-snug text-slate-900 dark:text-slate-100">
          {title}
        </h2>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <div className="flex items-center gap-0.5">
            <span className="font-mono text-sm font-normal tracking-wide text-slate-800 dark:text-slate-100">
              {pageId}
            </span>
            {pageIdRowExtra}
          </div>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain px-3 py-3">
        <div className="flex flex-wrap items-stretch gap-2">
          <MetadataFieldRead
            label="Status"
            value={formatWikiStatusLabel(status)}
            valueClassName={wikiStatusValueClassName(status)}
          />
          {tags.length > 0 ? (
            <MetadataFieldRead label="Tags">
              <div className="flex flex-wrap items-center gap-1">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${getTagColorClass(tag)}`}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </MetadataFieldRead>
          ) : null}
        </div>
        <div className="mt-2 border-t border-slate-200 pt-3 dark:border-slate-700">
          {page.body ? (
            <article className="prose-rex">
              {renderMarkdown(page.body, {
                repoSlug,
                enableWikiLinks: true,
                onWikiLinkClick: onOpenTicket,
                onWikiPageLinkClick: onOpenWikiPage,
              })}
            </article>
          ) : (
            <p className="py-4 text-center text-sm text-slate-400 dark:text-slate-500">
              No body content for this page.
            </p>
          )}
          {scrollEndContent}
        </div>
      </div>
      {(page.updated_at || page.updated_by) && (
        <footer className="shrink-0 border-t border-slate-200 px-2 py-1.5 dark:border-slate-700">
          <UpdatedByLine updatedAt={page.updated_at} updatedBy={page.updated_by} />
        </footer>
      )}
    </div>
  );
}

export default WikiDetailView;
