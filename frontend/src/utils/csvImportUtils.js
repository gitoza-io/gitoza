/**
 * CSV import utilities: parse CSV text and build createTestCase payloads.
 * Kept separate from UI for testability and future reuse (e.g. batch API).
 *
 * @module utils/csvImportUtils
 */

/** Case ID must match backend: letters, numbers, underscores, hyphens only. */
const CASE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/**
 * Sanitize a string for use as case_id: trim, replace spaces with underscore, strip invalid chars.
 * @param {string} raw
 * @returns {string}
 */
export function sanitizeCaseId(raw) {
  if (raw == null || typeof raw !== "string") return "";
  return raw
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^A-Za-z0-9_-]/g, "")
    .replace(/^[^A-Za-z0-9]/, "") // ensure first char is alphanumeric
    .slice(0, 200);
}

/**
 * Parse one CSV record from text starting at index `start`. Handles RFC-style quoted fields,
 * commas inside quotes, escaped "", and newlines inside quotes.
 * @param {string} text
 * @param {number} start
 * @returns {{ cells: string[], nextIndex: number }}
 */
function parseCsvRecord(text, start) {
  const cells = [];
  let field = "";
  let inQuotes = false;
  let i = start;

  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (c === '"') {
        if (next === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }

    if (c === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (c === ",") {
      cells.push(field.trim());
      field = "";
      i += 1;
      continue;
    }
    if (c === "\r" && next === "\n") {
      cells.push(field.trim());
      return { cells, nextIndex: i + 2 };
    }
    if (c === "\n" || c === "\r") {
      cells.push(field.trim());
      return { nextIndex: i + 1, cells };
    }
    field += c;
    i += 1;
  }

  cells.push(field.trim());
  return { cells, nextIndex: text.length };
}

/** Default binary chunk size when reading CSV via `File.slice` (streaming). */
export const DEFAULT_CSV_CHUNK_SIZE = 2 * 1024 * 1024;

/** Max data rows kept in memory for mapping / preview sampling (full file is not stored). */
export const CSV_IMPORT_MAX_SAMPLE_ROWS = 150;

/**
 * Try to parse one CSV record from the start of `buffer`. Used for chunked file reads.
 * A record is complete only after an unquoted line ending, or at EOF (`eof === true`).
 * @param {string} buffer
 * @param {boolean} eof - No more bytes will be appended.
 * @returns {{ complete: true, cells: string[], rest: string } | { complete: false }}
 */
export function tryParseOneCsvRecordFromStart(buffer, eof) {
  const cells = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  while (i < buffer.length) {
    const c = buffer[i];
    const next = buffer[i + 1];

    if (inQuotes) {
      if (c === '"') {
        if (next === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }

    if (c === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (c === ",") {
      cells.push(field.trim());
      field = "";
      i += 1;
      continue;
    }
    if (c === "\r" && next === "\n") {
      cells.push(field.trim());
      return { complete: true, cells, rest: buffer.slice(i + 2) };
    }
    if (c === "\n" || c === "\r") {
      cells.push(field.trim());
      return { complete: true, cells, rest: buffer.slice(i + 1) };
    }
    field += c;
    i += 1;
  }

  if (inQuotes) {
    return { complete: false };
  }
  if (!eof) {
    return { complete: false };
  }
  cells.push(field.trim());
  return { complete: true, cells, rest: "" };
}

function trimLeadingNewlines(buffer) {
  let i = 0;
  while (i < buffer.length && (buffer[i] === "\r" || buffer[i] === "\n")) {
    i += 1;
  }
  return buffer.slice(i);
}

function rowObjectFromCells(columns, cells) {
  const row = {};
  columns.forEach((col, j) => {
    row[col] = cells[j] != null ? String(cells[j]).trim() : "";
  });
  return row;
}

/**
 * Stream-parse a CSV `File` in binary chunks; O(chunk) memory (plus small leftover buffer).
 * Invokes `onHeader` once, then `onDataRow` for each data row (awaited if async).
 *
 * @param {File} file
 * @param {{
 *   chunkSize?: number;
 *   signal?: AbortSignal;
 *   onHeader?: (columns: string[]) => void | Promise<void>;
 *   onDataRow?: (row: Record<string, string>) => void | Promise<void>;
 * }} [options]
 * @returns {Promise<void>}
 */
export async function streamCsvFileRows(file, options = {}) {
  const { chunkSize = DEFAULT_CSV_CHUNK_SIZE, signal, onHeader, onDataRow } = options;
  if (!file || file.size === 0) {
    throw new Error("Empty file");
  }

  let buffer = "";
  let fileOffset = 0;
  let headerDone = false;
  /** @type {string[]} */
  let columns = [];

  const readMore = async () => {
    if (fileOffset >= file.size) return false;
    const end = Math.min(fileOffset + chunkSize, file.size);
    const blob = file.slice(fileOffset, end);
    const text = await blob.text();
    fileOffset = end;
    buffer += text;
    return true;
  };

  await readMore();
  if (buffer.charCodeAt(0) === 0xfeff) {
    buffer = buffer.slice(1);
  }

  const processCompleteRecord = async (cells) => {
    if (!headerDone) {
      if (cells.length === 0 || cells.every((h) => h === "")) {
        throw new Error("No header or data");
      }
      columns = cells.map((h, idx) => h || `Column_${idx}`);
      await onHeader?.(columns);
      headerDone = true;
      return;
    }
    const row = rowObjectFromCells(columns, cells);
    if (cells.length === 1 && cells[0] === "" && Object.values(row).every((v) => v === "")) {
      return;
    }
    await onDataRow?.(row);
  };

  while (true) {
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    const eof = fileOffset >= file.size;
    buffer = trimLeadingNewlines(buffer);

    if (buffer.length === 0) {
      if (eof) break;
      await readMore();
      continue;
    }

    let r = tryParseOneCsvRecordFromStart(buffer, eof);
    if (!r.complete) {
      if (eof) {
        throw new Error("Incomplete CSV record at end of file");
      }
      const more = await readMore();
      if (!more) {
        r = tryParseOneCsvRecordFromStart(buffer, true);
        if (!r.complete) {
          throw new Error("Incomplete CSV record at end of file");
        }
      } else {
        continue;
      }
    }

    const { cells, rest } = r;
    buffer = rest;
    await processCompleteRecord(cells);
  }
}

/**
 * First pass: chunked read — header + column list, sample rows (capped), and total data row count.
 * Does not load the full file into a single string.
 *
 * @param {File} file
 * @param {{ chunkSize?: number; signal?: AbortSignal; maxSampleRows?: number }} [options]
 * @returns {Promise<{ columns: string[]; sampleRows: Array<Record<string, string>>; dataRowCount: number; error?: string }>}
 */
export async function scanCsvFileForImport(file, options = {}) {
  const maxSampleRows = options.maxSampleRows ?? CSV_IMPORT_MAX_SAMPLE_ROWS;
  const sampleRows = [];
  let dataRowCount = 0;
  /** @type {string[]} */
  let columns = [];

  try {
    await streamCsvFileRows(file, {
      chunkSize: options.chunkSize,
      signal: options.signal,
      onHeader: (cols) => {
        columns = cols;
      },
      onDataRow: (row) => {
        dataRowCount += 1;
        if (sampleRows.length < maxSampleRows) {
          sampleRows.push(row);
        }
      },
    });
  } catch (e) {
    const name = e?.name || "";
    const msg = name === "AbortError" ? "Aborted" : e?.message || String(e);
    return { columns: [], sampleRows: [], dataRowCount: 0, error: msg };
  }

  if (!columns.length) {
    return { columns: [], sampleRows: [], dataRowCount: 0, error: "No header or data" };
  }

  return { columns, sampleRows, dataRowCount, error: undefined };
}

/**
 * Parse CSV text (handles quoted fields with commas and newlines inside quotes).
 * @param {string} text - Raw CSV file content
 * @returns {{ columns: string[], rows: Array<Record<string, string>>, error?: string }}
 */
export function parseCsvContent(text) {
  if (typeof text !== "string" || !text.trim()) {
    return { columns: [], rows: [], error: "Empty file" };
  }
  let pos = 0;
  if (text.charCodeAt(0) === 0xfeff) {
    pos = 1;
  }

  const { cells: headerCells, nextIndex: afterHeader } = parseCsvRecord(text, pos);
  if (headerCells.length === 0 || headerCells.every((h) => h === "")) {
    return { columns: [], rows: [], error: "No header or data" };
  }

  const columns = headerCells.map((h, idx) => h || `Column_${idx}`);
  const rows = [];
  pos = afterHeader;

  while (pos < text.length) {
    while (pos < text.length && (text[pos] === "\r" || text[pos] === "\n")) {
      pos += 1;
    }
    if (pos >= text.length) break;

    const { cells, nextIndex } = parseCsvRecord(text, pos);
    pos = nextIndex;
    if (cells.length === 1 && cells[0] === "" && pos >= text.length) break;
    const row = {};
    columns.forEach((col, j) => {
      row[col] = cells[j] != null ? String(cells[j]).trim() : "";
    });
    rows.push(row);
  }

  return { columns, rows };
}

/**
 * Build raw body section from row fields that are not mapped to case_id, title, or tags.
 * @param {Record<string, string>} row
 * @param {Set<string>} usedColumns - Column names already used for id/title/tags
 * @returns {string} Markdown block (table or key-value)
 */
function buildBodyFromRemainingColumns(row, usedColumns) {
  const entries = Object.entries(row).filter(([key]) => !usedColumns.has(key) && row[key] !== "");
  if (entries.length === 0) return "";
  const lines = ["## Raw CSV fields", "", "| Field | Value |", "| ----- | ----- |"];
  entries.forEach(([key, value]) => {
    const escaped = String(value).replace(/\|/g, "\\|").replace(/\n/g, " ");
    lines.push(`| ${key} | ${escaped} |`);
  });
  return lines.join("\n");
}

/**
 * Collect tags from selected tag columns (comma-split per cell, trimmed, dedupe).
 * @param {Record<string, string>} row
 * @param {string[]} tagColumns
 * @returns {string[]}
 */
function collectTagsFromRow(row, tagColumns) {
  const set = new Set();
  tagColumns.forEach((col) => {
    const raw = row[col] != null ? String(row[col]).trim() : "";
    raw.split(/[,;]/).forEach((t) => {
      const tag = t.trim();
      if (tag) set.add(tag);
    });
  });
  return Array.from(set);
}

/** Escape asterisks so a column name is safe inside Markdown bold. */
function escapeMarkdownBoldLabel(name) {
  return String(name).replace(/\*/g, "\\*");
}

/**
 * Build case body from mapped body columns: each column becomes **header** then cell text (newlines preserved).
 * @param {Record<string, string>} row
 * @param {string[]} bodyColumnNames - order preserved
 * @returns {string}
 */
function buildBodyFromMappedColumns(row, bodyColumnNames) {
  const parts = [];
  bodyColumnNames.forEach((col) => {
    const raw = row[col] != null ? String(row[col]) : "";
    const trimmed = raw.trim();
    if (!trimmed) return;
    const label = escapeMarkdownBoldLabel(col);
    parts.push(`**${label}**\n\n${trimmed}`);
  });
  return parts.join("\n\n");
}

/**
 * Resolved body column list: `bodyColumns` wins; legacy single `bodyColumn` still supported.
 * @param {CsvFieldMapping} mapping
 * @returns {string[]}
 */
function resolveBodyColumns(mapping) {
  if (mapping.bodyColumns?.length) return mapping.bodyColumns;
  if (mapping.bodyColumn != null && mapping.bodyColumn !== "") return [mapping.bodyColumn];
  return [];
}

/**
 * Build row-level target folder from optional suite path mapping.
 * Expected suite path is project-relative (no project name), slash-separated.
 *
 * @param {string} directory
 * @param {string | undefined} fixedTargetFolder
 * @param {string | undefined} suitePathColumn
 * @param {Record<string, string>} row
 * @returns {string | undefined}
 */
function resolveTargetFolder(directory, fixedTargetFolder, suitePathColumn, row) {
  if (!suitePathColumn) return fixedTargetFolder || undefined;
  const rawSuitePath = (row[suitePathColumn] ?? "").trim();
  if (!rawSuitePath) return undefined;
  const normalized = rawSuitePath
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
  if (!normalized) return undefined;
  return `${directory}/${normalized}`.replace(/\/+/g, "/");
}

/**
 * @typedef {Object} CsvFieldMapping
 * @property {string} caseIdColumn
 * @property {string} titleColumn
 * @property {string[]} [tagColumns]
 * @property {string} [priorityColumn]
 * @property {string} [statusColumn]
 * @property {string} [requirementIdColumn]
 * @property {string} [automatedColumn]
 * @property {string} [suitePathColumn] - optional suite path (project-relative, slash-separated)
 * @property {string[]} [bodyColumns] - mapped columns merged into body as Markdown (**column title** + content)
 * @property {string} [bodyColumn] - deprecated single column; use bodyColumns when possible
 */

/**
 * @typedef {Object} BuildCasePayloadsOptions
 * @property {string} directory - e.g. .gitoza/test/cases/MyProject
 * @property {string} [targetFolder] - optional suite subfolder path
 * @property {string} [defaultPriority='medium']
 * @property {string} [defaultStatus='active']
 * @property {boolean} [sanitizeCaseId=true] - apply sanitizeCaseId to raw case_id
 * @property {string} [repoSlug] - target repository slug (passed as `repo` on each create payload)
 */

/**
 * Build one createTestCase payload from a CSV row, or a skip reason.
 * `rowIndex` is 1-based data row index (excluding header), for error messages.
 *
 * @param {Record<string, string>} row
 * @param {CsvFieldMapping} mapping
 * @param {BuildCasePayloadsOptions} options
 * @param {number} rowIndex
 * @returns {{ payload: object } | { skipped: { index: number; reason: string } }}
 */
export function buildCasePayloadFromRow(row, mapping, options, rowIndex) {
  const {
    directory,
    targetFolder,
    defaultPriority = "medium",
    defaultStatus = "active",
    sanitizeCaseId: doSanitize = true,
    repoSlug,
  } = options;

  if (!directory || !mapping?.caseIdColumn || !mapping?.titleColumn) {
    return { skipped: { index: rowIndex, reason: "Missing directory or mapping" } };
  }

  const bodyCols = resolveBodyColumns(mapping);

  const usedColumns = new Set(
    [
      mapping.caseIdColumn,
      mapping.titleColumn,
      ...(mapping.tagColumns || []),
      mapping.priorityColumn,
      mapping.statusColumn,
      mapping.requirementIdColumn,
      mapping.suitePathColumn,
      ...bodyCols,
    ].filter(Boolean),
  );

  let caseId = (row[mapping.caseIdColumn] ?? "").trim();
  const title = (row[mapping.titleColumn] ?? "").trim();
  if (doSanitize && caseId) caseId = sanitizeCaseId(caseId);
  if (!caseId) {
    return { skipped: { index: rowIndex, reason: "Empty case ID" } };
  }
  if (!CASE_ID_RE.test(caseId)) {
    return { skipped: { index: rowIndex, reason: `Invalid case ID: ${caseId}` } };
  }
  if (!title) {
    return { skipped: { index: rowIndex, reason: "Empty title" } };
  }

  const tags = collectTagsFromRow(row, mapping.tagColumns || []);
  const priority = (mapping.priorityColumn && row[mapping.priorityColumn]?.trim())
    ? row[mapping.priorityColumn].trim().toLowerCase()
    : defaultPriority;
  const status = (mapping.statusColumn && row[mapping.statusColumn]?.trim())
    ? row[mapping.statusColumn].trim().toLowerCase()
    : defaultStatus;
  const requirement_ids = mapping.requirementIdColumn && row[mapping.requirementIdColumn]?.trim()
    ? row[mapping.requirementIdColumn].trim().split(",").map((s) => s.trim()).filter(Boolean)
    : undefined;
  const automatedRaw = mapping.automatedColumn && row[mapping.automatedColumn]?.trim()
    ? row[mapping.automatedColumn].trim().toLowerCase()
    : "";
  const automated = ["true", "yes", "1", "y"].includes(automatedRaw) ? true : undefined;
  const target_folder = resolveTargetFolder(directory, targetFolder, mapping.suitePathColumn, row);
  const bodyFromExtra = buildBodyFromRemainingColumns(row, usedColumns);
  const bodyMain = buildBodyFromMappedColumns(row, bodyCols);
  let body;
  if (bodyMain && bodyFromExtra) {
    body = `${bodyMain}\n\n${bodyFromExtra}`;
  } else {
    body = bodyMain || bodyFromExtra || undefined;
  }

  return {
    payload: {
      directory,
      target_folder,
      case_id: caseId,
      title,
      priority: ["high", "medium", "low"].includes(priority) ? priority : defaultPriority,
      status: status === "active" ? status : defaultStatus,
      tags,
      requirement_ids,
      ...(automated ? { automated: true } : {}),
      body,
      ...(repoSlug ? { repo: repoSlug } : {}),
    },
  };
}

/**
 * Build an array of createTestCase payloads from CSV rows and mapping.
 * Used by CsvImportPanel; payload shape matches api.createTestCase.
 *
 * @param {Array<Record<string, string>>} rows
 * @param {CsvFieldMapping} mapping
 * @param {BuildCasePayloadsOptions} options
 * @returns {{ payloads: Array<object>, skipped: Array<{ index: number; reason: string }> }}
 */
export function buildCasePayloads(rows, mapping, options = {}) {
  if (!options.directory || !mapping?.caseIdColumn || !mapping?.titleColumn) {
    return { payloads: [], skipped: [] };
  }

  const payloads = [];
  const skipped = [];

  rows.forEach((row, index) => {
    const rowIndex = index + 1;
    const out = buildCasePayloadFromRow(row, mapping, options, rowIndex);
    if (out.skipped) {
      skipped.push(out.skipped);
    } else {
      payloads.push(out.payload);
    }
  });

  return { payloads, skipped };
}

/**
 * Second pass: stream the same CSV file and invoke `onBatch` with payload chunks.
 *
 * @param {File} file
 * @param {{
 *   mapping: CsvFieldMapping;
 *   buildOptions: BuildCasePayloadsOptions;
 *   batchSize?: number;
 *   chunkSize?: number;
 *   signal?: AbortSignal;
 *   onBatch: (payloads: object[]) => Promise<void>;
 *   onProgress?: (info: { processedRows: number }) => void;
 *   onSkipped?: (item: { index: number; reason: string }) => void;
 * }} opts
 * @returns {Promise<void>}
 */
export async function streamCsvAndBatchPayloads(file, opts) {
  const {
    mapping,
    buildOptions,
    batchSize = 25,
    chunkSize,
    signal,
    onBatch,
    onProgress,
    onSkipped,
  } = opts;

  let batch = [];
  let processedRows = 0;

  const flush = async () => {
    if (batch.length === 0) return;
    const toSend = batch;
    batch = [];
    await onBatch(toSend);
  };

  await streamCsvFileRows(file, {
    chunkSize,
    signal,
    onDataRow: async (row) => {
      processedRows += 1;
      const out = buildCasePayloadFromRow(row, mapping, buildOptions, processedRows);
      if (out.skipped) {
        onSkipped?.(out.skipped);
      } else {
        batch.push(out.payload);
        if (batch.length >= batchSize) {
          await flush();
        }
      }
      onProgress?.({ processedRows });
    },
  });

  await flush();
}

export { CASE_ID_RE };
