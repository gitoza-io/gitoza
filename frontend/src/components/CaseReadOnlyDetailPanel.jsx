import { Pencil } from "lucide-react";
import CaseBreadcrumb from "./CaseBreadcrumb";
import CaseDetailView from "./CaseDetailView";
import DetailPanel from "./DetailPanel";
import DetailPanelEmpty from "./DetailPanelEmpty";
import Tooltip from "./Tooltip";

/**
 * Read-only case detail panel (breadcrumb header, no close button).
 * Used by picker pages; mirrors CaseEditorPanel read-only layout without edit affordances by default.
 */
function CaseReadOnlyDetailPanel({
  selectedCaseFilePath = null,
  caseDetail = null,
  caseDetailLoading = false,
  reviewEnabled = true,
  repoSlug = null,
  scrollEndContent = null,
  showEditButton = false,
  onToggleEdit,
  onOpenTicket = null,
  onOpenWikiPage = null,
  emptyTitle = "Select a case to view details",
}) {
  const breadcrumbPath = selectedCaseFilePath ?? caseDetail?.file_path ?? null;

  if (selectedCaseFilePath && caseDetailLoading && !caseDetail) {
    return (
      <DetailPanel>
        <div className="flex min-h-[12rem] flex-1 items-center justify-center px-4 text-sm text-slate-500 dark:text-slate-400">
          Loading test case…
        </div>
      </DetailPanel>
    );
  }

  if (!selectedCaseFilePath && !caseDetail) {
    return (
      <DetailPanel>
        <DetailPanelEmpty title={emptyTitle} iconComponent={null} />
      </DetailPanel>
    );
  }

  if (!caseDetail) {
    return (
      <DetailPanel>
        <DetailPanelEmpty title={emptyTitle} iconComponent={null} />
      </DetailPanel>
    );
  }

  const caseIdRowExtra =
    showEditButton && onToggleEdit ? (
      <Tooltip label="Edit" placement="bottom-end">
        <button
          type="button"
          onClick={() => onToggleEdit(true)}
          className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-indigo-600 dark:hover:bg-slate-800 dark:hover:text-indigo-400"
          aria-label="Edit"
        >
          <Pencil className="h-4 w-4" />
        </button>
      </Tooltip>
    ) : null;

  return (
    <DetailPanel
      title={breadcrumbPath ? <CaseBreadcrumb filePath={breadcrumbPath} /> : null}
      bodyScroll={false}
    >
      <CaseDetailView
        testCase={caseDetail}
        repoSlug={repoSlug}
        reviewEnabled={reviewEnabled}
        onOpenTicket={onOpenTicket}
        onOpenWikiPage={onOpenWikiPage}
        scrollEndContent={scrollEndContent}
        caseIdRowExtra={caseIdRowExtra}
      />
    </DetailPanel>
  );
}

export default CaseReadOnlyDetailPanel;
