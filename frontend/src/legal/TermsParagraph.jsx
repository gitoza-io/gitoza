import { openExternalUrl } from "../utils/openExternalUrl";

const LINK_PATTERN =
  /(https?:\/\/\S+|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;

const TRAILING_PUNCTUATION = /[.,;:!?)]+$/;

const linkClassName = "text-blue-600 underline hover:text-blue-500";

function splitLink(raw) {
  const normalized = raw.replace(TRAILING_PUNCTUATION, "");
  return {
    href: normalized,
    label: normalized,
    suffix: raw.slice(normalized.length),
  };
}

function openLink(value) {
  const { href } = splitLink(value);
  const url = href.includes("@") && !href.startsWith("http") ? `mailto:${href}` : href;
  openExternalUrl(url).catch(() => {});
}

function TermsParagraph({ text }) {
  const parts = [];
  let lastIndex = 0;

  for (const match of text.matchAll(LINK_PATTERN)) {
    const raw = match[0];
    const start = match.index ?? 0;

    if (start > lastIndex) {
      parts.push(text.slice(lastIndex, start));
    }

    const { label, suffix } = splitLink(raw);

    parts.push(
      <button
        key={`${start}-${label}`}
        type="button"
        onClick={() => openLink(raw)}
        className={linkClassName}
      >
        {label}
      </button>,
    );

    if (suffix) {
      parts.push(suffix);
    }

    lastIndex = start + raw.length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return <p>{parts.length > 0 ? parts : text}</p>;
}

export default TermsParagraph;
