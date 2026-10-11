/** GFM opening fence: ```lang or ~~~lang */
const FENCE_OPEN_RE = /^(`{3,}|~{3,})(\w[\w-]*)?$/;

/**
 * @param {string} line
 * @returns {boolean}
 */
export function isFenceOpenLine(line) {
  return FENCE_OPEN_RE.test(String(line ?? "").trim());
}

/**
 * @param {string} line
 * @returns {{ fenceChar: string, fenceLen: number, lang: string } | null}
 */
function parseFenceOpenLine(line) {
  const match = String(line ?? "").trim().match(FENCE_OPEN_RE);
  if (!match) return null;
  const marker = match[1];
  return {
    fenceChar: marker[0],
    fenceLen: marker.length,
    lang: (match[2] ?? "").toLowerCase(),
  };
}

/**
 * @param {string} line
 * @param {string} fenceChar
 * @param {number} minLen
 * @returns {boolean}
 */
function isFenceCloseLine(line, fenceChar, minLen) {
  const trimmed = String(line ?? "").trim();
  if (!trimmed || trimmed[0] !== fenceChar) return false;
  let run = 0;
  while (run < trimmed.length && trimmed[run] === fenceChar) run++;
  if (run < minLen) return false;
  return trimmed.slice(run).trim() === "";
}

/**
 * @param {string[]} lines
 * @param {number} startIndex
 * @returns {{ nextIndex: number, fenceChar: string, fenceLen: number, lang: string, code: string } | null}
 */
export function consumeFencedCodeBlock(lines, startIndex) {
  const open = parseFenceOpenLine(lines[startIndex]);
  if (!open) return null;

  const { fenceChar, fenceLen, lang } = open;
  const codeLines = [];
  let i = startIndex + 1;

  while (i < lines.length) {
    if (isFenceCloseLine(lines[i], fenceChar, fenceLen)) {
      return {
        nextIndex: i + 1,
        fenceChar,
        fenceLen,
        lang,
        code: codeLines.join("\n"),
      };
    }
    codeLines.push(lines[i]);
    i++;
  }

  return {
    nextIndex: i,
    fenceChar,
    fenceLen,
    lang,
    code: codeLines.join("\n"),
  };
}
