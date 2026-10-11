import hljs from "highlight.js/lib/core";
import yaml from "highlight.js/lib/languages/yaml";
import json from "highlight.js/lib/languages/json";
import javascript from "highlight.js/lib/languages/javascript";
import bash from "highlight.js/lib/languages/bash";
import plaintext from "highlight.js/lib/languages/plaintext";

hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("yml", yaml);
hljs.registerLanguage("json", json);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("js", javascript);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("sh", bash);
hljs.registerLanguage("plaintext", plaintext);
hljs.registerLanguage("text", plaintext);

const LANG_ALIASES = {
  "": "plaintext",
  txt: "plaintext",
  yml: "yaml",
  js: "javascript",
  sh: "bash",
};

/**
 * @param {string} lang
 * @returns {string}
 */
function resolveLanguage(lang) {
  const normalized = String(lang ?? "").trim().toLowerCase();
  const aliased = LANG_ALIASES[normalized] ?? normalized;
  if (aliased && hljs.getLanguage(aliased)) return aliased;
  return "plaintext";
}

/**
 * @param {string} code
 * @param {string} [lang]
 * @returns {string} HTML safe for dangerouslySetInnerHTML (hljs output)
 */
export function highlightCodeBlock(code, lang) {
  const text = String(code ?? "");
  if (!text) return "";

  const language = resolveLanguage(lang);
  try {
    if (language !== "plaintext") {
      return hljs.highlight(text, { language, ignoreIllegals: true }).value;
    }
  } catch {
    // fall through to plaintext
  }

  try {
    const auto = hljs.highlightAuto(text, ["yaml", "json", "javascript", "bash"]);
    if (auto.relevance > 0) return auto.value;
  } catch {
    // fall through
  }

  return hljs.highlight(text, { language: "plaintext", ignoreIllegals: true }).value;
}
