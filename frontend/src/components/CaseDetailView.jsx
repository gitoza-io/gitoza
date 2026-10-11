import { renderMarkdown, priorityColors } from "./TestCaseDetailModal";
import ApproveStatusBadge from "./ApproveStatusBadge";
import AddedByLine from "./AddedByLine";
import ExecutedByLine from "./ExecutedByLine";
import UpdatedByLine from "./UpdatedByLine";
import AssigneeInput from "./AssigneeInput";
import { getTagColorClass } from "../utils/tagColor";
import { isCaseArchived } from "../utils/caseArchived";
import { CustomFieldRead, sortCustomFieldEntries } from "./CaseCustomFields";
import { MetadataFieldEdit, MetadataFieldRead } from "./MetadataField";
import TicketIdChip from "./TicketIdChip";
import { normalizeRequirementIds } from "../utils/requirementIds";

function capitalize(str) {
  if (!str) return "";
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Read-only case detail content (no modal). Used in the fixed right panel.
 *
 * @param {{
 *   testCase: object,
 *   caseIdRowExtra?: import("react").ReactNode,
 *   runCaseFooter?: { kind: "added" | "executed"; by?: string | null; at?: string | null } | null,
 *   scrollEndContent?: import("react").ReactNode,
 *   repoSlug?: string | null,
 *   onOpenTicket?: ((row: object) => void) | null,
 *   onOpenWikiPage?: ((row: object) => void) | null,
 *   runAssignee?: {
 *     value: string,
 *     editable: boolean,
 *     onChange?: (v: string) => void,
 *     suggestions?: string[],
 *     showClear?: boolean,
 *     onClear?: () => void,
 *     onBlur?: () => void,
 *     clearVariant?: "clear" | "reset",
 *     clearLabel?: string,
 *     specialOptions?: { value: string, label?: string }[],
 *     error?: string,
 *   },
 *   suppressRepoAssignedTo?: boolean,
 * }} props
 */
function CaseDetailView({
  testCase,
  caseIdRowExtra = null,
  runCaseFooter = null,
  scrollEndContent = null,
  repoSlug = null,
  reviewEnabled = true,
  runAssignee = null,
  suppressRepoAssignedTo = false,
  onOpenTicket = null,
  onOpenWikiPage = null,
}) {
  if (!testCase) return null;

  const tags = testCase.tags ?? [];
  const requirementIds = normalizeRequirementIds(testCase);
  const customFieldEntries = sortCustomFieldEntries(testCase.params);
  const priorityKey = (testCase.priority || "").toLowerCase();
  const showArchivedBadge = isCaseArchived({
    status: testCase.status,
    file_path: testCase.file_path,
  });

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <header className="shrink-0 border-b border-slate-200 px-3 py-3 dark:border-slate-700">
        <h2 className="text-lg font-bold leading-snug text-slate-900 dark:text-slate-100">
          {testCase.title || "Untitled Test Case"}
        </h2>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <span className="font-mono text-sm font-normal tracking-wide text-slate-800 dark:text-slate-100">
            {testCase.case_id || "—"}
          </span>
          {showArchivedBadge ? (
            <span
              className="shrink-0 rounded-ui bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:bg-amber-900/50 dark:text-amber-200"
              aria-label="Archived"
            >
              Archived
            </span>
          ) : null}
          <ApproveStatusBadge status={testCase.approve_status} reviewEnabled={reviewEnabled} />
          {caseIdRowExtra}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain px-3 py-3">
        <div className="flex flex-wrap items-stretch gap-2">
          {testCase.priority ? (
            <MetadataFieldRead
              label="Priority"
              value={capitalize(testCase.priority)}
              valueClassName={priorityColors[priorityKey] || "text-slate-900 dark:text-slate-100"}
            />
          ) : null}
          {requirementIds.length > 0 ? (
            <MetadataFieldRead label="Requirement">
              <div className="flex flex-wrap items-center gap-1">
                {requirementIds.map((id) => (
                  <TicketIdChip
                    key={id}
                    ticketId={id}
                    repoSlug={repoSlug}
                    onOpenTicket={onOpenTicket}
                    showLabel={false}
                  />
                ))}
              </div>
            </MetadataFieldRead>
          ) : null}
          {testCase.automated ? (
            <MetadataFieldRead label="Automated" value="Yes" />
          ) : null}
          {!suppressRepoAssignedTo && testCase.assigned_to ? (
            <MetadataFieldRead label="Assigned to" value={testCase.assigned_to} />
          ) : null}
          {runAssignee ? (
            runAssignee.editable ? (
              <MetadataFieldEdit label="Assigned to">
                <div className="w-full min-w-0">
                  <AssigneeInput
                    value={runAssignee.value}
                    onChange={runAssignee.onChange}
                    onClear={runAssignee.onClear}
                    onBlur={runAssignee.onBlur}
                    suggestions={runAssignee.suggestions ?? []}
                    specialOptions={runAssignee.specialOptions ?? []}
                    showClear={runAssignee.showClear}
                    clearVariant={runAssignee.clearVariant}
                    clearLabel={runAssignee.clearLabel}
                    placeholder="—"
                    className="w-full"
                  />
                  {runAssignee.error ? (
                    <p className="mt-0.5 text-[10px] text-red-600 dark:text-red-400">{runAssignee.error}</p>
                  ) : null}
                </div>
              </MetadataFieldEdit>
            ) : runAssignee.value ? (
              <MetadataFieldRead label="Assigned to" value={runAssignee.value} />
            ) : null
          ) : null}
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
          {customFieldEntries.map(([key, val]) => (
            <CustomFieldRead key={key} fieldKey={key} value={val} />
          ))}
        </div>
        <div className="mt-2 border-t border-slate-200 pt-3 dark:border-slate-700">
          {testCase.body ? (
            <article className="prose-rex">
              {renderMarkdown(testCase.body, {
                repoSlug,
                enableWikiLinks: true,
                onWikiLinkClick: onOpenTicket,
                onWikiPageLinkClick: onOpenWikiPage,
              })}
            </article>
          ) : (
            <p className="py-4 text-center text-sm text-slate-400 dark:text-slate-500">
              No body content for this test case.
            </p>
          )}
          {scrollEndContent ? <div className="mt-6">{scrollEndContent}</div> : null}
        </div>
      </div>

      {runCaseFooter?.kind === "added" && (runCaseFooter.at || runCaseFooter.by) ? (
        <footer className="shrink-0 border-t border-slate-200 px-2 py-1.5 dark:border-slate-700">
          <AddedByLine addedAt={runCaseFooter.at} addedBy={runCaseFooter.by} />
        </footer>
      ) : runCaseFooter?.kind === "executed" && (runCaseFooter.at || runCaseFooter.by) ? (
        <footer className="shrink-0 border-t border-slate-200 px-2 py-1.5 dark:border-slate-700">
          <ExecutedByLine executedAt={runCaseFooter.at} executedBy={runCaseFooter.by} />
        </footer>
      ) : !runCaseFooter?.kind && (testCase.updated_at || testCase.updated_by) ? (
        <footer className="shrink-0 border-t border-slate-200 px-2 py-1.5 dark:border-slate-700">
          <UpdatedByLine updatedAt={testCase.updated_at} updatedBy={testCase.updated_by} />
        </footer>
      ) : null}
    </div>
  );
}

export default CaseDetailView;
