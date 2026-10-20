import { useCallback, useMemo, useRef, useState } from "react";
import { FileUp, CheckCircle2, Loader2 } from "lucide-react";
import DetailPanel from "./DetailPanel";
import {
  scanCsvFileForImport,
  streamCsvAndBatchPayloads,
  buildCasePayloads,
  CSV_IMPORT_MAX_SAMPLE_ROWS,
} from "../utils/csvImportUtils";
import { joinRequirementIds, normalizeRequirementIds } from "../utils/requirementIds";

const labelCls = "mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400";
const selectCls =
  "w-full rounded border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none ring-indigo-400 transition focus:ring-2 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100";

/** Mapping step selects: sharper corners to match the table-style layout. */
const selectClsMapping =
  "w-full rounded-sm border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none ring-indigo-400 transition focus:ring-2 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100";

const STEPS = { intro: 1, mapping: 2, preview: 3 };
const PREVIEW_ROWS = 5;

/**
 * CSV columns allowed for one single-select mapping (other singles + tag/body columns block; current value allowed).
 */
function singleSelectAllowedColumns(columnList, fieldKey, state) {
  const keys = {
    caseId: state.caseIdColumn,
    title: state.titleColumn,
    priority: state.priorityColumn,
    requirementId: state.requirementIdColumn,
    automated: state.automatedColumn,
    suitePath: state.suitePathColumn,
  };
  const current = keys[fieldKey];
  const blocked = new Set();
  Object.entries(keys).forEach(([k, v]) => {
    if (k === fieldKey) return;
    if (v) blocked.add(v);
  });
  (state.tagColumns || []).forEach((c) => blocked.add(c));
  (state.bodyColumns || []).forEach((c) => blocked.add(c));
  return columnList.filter((c) => !blocked.has(c) || c === current);
}

/** Shows which repository will receive imported cases. */
function ImportTargetRepoLine({ repoSlug }) {
  if (!repoSlug) {
    return (
      <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
        No active repository selected. Choose a repository in the app header before importing.
      </div>
    );
  }
  return (
    <p className="text-xs text-slate-500 dark:text-slate-400">
      Repository: <span className="font-mono text-slate-700 dark:text-slate-300">{repoSlug}</span>
    </p>
  );
}

/**
 * Choose which `.gitoza/test/cases/...` project receives imported cases (separate from global tree `projectFilter`).
 * @param {{
 *   directory: string | null;
 *   targetFolder?: string | null;
 *   projects: Array<{ project_path: string; project_name?: string }>;
 *   onSelectProject?: (projectPath: string) => void;
 * }} props
 */
function ImportTargetProjectPicker({ directory, targetFolder = null, projects = [], onSelectProject }) {
  if (!projects.length) {
    if (directory) {
      return (
        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-100">
          <span className="font-medium">Cannot import yet: </span>
          no test projects found. Create a project with the + button, then select it here.
        </div>
      );
    }
    return (
      <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
        No test projects found. Create one with the + button in the toolbar, or pick a folder under a project in the
        tree.
      </div>
    );
  }

  const inList = directory ? projects.some((p) => p.project_path === directory) : false;

  return (
    <div className="rounded border border-slate-200 bg-slate-50 px-3 py-3 dark:border-slate-600 dark:bg-slate-800/40">
      <label htmlFor="csv-import-project" className={labelCls}>
        Target project
      </label>
      <select
        id="csv-import-project"
        value={directory ?? ""}
        onChange={(e) => {
          const v = e.target.value;
          if (v) onSelectProject?.(v);
        }}
        className={selectCls}
      >
        <option value="">Select a project…</option>
        {projects.map((p) => {
          const name = (p.project_name ?? p.project_path).replace(/_/g, " ");
          return (
            <option key={p.project_path} value={p.project_path}>
              {name}
            </option>
          );
        })}
      </select>
      {directory && !inList ? (
        <p className="mt-1.5 text-xs text-amber-800 dark:text-amber-200">
          <span className="font-mono">{directory}</span> is not an existing project. Select a project from the list
          (create one with + if needed).
        </p>
      ) : directory ? (
        <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
          Cases will be created under{" "}
          <span className="font-mono text-slate-600 dark:text-slate-300">{directory}</span>
          {targetFolder ? (
            <>
              {" "}
              · subfolder <span className="font-mono text-slate-600 dark:text-slate-300">{targetFolder}</span>
            </>
          ) : null}
          .
        </p>
      ) : (
        <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
          Required before you can create cases from the preview step.
        </p>
      )}
    </div>
  );
}

/**
 * Right-panel wizard for importing test cases from CSV.
 *
 * @param {{
 *   directory: string | null;
 *   targetFolder?: string | null;
 *   projects?: Array<{ project_path: string; project_name?: string }>;
 *   onSelectProject?: (projectPath: string) => void;
 *   onImportBatch: (payloads: object[]) => Promise<{
 *     created_count: number;
 *     failures?: Array<{ index: number; case_id?: string; detail: string }>;
 *   }>;
 *   repoSlug?: string | null;
 *   onCancel: () => void;
 *   onImportComplete?: (createdCount: number) => void;
 * }} props
 */
function CsvImportPanel({
  directory,
  targetFolder = null,
  repoSlug = null,
  projects = [],
  onSelectProject,
  onImportBatch,
  onCancel,
  onImportComplete,
}) {
  const [step, setStep] = useState(STEPS.intro);
  const [columns, setColumns] = useState([]);
  /** Sample rows only (capped); full file is not kept in memory. */
  const [rows, setRows] = useState([]);
  const [dataRowCount, setDataRowCount] = useState(0);
  const [parseError, setParseError] = useState("");
  const [scanningFile, setScanningFile] = useState(false);
  const [caseIdColumn, setCaseIdColumn] = useState("");
  const [titleColumn, setTitleColumn] = useState("");
  const [priorityColumn, setPriorityColumn] = useState("");
  const [requirementIdColumn, setRequirementIdColumn] = useState("");
  const [automatedColumn, setAutomatedColumn] = useState("");
  const [suitePathColumn, setSuitePathColumn] = useState("");
  const [bodyColumns, setBodyColumns] = useState([]);
  const [tagColumns, setTagColumns] = useState([]);
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0 });
  const [importError, setImportError] = useState("");
  const [importDone, setImportDone] = useState(false);
  const [importCreatedCount, setImportCreatedCount] = useState(0);
  const fileInputRef = useRef(null);
  /** @type {React.MutableRefObject<File | null>} */
  const csvFileRef = useRef(null);
  const importAbortRef = useRef(null);

  const canProceedToMapping = columns.length > 0 && dataRowCount > 0;

  const directoryIsValidProject = useMemo(() => {
    if (!directory) return false;
    if (!projects.length) return false;
    return projects.some((p) => p.project_path === directory);
  }, [directory, projects]);

  const canProceedToPreview = useMemo(() => {
    if (!titleColumn) return false;
    if (caseIdColumn && caseIdColumn === titleColumn) return false;
    const singles = [caseIdColumn, titleColumn, priorityColumn, requirementIdColumn, automatedColumn, suitePathColumn].filter(Boolean);
    if (singles.length !== new Set(singles).size) return false;
    const singleSet = new Set(singles);
    if (tagColumns.some((t) => singleSet.has(t))) return false;
    if (bodyColumns.some((b) => singleSet.has(b))) return false;
    if (tagColumns.some((t) => bodyColumns.includes(t))) return false;
    return true;
  }, [caseIdColumn, titleColumn, priorityColumn, requirementIdColumn, automatedColumn, suitePathColumn, tagColumns, bodyColumns]);

  const usedColumns = useMemo(
    () =>
      new Set(
        [caseIdColumn, titleColumn, priorityColumn, requirementIdColumn, automatedColumn, suitePathColumn, ...tagColumns, ...bodyColumns].filter(
          Boolean,
        ),
      ),
    [caseIdColumn, titleColumn, priorityColumn, requirementIdColumn, automatedColumn, suitePathColumn, tagColumns, bodyColumns],
  );

  const usedBySingleForMulti = useMemo(
    () => new Set([caseIdColumn, titleColumn, priorityColumn, requirementIdColumn, automatedColumn, suitePathColumn].filter(Boolean)),
    [caseIdColumn, titleColumn, priorityColumn, requirementIdColumn, automatedColumn, suitePathColumn],
  );

  const tagSelectableColumns = useMemo(
    () => columns.filter((c) => !usedBySingleForMulti.has(c) && !bodyColumns.includes(c)),
    [columns, usedBySingleForMulti, bodyColumns],
  );

  const bodySelectableColumns = useMemo(
    () => columns.filter((c) => !usedBySingleForMulti.has(c) && !tagColumns.includes(c)),
    [columns, usedBySingleForMulti, tagColumns],
  );

  const selectAllowed = useMemo(() => {
    const state = {
      caseIdColumn,
      titleColumn,
      priorityColumn,
      requirementIdColumn,
      automatedColumn,
      suitePathColumn,
      tagColumns,
      bodyColumns,
    };
    return {
      caseId: singleSelectAllowedColumns(columns, "caseId", state),
      title: singleSelectAllowedColumns(columns, "title", state),
      priority: singleSelectAllowedColumns(columns, "priority", state),
      requirementId: singleSelectAllowedColumns(columns, "requirementId", state),
      automated: singleSelectAllowedColumns(columns, "automated", state),
      suitePath: singleSelectAllowedColumns(columns, "suitePath", state),
    };
  }, [columns, caseIdColumn, titleColumn, priorityColumn, requirementIdColumn, suitePathColumn, tagColumns, bodyColumns]);

  const remainingColumns = useMemo(
    () => columns.filter((c) => !usedColumns.has(c)),
    [columns, usedColumns],
  );

  const mapping = useMemo(
    () => ({
      caseIdColumn,
      titleColumn,
      priorityColumn: priorityColumn || undefined,
      requirementIdColumn: requirementIdColumn || undefined,
      automatedColumn: automatedColumn || undefined,
      suitePathColumn: suitePathColumn || undefined,
      bodyColumns,
      tagColumns,
    }),
    [caseIdColumn, titleColumn, priorityColumn, requirementIdColumn, automatedColumn, suitePathColumn, bodyColumns, tagColumns],
  );

  const { payloads, skipped } = useMemo(() => {
    if (!directory || step < STEPS.preview) return { payloads: [], skipped: [] };
    return buildCasePayloads(rows, mapping, {
      directory,
      targetFolder: targetFolder || undefined,
      defaultPriority: "medium",
      defaultStatus: "active",
      sanitizeCaseId: true,
      repoSlug: repoSlug || undefined,
    });
  }, [directory, targetFolder, rows, mapping, step, repoSlug]);

  const handleFileChange = useCallback(async (e) => {
    const file = e.target?.files?.[0];
    setParseError("");
    setColumns([]);
    setRows([]);
    setDataRowCount(0);
    csvFileRef.current = null;
    if (!file) return;
    csvFileRef.current = file;
    setScanningFile(true);
    try {
      const result = await scanCsvFileForImport(file, { maxSampleRows: CSV_IMPORT_MAX_SAMPLE_ROWS });
      if (result.error) {
        setParseError(result.error);
        csvFileRef.current = null;
        return;
      }
      setColumns(result.columns);
      setRows(result.sampleRows);
      setDataRowCount(result.dataRowCount);
      setCaseIdColumn(result.columns[0] ?? "");
      setTitleColumn(result.columns[1] ?? result.columns[0] ?? "");
      setPriorityColumn("");
      setRequirementIdColumn("");
      setSuitePathColumn("");
      setBodyColumns([]);
      setTagColumns([]);
    } catch (err) {
      setParseError(err?.message || "Failed to read file");
      csvFileRef.current = null;
    } finally {
      setScanningFile(false);
    }
  }, []);

  const handleTagColumnToggle = useCallback((col) => {
    setBodyColumns((bprev) => bprev.filter((c) => c !== col));
    setTagColumns((prev) =>
      prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col],
    );
  }, []);

  const handleBodyColumnToggle = useCallback((col) => {
    setTagColumns((tprev) => tprev.filter((c) => c !== col));
    setBodyColumns((prev) =>
      prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col],
    );
  }, []);

  const onSingleColumnChange = useCallback((setter) => (e) => {
    const v = e.target.value;
    setter(v);
    if (v) {
      setTagColumns((prev) => prev.filter((c) => c !== v));
      setBodyColumns((prev) => prev.filter((c) => c !== v));
    }
  }, []);

  const handleStartImport = useCallback(async () => {
    const file = csvFileRef.current;
    if (!file || !directory || !repoSlug || dataRowCount === 0) return;
    importAbortRef.current?.abort();
    importAbortRef.current = new AbortController();
    const { signal } = importAbortRef.current;

    setImportError("");
    setImportDone(false);
    setImportCreatedCount(0);
    setImportProgress({ current: 0, total: dataRowCount });
    let created = 0;

    const buildOptions = {
      directory,
      targetFolder: targetFolder || undefined,
      defaultPriority: "medium",
      defaultStatus: "active",
      sanitizeCaseId: true,
      repoSlug,
    };

    try {
      await streamCsvAndBatchPayloads(file, {
        mapping,
        buildOptions,
        batchSize: 25,
        signal,
        onSkipped: (item) => {
          setImportError((prev) =>
            prev
              ? `${prev}; Row ${item.index}: ${item.reason}`
              : `Row ${item.index}: ${item.reason}`,
          );
        },
        onProgress: ({ processedRows }) => {
          setImportProgress({ current: processedRows, total: dataRowCount });
        },
        onBatch: async (batch) => {
          const res = await onImportBatch(batch);
          created += res?.created_count ?? 0;
          const fails = res?.failures ?? [];
          fails.forEach((f) => {
            const cid = f.case_id ? `${f.case_id}: ` : "";
            const line = `Batch item ${f.index + 1}: ${cid}${f.detail || "Create failed"}`;
            setImportError((prev) => (prev ? `${prev}; ${line}` : line));
          });
        },
      });
    } catch (err) {
      if (err?.name === "AbortError") {
        setImportError((prev) => (prev ? `${prev}; Import cancelled` : "Import cancelled"));
      } else {
        const msg = err?.response?.data?.detail ?? err?.message ?? "Import failed";
        setImportError((prev) => (prev ? `${prev}; ${msg}` : msg));
      }
    }

    setImportProgress({ current: dataRowCount, total: dataRowCount });
    setImportCreatedCount(created);
    setImportDone(true);
    onImportComplete?.(created);
  }, [dataRowCount, directory, repoSlug, targetFolder, mapping, onImportBatch, onImportComplete]);

  const handleClose = useCallback(() => {
    importAbortRef.current?.abort();
    onCancel();
  }, [onCancel]);

  // —— Step 1: Intro + Load file ——
  if (step === STEPS.intro) {
    return (
      <DetailPanel title="Import test cases (CSV)">
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Upload a CSV file. The file is read in chunks (large exports such as Xray stay memory-efficient). The first row
            must be headers. Map each target field to a CSV column: <strong>Title</strong> is required; <strong>Case ID</strong> is
            optional (blank cells get an auto-assigned id). You can also map priority, requirement ID, tags, and body columns
            (merged as Markdown with bold column titles). Any column you do not map is appended to the case body as a raw
            field table.
          </p>
          <ImportTargetRepoLine repoSlug={repoSlug} />
          <ImportTargetProjectPicker
            directory={directory}
            targetFolder={targetFolder}
            projects={projects}
            onSelectProject={onSelectProject}
          />
          <div>
            <label className={labelCls}>CSV file</label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={handleFileChange}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={scanningFile}
              className="flex items-center gap-2 rounded border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              {scanningFile ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Scanning…
                </>
              ) : (
                <>
                  <FileUp className="h-4 w-4" />
                  Load file
                </>
              )}
            </button>
            {columns.length > 0 && (
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                Loaded: {columns.length} columns, {dataRowCount} data row(s).
                {rows.length < dataRowCount
                  ? ` (first ${rows.length} rows kept in memory for mapping / preview.)`
                  : null}
              </p>
            )}
            {parseError && (
              <p className="mt-2 text-sm text-red-600 dark:text-red-400">{parseError}</p>
            )}
          </div>
          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={handleClose}
              className="rounded px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => setStep(STEPS.mapping)}
              disabled={!canProceedToMapping}
              className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              Next: Map columns
            </button>
          </div>
        </div>
      </DetailPanel>
    );
  }

  // —— Step 2: Mapping ——
  if (step === STEPS.mapping) {
    return (
      <DetailPanel title="Import test cases (CSV)" bodyScroll={false}>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto main-content-scroll space-y-4 py-0">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Map each target field to a column from your CSV. Title is required. Case ID is optional (blank cells get an auto id) and must use{" "}
            <strong>different</strong> columns. Tags and body support multiple columns (mutually exclusive per column). Tag
            cells are split by comma or semicolon. Body columns are written in order.
          </p>

          <ImportTargetRepoLine repoSlug={repoSlug} />
          <ImportTargetProjectPicker
            directory={directory}
            targetFolder={targetFolder}
            projects={projects}
            onSelectProject={onSelectProject}
          />

          {/* Single-select mappings: two columns — target field (left) vs CSV column (right), like the original table layout. */}
          <div className="border border-slate-300 dark:border-slate-600">
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-2 border-b border-slate-300 bg-slate-100 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300">
              <div>Target field</div>
              <div>Column from CSV</div>
            </div>
            <div className="divide-y divide-slate-200 bg-white dark:divide-slate-700 dark:bg-slate-950">
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] items-center gap-2 px-3 py-2.5">
                <label htmlFor="csv-case-id" className="text-sm font-medium text-slate-800 dark:text-slate-100">
                  Case ID <span className="text-slate-400">(optional)</span>
                </label>
                <div className="min-w-0">
                  <select
                    id="csv-case-id"
                    value={caseIdColumn}
                    onChange={onSingleColumnChange(setCaseIdColumn)}
                    className={selectClsMapping}
                  >
                    <option value="">Select column</option>
                    {selectAllowed.caseId.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] items-center gap-2 px-3 py-2.5">
                <label htmlFor="csv-title" className="text-sm font-medium text-slate-800 dark:text-slate-100">
                  Title <span className="text-red-500">*</span>
                </label>
                <div className="min-w-0">
                  <select
                    id="csv-title"
                    value={titleColumn}
                    onChange={onSingleColumnChange(setTitleColumn)}
                    className={selectClsMapping}
                  >
                    <option value="">Select column</option>
                    {selectAllowed.title.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] items-center gap-2 px-3 py-2.5">
                <label htmlFor="csv-priority" className="text-sm font-medium text-slate-800 dark:text-slate-100">
                  Priority
                </label>
                <div className="min-w-0">
                  <select
                    id="csv-priority"
                    value={priorityColumn}
                    onChange={onSingleColumnChange(setPriorityColumn)}
                    className={selectClsMapping}
                  >
                    <option value="">— Not mapped —</option>
                    {selectAllowed.priority.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] items-center gap-2 px-3 py-2.5">
                <label htmlFor="csv-req-id" className="text-sm font-medium text-slate-800 dark:text-slate-100">
                  Requirement ID
                </label>
                <div className="min-w-0">
                  <select
                    id="csv-req-id"
                    value={requirementIdColumn}
                    onChange={onSingleColumnChange(setRequirementIdColumn)}
                    className={selectClsMapping}
                  >
                    <option value="">— Not mapped —</option>
                    {selectAllowed.requirementId.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] items-center gap-2 px-3 py-2.5">
                <label htmlFor="csv-automated" className="text-sm font-medium text-slate-800 dark:text-slate-100">
                  Automated
                </label>
                <div className="min-w-0">
                  <select
                    id="csv-automated"
                    value={automatedColumn}
                    onChange={onSingleColumnChange(setAutomatedColumn)}
                    className={selectClsMapping}
                  >
                    <option value="">— Not mapped —</option>
                    {selectAllowed.automated.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] items-center gap-2 px-3 py-2.5">
                <label htmlFor="csv-suite-path" className="text-sm font-medium text-slate-800 dark:text-slate-100">
                  Suite path
                </label>
                <div className="min-w-0">
                  <select
                    id="csv-suite-path"
                    value={suitePathColumn}
                    onChange={onSingleColumnChange(setSuitePathColumn)}
                    className={selectClsMapping}
                  >
                    <option value="">— Not mapped —</option>
                    {selectAllowed.suitePath.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </div>

          {/* Tags + body: full width each, sharp borders, hierarchy via type. */}
          <section className="border border-slate-300 dark:border-slate-600">
            <div className="border-b border-slate-300 bg-slate-100 px-3 py-2 dark:border-slate-600 dark:bg-slate-900">
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-300">Tags</h3>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Multi-select: each chosen column contributes tags (comma/semicolon split per cell).
              </p>
            </div>
            <div className="bg-white p-3 dark:bg-slate-950">
              {tagSelectableColumns.length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-slate-400">No columns left — all CSV columns are mapped above.</p>
              ) : (
                <div className="divide-y divide-slate-200 dark:divide-slate-700">
                  {tagSelectableColumns.map((col) => {
                    const asTag = tagColumns.includes(col);
                    return (
                      <label
                        key={col}
                        className={`flex cursor-pointer items-center gap-2 px-1 py-2 text-sm ${
                          asTag
                            ? "bg-slate-50 text-slate-900 dark:bg-slate-800 dark:text-slate-100"
                            : "text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-900"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={asTag}
                          onChange={() => handleTagColumnToggle(col)}
                          className="rounded-sm border-slate-400 text-indigo-600 focus:ring-indigo-500 dark:border-slate-500"
                        />
                        <span className="min-w-0 flex-1 truncate font-mono text-[13px]" title={col}>
                          {col}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          <section className="border border-slate-300 dark:border-slate-600">
            <div className="border-b border-slate-300 bg-slate-100 px-3 py-2 dark:border-slate-600 dark:bg-slate-900">
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-300">Body</h3>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Multi-select: sections are appended in selection order — bold Markdown column title, then cell content
                (newlines preserved).
              </p>
            </div>
            <div className="bg-white p-3 dark:bg-slate-950">
              {bodySelectableColumns.length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-slate-400">No columns left — all CSV columns are mapped above.</p>
              ) : (
                <div className="divide-y divide-slate-200 dark:divide-slate-700">
                  {bodySelectableColumns.map((col) => {
                    const asBody = bodyColumns.includes(col);
                    return (
                      <label
                        key={col}
                        className={`flex cursor-pointer items-center gap-2 px-1 py-2 text-sm ${
                          asBody
                            ? "bg-slate-50 text-slate-900 dark:bg-slate-800 dark:text-slate-100"
                            : "text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-900"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={asBody}
                          onChange={() => handleBodyColumnToggle(col)}
                          className="rounded-sm border-slate-400 text-indigo-600 focus:ring-indigo-500 dark:border-slate-500"
                        />
                        <span className="min-w-0 flex-1 truncate font-mono text-[13px]" title={col}>
                          {col}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          {remainingColumns.length > 0 && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Unmapped columns (appended as raw fields in body): {remainingColumns.join(", ")}
            </p>
          )}

          <div className="flex gap-2 border-t border-slate-200 pt-3 pb-1 dark:border-slate-700">
            <button
              type="button"
              onClick={() => setStep(STEPS.intro)}
              className="rounded-sm px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            >
              Back
            </button>
            <button
              type="button"
              onClick={() => setStep(STEPS.preview)}
              disabled={!canProceedToPreview}
              className="rounded-sm bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              Next: Preview & import
            </button>
          </div>
        </div>
      </DetailPanel>
    );
  }

  // —— Step 3: Preview & Import ——
  const previewPayloads = payloads.slice(0, PREVIEW_ROWS);
  return (
    <DetailPanel title="Import test cases (CSV)">
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto space-y-4">
        <ImportTargetRepoLine repoSlug={repoSlug} />
        <ImportTargetProjectPicker
          directory={directory}
          targetFolder={targetFolder}
          projects={projects}
          onSelectProject={onSelectProject}
        />
        <p className="text-sm text-slate-600 dark:text-slate-400">
          {dataRowCount} data row(s) will be processed (second pass streams from disk). Cases are created in batches of 25
          via the API.
          {skipped.length > 0 && (
            <span className="block text-xs text-slate-500 dark:text-slate-400">
              Preview sample: {skipped.length} row(s) skipped (invalid ID/title). Totals may differ for the full file.
            </span>
          )}
        </p>
        {payloads.length === 0 && dataRowCount > 0 && (
          <p className="text-xs text-amber-700 dark:text-amber-300">
            No valid rows in the in-memory sample — you can still run import if later rows in the file are valid.
          </p>
        )}
        <div className="overflow-x-auto rounded border border-slate-200 dark:border-slate-700">
          <table className="min-w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50">
                <th className="px-2 py-1.5 font-medium">Case ID</th>
                <th className="px-2 py-1.5 font-medium">Title</th>
                <th className="px-2 py-1.5 font-medium">Priority</th>
                <th className="px-2 py-1.5 font-medium">Req. ID</th>
                <th className="px-2 py-1.5 font-medium">Tags</th>
              </tr>
            </thead>
            <tbody>
              {previewPayloads.map((p, i) => (
                <tr key={i} className="border-b border-slate-100 dark:border-slate-700">
                  <td className="px-2 py-1.5 font-mono">{p.case_id}</td>
                  <td className="max-w-[10rem] truncate px-2 py-1.5" title={p.title}>{p.title}</td>
                  <td className="px-2 py-1.5">{p.priority}</td>
                  <td className="max-w-[8rem] truncate px-2 py-1.5" title={joinRequirementIds(normalizeRequirementIds(p)) || ""}>
                    {joinRequirementIds(normalizeRequirementIds(p)) || "—"}
                  </td>
                  <td className="max-w-[10rem] truncate px-2 py-1.5" title={(p.tags || []).join(", ")}>
                    {p.tags?.slice(0, 3).join(", ") || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {payloads.length > PREVIEW_ROWS && (
          <p className="text-xs text-slate-500">Showing first {PREVIEW_ROWS} of {payloads.length} valid rows in sample.</p>
        )}

        {!importDone ? (
          <>
            {importError && (
              <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
                {importError}
              </div>
            )}
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setStep(STEPS.mapping)}
                className="rounded px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              >
                Back
              </button>
              <button
                type="button"
                onClick={handleStartImport}
                disabled={!repoSlug || !directoryIsValidProject || dataRowCount === 0 || importProgress.total > 0}
                className="inline-flex items-center gap-2 rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                {importProgress.total > 0 ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Creating {importProgress.current} / {importProgress.total}
                  </>
                ) : (
                  "Create test cases"
                )}
              </button>
            </div>
          </>
        ) : (
          <>
            <div
              className={`flex items-center gap-2 rounded border px-3 py-2 text-sm ${
                importCreatedCount > 0
                  ? "border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-900/20 dark:text-green-200"
                  : "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-100"
              }`}
            >
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>
                Import finished. {importCreatedCount} case(s) created.
                {skipped.length > 0 && ` (Preview sample had ${skipped.length} skipped row(s).)`}
              </span>
            </div>
            {importError && (
              <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
                {importError}
              </div>
            )}
          </>
        )}

        <div className="pt-2">
          <button
            type="button"
            onClick={handleClose}
            className="rounded px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            {importDone ? "Close" : "Cancel"}
          </button>
        </div>
      </div>
    </DetailPanel>
  );
}

export default CsvImportPanel;
