import { useCallback, useEffect, useMemo, useState } from "react";
import CaseDetailView from "./CaseDetailView";
import CommentStream from "./CommentStream";
import { useGitUserName } from "../hooks/useGitUserName";
import { useDebouncedAutoSave } from "../hooks/useDebouncedAutoSave";
import { DEBOUNCE_MS } from "../constants/autoSave";
import { registerAutoSaveFlush } from "../utils/autoSaveFlushRegistry";
import {
  ASSIGNEE_UNASSIGNED_LABEL,
  displayRunCaseAssignee,
  filterAssigneeSuggestions,
  hasExplicitRunCaseAssignee,
  inheritedRunCaseAssignee,
  storedFromDisplay,
  canonicalAssignee,
} from "../constants/assignee";
import DetailPanel from "./DetailPanel";
import DetailPanelEmpty from "./DetailPanelEmpty";
import DetailPanelLoading from "./DetailPanelLoading";

/**
 * Right panel for Test Run: empty state or case detail (read-only).
 * Pass/Fail/Skip is now handled inline in the tree; Remove is in the tree context menu.
 * Optional customFooter (e.g. Approve run / Reject run for Review) is still supported.
 */
function RunCaseDetailPanel({
  selectedCaseId,
  runCases = [],
  runId,
  runAssignedTo = null,
  runCaseContent,
  customFooter,
  onPostRunCaseComment,
  onDeleteRunCaseComment,
  onPatchRunCase,
  repoSlug = null,
  readOnly = false,
  reviewEnabled = true,
  gitProfileVersion = 0,
  allUsernames = null,
  onOpenTicket = null,
  onOpenWikiPage = null,
}) {
  const [commentPosting, setCommentPosting] = useState(false);
  const [localAssignedTo, setLocalAssignedTo] = useState("");
  const [assignError, setAssignError] = useState("");
  const gitUserName = useGitUserName(repoSlug, gitProfileVersion);
  const selectedCase = runCases.find((c) => c.file_path === selectedCaseId) ?? null;

  const storedAssigned = selectedCase?.assigned_to ?? null;
  const displayAssigned = displayRunCaseAssignee(storedAssigned, runAssignedTo);
  const runInheritedDisplay = inheritedRunCaseAssignee(runAssignedTo);

  useEffect(() => {
    setLocalAssignedTo(displayAssigned);
    setAssignError("");
  }, [selectedCaseId, storedAssigned, runAssignedTo, displayAssigned]);

  const persistedAssign = useMemo(
    () => ({ assignedTo: displayAssigned }),
    [displayAssigned],
  );
  const draftAssign = useMemo(
    () => ({ assignedTo: localAssignedTo }),
    [localAssignedTo],
  );

  const assigneeSuggestions = useMemo(
    () => filterAssigneeSuggestions(allUsernames ?? []),
    [allUsernames],
  );

  const handleAutoSaveAssign = useCallback(
    async (draft) => {
      if (!runId || !selectedCaseId || !onPatchRunCase) return;
      setAssignError("");
      try {
        const stored = storedFromDisplay(draft.assignedTo, runAssignedTo);
        await onPatchRunCase(runId, selectedCaseId, {
          assigned_to: stored ?? "",
        });
      } catch (err) {
        setAssignError(err?.message || "Failed to save assignee");
      }
    },
    [onPatchRunCase, runId, selectedCaseId, runAssignedTo],
  );

  const { flush: flushAssign } = useDebouncedAutoSave({
    enabled: !readOnly && !!selectedCaseId && !!onPatchRunCase,
    key: `${runId}:${selectedCaseId}`,
    draft: draftAssign,
    persisted: persistedAssign,
    normalize: (d) => ({
      assignedTo: canonicalAssignee(d.assignedTo, assigneeSuggestions),
    }),
    save: handleAutoSaveAssign,
    delayMs: DEBOUNCE_MS,
    silent: true,
  });

  useEffect(() => registerAutoSaveFlush(flushAssign), [flushAssign]);

  const runAssigneeSpecialOptions = useMemo(
    () => [{ value: ASSIGNEE_UNASSIGNED_LABEL, label: ASSIGNEE_UNASSIGNED_LABEL }],
    [],
  );

  const assigneeResetLabel = useMemo(() => {
    if (runInheritedDisplay) {
      return `Reset to run assignee (${runInheritedDisplay})`;
    }
    return "Clear case assignee";
  }, [runInheritedDisplay]);

  const handleAssigneeClear = useCallback(() => {
    setLocalAssignedTo(runInheritedDisplay);
  }, [runInheritedDisplay]);

  const handleAssigneeBlur = useCallback(() => {
    setLocalAssignedTo((current) => {
      const resolved = canonicalAssignee(current, assigneeSuggestions);
      if (!(resolved || "").trim()) {
        return runInheritedDisplay;
      }
      return resolved;
    });
  }, [runInheritedDisplay, assigneeSuggestions]);

  const handlePostComment = useCallback(
    async (text) => {
      if (!runId || !selectedCaseId || !onPostRunCaseComment) return;
      setCommentPosting(true);
      try {
        await onPostRunCaseComment(runId, selectedCaseId, text);
      } finally {
        setCommentPosting(false);
      }
    },
    [runId, selectedCaseId, onPostRunCaseComment],
  );

  const handleDeleteComment = useCallback(
    async (index) => {
      if (!runId || !selectedCaseId || !onDeleteRunCaseComment) return;
      await onDeleteRunCaseComment(runId, selectedCaseId, index);
    },
    [runId, selectedCaseId, onDeleteRunCaseComment],
  );

  if (!selectedCaseId || !selectedCase) {
    return (
      <DetailPanel>
        <DetailPanelEmpty
          title="Select a case from the tree"
          description="View details and set Pass / Fail / Skip in the tree"
        />
      </DetailPanel>
    );
  }

  if (selectedCase && !runCaseContent) {
    return (
      <DetailPanel>
        <DetailPanelLoading message="Loading case…" />
      </DetailPanel>
    );
  }

  if (!runCaseContent) {
    return (
      <DetailPanel>
        <DetailPanelEmpty title="Failed to load case content." />
      </DetailPanel>
    );
  }

  const canEditAssignee = !readOnly && !!onPatchRunCase;
  const showAssignee = canEditAssignee || Boolean(displayAssigned);
  const runAssignee = showAssignee
    ? {
        value: canEditAssignee ? localAssignedTo : displayAssigned,
        editable: canEditAssignee,
        onChange: setLocalAssignedTo,
        onClear: handleAssigneeClear,
        onBlur: handleAssigneeBlur,
        clearVariant: "reset",
        clearLabel: assigneeResetLabel,
        suggestions: assigneeSuggestions,
        specialOptions: runAssigneeSpecialOptions,
        showClear: hasExplicitRunCaseAssignee(storedAssigned),
        error: assignError || undefined,
      }
    : null;

  const commentStream = (
    <CommentStream
      comments={selectedCase.comments ?? []}
      currentAuthor={gitUserName}
      onPost={onPostRunCaseComment && !readOnly ? handlePostComment : undefined}
      onDelete={onDeleteRunCaseComment && !readOnly ? handleDeleteComment : undefined}
      disabled={readOnly}
      posting={commentPosting}
    />
  );

  return (
    <DetailPanel footer={customFooter ?? null} bodyScroll={false}>
      <CaseDetailView
        testCase={runCaseContent}
        repoSlug={repoSlug}
        reviewEnabled={reviewEnabled}
        suppressRepoAssignedTo
        runAssignee={runAssignee}
        onOpenTicket={onOpenTicket}
        onOpenWikiPage={onOpenWikiPage}
        scrollEndContent={commentStream}
        runCaseFooter={
          !selectedCase.result || selectedCase.result === "pending"
            ? {
                kind: "added",
                by: selectedCase.executed_by ?? null,
                at: selectedCase.executed_at ?? null,
              }
            : {
                kind: "executed",
                by: selectedCase.executed_by ?? null,
                at: selectedCase.executed_at ?? null,
              }
        }
      />
    </DetailPanel>
  );
}

export default RunCaseDetailPanel;
