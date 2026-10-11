/** Spaces added/removed per Tab / Shift+Tab on list items. */
export const LIST_INDENT_UNIT = "  ";

/** Leading whitespace + bullet or numbered marker + following space. */
export const LIST_ITEM_RE = /^(\s*)([-*]|\d+\.)\s/;

/**
 * @param {string} lineText
 * @returns {{ indent: string, marker: string, number: number | null } | null}
 */
export function parseListLine(lineText) {
  const m = LIST_ITEM_RE.exec(lineText ?? "");
  if (!m) return null;
  const indent = m[1] ?? "";
  const marker = m[2] ?? "";
  const number = /^\d+\.$/.test(marker) ? parseInt(marker.slice(0, -1), 10) : null;
  return { indent, marker, number };
}

/**
 * Line ranges intersecting [selStart, selEnd] (caret on a line counts).
 * @param {string} value
 * @param {number} selStart
 * @param {number} selEnd
 * @returns {{ start: number, end: number, text: string }[]}
 */
function linesIntersectingSelection(value, selStart, selEnd) {
  const start = Math.min(selStart, selEnd);
  const end = Math.max(selStart, selEnd);
  const lines = [];
  let lineStart = 0;
  for (let i = 0; i <= value.length; i++) {
    const atEnd = i === value.length;
    if (atEnd || value[i] === "\n") {
      const lineEnd = i;
      const onLine = start >= lineStart && start <= lineEnd;
      const overlaps =
        start !== end && lineEnd > start && lineStart < end;
      if ((start === end && onLine) || overlaps) {
        lines.push({
          start: lineStart,
          end: lineEnd,
          text: value.slice(lineStart, lineEnd),
        });
      }
      lineStart = i + 1;
    }
  }
  return lines;
}

/**
 * How many leading whitespace characters to strip for one outdent step.
 * @param {string} lineText
 * @returns {number}
 */
function outdentRemoveCount(lineText) {
  const unitLen = LIST_INDENT_UNIT.length;
  let i = 0;
  let removed = 0;
  while (i < lineText.length && removed < unitLen) {
    const ch = lineText[i];
    if (ch === " ") {
      i += 1;
      removed += 1;
    } else if (ch === "\t") {
      i += 1;
      break;
    } else {
      break;
    }
  }
  return i;
}

/**
 * @param {string} value
 * @param {number} selectionStart
 * @param {number} selectionEnd
 * @param {"indent" | "outdent"} mode
 * @returns {{ newValue: string, selectionStart: number, selectionEnd: number } | null}
 */
function transformListSelection(value, selectionStart, selectionEnd, mode) {
  const text = value ?? "";
  const selStart = selectionStart ?? 0;
  const selEnd = selectionEnd ?? selStart;
  const lines = linesIntersectingSelection(text, selStart, selEnd);
  const listLines = lines.filter((l) => parseListLine(l.text));
  if (listLines.length === 0) return null;

  /** @type {{ start: number, end: number, insert: string }[]} */
  const edits = [];
  for (const line of listLines) {
    if (mode === "indent") {
      edits.push({ start: line.start, end: line.start, insert: LIST_INDENT_UNIT });
    } else {
      const remove = outdentRemoveCount(line.text);
      if (remove === 0) continue;
      edits.push({ start: line.start, end: line.start + remove, insert: "" });
    }
  }
  if (edits.length === 0) return null;

  edits.sort((a, b) => a.start - b.start);

  let newValue = "";
  let cursor = 0;
  let newSelStart = selStart;
  let newSelEnd = selEnd;

  for (const edit of edits) {
    newValue += text.slice(cursor, edit.start);
    newValue += edit.insert;
    cursor = edit.end;
    const delta = edit.insert.length - (edit.end - edit.start);

    if (edit.end <= selStart) {
      newSelStart += delta;
    } else if (edit.start < selStart) {
      newSelStart = edit.start + edit.insert.length;
    } else if (edit.start === selStart && delta > 0) {
      // Indent at caret line start: move caret with the inserted spaces.
      newSelStart += delta;
    }

    if (edit.end <= selEnd) {
      newSelEnd += delta;
    } else if (edit.start < selEnd) {
      newSelEnd = edit.start + edit.insert.length;
    } else if (edit.start === selEnd && delta > 0) {
      newSelEnd += delta;
    }
  }
  newValue += text.slice(cursor);

  return {
    newValue,
    selectionStart: Math.max(0, newSelStart),
    selectionEnd: Math.max(0, newSelEnd),
  };
}

/**
 * @param {string} value
 * @returns {{ start: number, end: number, text: string }[]}
 */
function getAllLines(value) {
  const lines = [];
  let lineStart = 0;
  for (let i = 0; i <= value.length; i++) {
    if (i === value.length || value[i] === "\n") {
      lines.push({
        start: lineStart,
        end: i,
        text: value.slice(lineStart, i),
      });
      lineStart = i + 1;
    }
  }
  return lines;
}

/**
 * Renumber contiguous numbered list runs (same indent) at the given line starts to 1., 2., …
 * @param {string} value
 * @param {number[]} lineStarts
 * @param {number} selectionStart
 * @param {number} selectionEnd
 * @returns {{ newValue: string, selectionStart: number, selectionEnd: number }}
 */
function renumberNumberedRunsAtStarts(value, lineStarts, selectionStart, selectionEnd) {
  if (!lineStarts?.length) {
    return { newValue: value, selectionStart, selectionEnd };
  }
  const startSet = new Set(lineStarts);
  const targets = getAllLines(value).filter((l) => {
    if (!startSet.has(l.start)) return false;
    return parseListLine(l.text)?.number != null;
  });
  if (targets.length === 0) {
    return { newValue: value, selectionStart, selectionEnd };
  }

  /** @type {{ indent: string, lines: { start: number, end: number, text: string }[] }[]} */
  const groups = [];
  for (const line of targets) {
    const parsed = parseListLine(line.text);
    if (!parsed || parsed.number == null) continue;
    const last = groups[groups.length - 1];
    if (
      last &&
      last.indent === parsed.indent &&
      last.lines[last.lines.length - 1].end + 1 === line.start
    ) {
      last.lines.push(line);
    } else {
      groups.push({ indent: parsed.indent, lines: [line] });
    }
  }

  /** @type {{ start: number, end: number, newLine: string }[]} */
  const replacements = [];
  for (const group of groups) {
    group.lines.forEach((line, idx) => {
      const parsed = parseListLine(line.text);
      if (!parsed || parsed.number == null) return;
      const match = LIST_ITEM_RE.exec(line.text);
      if (!match) return;
      const newMarker = `${idx + 1}.`;
      if (parsed.marker === newMarker) return;
      const afterMarker = line.text.slice(match[0].length);
      const newLine = `${parsed.indent}${newMarker} ${afterMarker}`;
      replacements.push({ start: line.start, end: line.end, newLine });
    });
  }
  if (replacements.length === 0) {
    return { newValue: value, selectionStart, selectionEnd };
  }

  replacements.sort((a, b) => a.start - b.start);
  let newValue = "";
  let cursor = 0;
  let newSelStart = selectionStart;
  let newSelEnd = selectionEnd;
  for (const edit of replacements) {
    newValue += value.slice(cursor, edit.start);
    newValue += edit.newLine;
    cursor = edit.end;
    const delta = edit.newLine.length - (edit.end - edit.start);
    if (edit.end <= selectionStart) newSelStart += delta;
    else if (edit.start < selectionStart) newSelStart = edit.start + edit.newLine.length;
    if (edit.end <= selectionEnd) newSelEnd += delta;
    else if (edit.start < selectionEnd) newSelEnd = edit.start + edit.newLine.length;
  }
  newValue += value.slice(cursor);

  return {
    newValue,
    selectionStart: Math.max(0, newSelStart),
    selectionEnd: Math.max(0, newSelEnd),
  };
}

/**
 * Indent list lines intersecting the selection by {@link LIST_INDENT_UNIT}.
 * Numbered items in the indented run are renumbered to start at 1.
 * @param {string} value
 * @param {number} selectionStart
 * @param {number} selectionEnd
 * @returns {{ newValue: string, selectionStart: number, selectionEnd: number } | null}
 */
export function indentListSelection(value, selectionStart, selectionEnd) {
  const text = value ?? "";
  const selStart = selectionStart ?? 0;
  const selEnd = selectionEnd ?? selStart;
  const lines = linesIntersectingSelection(text, selStart, selEnd);
  const listLines = lines.filter((l) => parseListLine(l.text));
  if (listLines.length === 0) return null;

  const numberedOriginalStarts = listLines
    .filter((l) => parseListLine(l.text)?.number != null)
    .map((l) => l.start)
    .sort((a, b) => a - b);

  const indented = transformListSelection(text, selStart, selEnd, "indent");
  if (!indented) return null;

  if (numberedOriginalStarts.length === 0) return indented;

  // Map original line starts → starts after indent inserts (each prior indent shifts later lines).
  const indentStarts = [...listLines].map((l) => l.start).sort((a, b) => a - b);
  const newNumberedStarts = numberedOriginalStarts.map((orig) => {
    let shift = 0;
    for (const s of indentStarts) {
      // Inserts at this line's start do not move the line start itself.
      if (s < orig) shift += LIST_INDENT_UNIT.length;
      else break;
    }
    return orig + shift;
  });

  return renumberNumberedRunsAtStarts(
    indented.newValue,
    newNumberedStarts,
    indented.selectionStart,
    indented.selectionEnd,
  );
}

/**
 * Outdent list lines intersecting the selection by up to {@link LIST_INDENT_UNIT}.
 * @param {string} value
 * @param {number} selectionStart
 * @param {number} selectionEnd
 * @returns {{ newValue: string, selectionStart: number, selectionEnd: number } | null}
 */
export function outdentListSelection(value, selectionStart, selectionEnd) {
  return transformListSelection(value, selectionStart, selectionEnd, "outdent");
}

/**
 * Continue a list item on Enter at cursorPos (collapsed caret).
 * @param {string} value
 * @param {number} cursorPos
 * @returns {{ newValue: string, newCursor: number } | null}
 */
export function continueListOnEnter(value, cursorPos) {
  const text = value ?? "";
  const pos = cursorPos ?? 0;
  let lineStart = 0;
  for (let i = pos - 1; i >= 0; i--) {
    if (text[i] === "\n") {
      lineStart = i + 1;
      break;
    }
  }
  let lineEnd = text.length;
  for (let i = pos; i < text.length; i++) {
    if (text[i] === "\n") {
      lineEnd = i;
      break;
    }
  }
  const lineText = text.slice(lineStart, lineEnd);
  const parsed = parseListLine(lineText);
  if (!parsed) return null;

  const markerSuffix =
    parsed.number != null
      ? `${parsed.number + 1}. `
      : parsed.marker === "*"
        ? "* "
        : "- ";
  const inserted = `\n${parsed.indent}${markerSuffix}`;
  const newValue = text.slice(0, pos) + inserted + text.slice(pos);
  return { newValue, newCursor: pos + inserted.length };
}
