/**
 * Format an ISO timestamp as a relative, human-friendly string (e.g. "2 hours ago").
 * Gets fuzzier for older times (minutes → hours → days → weeks → months → years).
 * @param {string} isoTimestamp - ISO 8601 string (e.g. from API)
 * @returns {string} - e.g. "just now", "5 min ago", "2 hr ago", "3 days ago", "2 weeks ago", "3 months ago", "1 year ago"
 */
export function relativeTime(isoTimestamp) {
  if (!isoTimestamp || typeof isoTimestamp !== "string") return "";
  const date = new Date(isoTimestamp.trim());
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const diffMs = now - date;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);
  const diffWeek = Math.floor(diffDay / 7);
  const diffMonth = Math.floor(diffDay / 30);
  const diffYear = Math.floor(diffDay / 365);

  if (diffSec < 60) return "just now";
  if (diffMin < 60) return `${diffMin} min ago`;
  if (diffHr < 24) return `${diffHr} hr ago`;
  if (diffDay < 7) return `${diffDay} day${diffDay === 1 ? "" : "s"} ago`;
  if (diffWeek < 5) return `${diffWeek} week${diffWeek === 1 ? "" : "s"} ago`;
  if (diffMonth < 12) return `${diffMonth} month${diffMonth === 1 ? "" : "s"} ago`;
  return `${diffYear} year${diffYear === 1 ? "" : "s"} ago`;
}
