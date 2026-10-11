import TestAssetPreview from "./TestAssetPreview";
import { MARKDOWN_IMAGE_ALT } from "../utils/markdownImageSnippet";
import { ASSET_NAME_RE } from "../utils/markdownImageLine";

/**
 * Renders a markdown image line when src is a cached asset id (not a URL path).
 */
export default function MarkdownInlineImage({ fileName, alt = MARKDOWN_IMAGE_ALT, repoSlug }) {
  if (!fileName || !ASSET_NAME_RE.test(fileName.trim())) {
    return (
      <p className="my-2 font-mono text-xs text-slate-500 dark:text-slate-400">
        ![{alt}]({fileName})
      </p>
    );
  }
  return (
    <div className="my-2">
      <TestAssetPreview repoSlug={repoSlug} fileName={fileName.trim()} alt={alt} />
    </div>
  );
}
