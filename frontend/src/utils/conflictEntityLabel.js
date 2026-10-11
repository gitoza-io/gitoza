import { isTicketYamlPath, ticketBreadcrumbLabel } from "../constants/ticketPaths";
import { isWikiYamlPath, wikiBreadcrumbLabel } from "../constants/wikiPaths";

const CASES_PREFIX = ".gitoza/test/cases/";
const RUNS_PREFIX = ".gitoza/test/runs/";
const TEMPLATES_PREFIX = ".gitoza/test/templates/";
const PROJECT_CONFIG_PATH = ".gitoza/config.json";

export function isRunFile(path) {
  const normalized = (path || "").replace(/\\/g, "/");
  return normalized.includes("/.gitoza/test/runs/") || normalized.includes(".gitoza/test/runs/");
}

export function isCaseFile(path) {
  const normalized = (path || "").replace(/\\/g, "/");
  return normalized.includes("/.gitoza/test/cases/") || normalized.includes(".gitoza/test/cases/");
}

export function isTemplateFile(path) {
  return (path || "").replace(/\\/g, "/").includes(TEMPLATES_PREFIX);
}

export function isTicketFile(path) {
  return isTicketYamlPath(path);
}

export function isWikiFile(path) {
  return isWikiYamlPath(path);
}

export function isConfigFile(path) {
  return (path || "").replace(/\\/g, "/") === PROJECT_CONFIG_PATH;
}

/** @returns {"case"|"run"|"ticket"|"wiki"|"template"|"config"|"file"} */
export function getConflictEntityKind(filePath) {
  if (isCaseFile(filePath)) return "case";
  if (isRunFile(filePath)) return "run";
  if (isTicketFile(filePath)) return "ticket";
  if (isWikiFile(filePath)) return "wiki";
  if (isTemplateFile(filePath)) return "template";
  if (isConfigFile(filePath)) return "config";
  return "file";
}

export function pathLeafName(filePath) {
  const normalized = (filePath || "").replace(/\\/g, "/");
  const base = normalized.split("/").pop() || normalized;
  return base.replace(/\.(ya?ml|md)$/i, "") || filePath;
}

export function caseMetaFromPath(filePath) {
  const normalized = (filePath || "").replace(/\\/g, "/").replace(/\.ya?ml$/i, "");
  const withoutPrefix = normalized.startsWith(CASES_PREFIX)
    ? normalized.slice(CASES_PREFIX.length)
    : normalized;
  const segments = withoutPrefix.split("/").filter(Boolean);
  const leaf = segments[segments.length - 1] || withoutPrefix || filePath;
  return { title: leaf, caseId: leaf };
}

export function runDisplayName(filePath) {
  const normalized = (filePath || "").replace(/\\/g, "/").replace(/\.ya?ml$/i, "");
  if (normalized.startsWith(RUNS_PREFIX)) {
    const name = normalized.slice(RUNS_PREFIX.length);
    return name.replace(/_/g, " ") || filePath;
  }
  const base = normalized.split("/").pop() || filePath;
  return base.replace(/_/g, " ");
}

export function templateDisplayName(filePath) {
  const normalized = (filePath || "").replace(/\\/g, "/");
  if (normalized.includes(TEMPLATES_PREFIX)) {
    const base = normalized.split("/").pop() || normalized;
    return base.replace(/\.md$/i, "") || filePath;
  }
  return filePath;
}

export { ticketBreadcrumbLabel as ticketDisplayName, wikiBreadcrumbLabel as wikiDisplayName };
