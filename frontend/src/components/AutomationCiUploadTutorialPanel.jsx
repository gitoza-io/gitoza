import { Upload } from "lucide-react";
import DetailPanel from "./DetailPanel";
import { normalizeProjectSyncConfig } from "../utils/normalizeProjectSyncConfig";
import {
  buildAutomationLocalSyncJunitPath,
  buildAutomationRepoRelativeUploadPrefix,
  buildAutomationUploadJunitPathDisplay,
  buildAutomationUploadPrefix,
  buildCloudDriveCiUploadSnippet,
  buildS3CiUploadSnippet,
} from "../utils/buildAutomationUploadPrefix";

function CodeBlock({ children }) {
  return (
    <pre className="overflow-x-auto whitespace-pre-wrap rounded-ui border border-slate-200 bg-slate-50 p-3 font-mono text-xs leading-relaxed text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
      {children}
    </pre>
  );
}

function AutomationCiUploadTutorialPanel({
  repoSlug,
  projectSyncConfig = null,
}) {
  const cfg = normalizeProjectSyncConfig(projectSyncConfig);
  const provider = (cfg?.provider_type ?? "").trim().toLowerCase();
  const isCloudDrive = provider === "local_path";
  const isS3 = provider === "cloud_api";
  const slug = repoSlug ?? "my-workspace-slug";
  const uploadPath = buildAutomationUploadJunitPathDisplay(repoSlug, cfg);
  const localSyncPath = isCloudDrive
    ? buildAutomationLocalSyncJunitPath(repoSlug, cfg?.local_assets_path)
    : null;
  const ciSnippet = isCloudDrive
    ? buildCloudDriveCiUploadSnippet({
        repoSlug: slug,
        uploadPrefix: buildAutomationRepoRelativeUploadPrefix(repoSlug),
      })
    : buildS3CiUploadSnippet({
        repoSlug: slug,
        uploadPrefix: buildAutomationUploadPrefix(repoSlug, cfg?.s3_prefix),
        bucket: cfg?.s3_bucket,
      });

  return (
    <DetailPanel
      title={
        <div className="flex min-w-0 items-center gap-2">
          <Upload className="h-5 w-5 shrink-0 text-slate-500 dark:text-slate-400" />
          <span className="truncate">Upload test results from CI</span>
        </div>
      }
    >
      <div className="space-y-5 p-4 text-sm text-slate-700 dark:text-slate-300">
        <p className="leading-relaxed">
          Storage sync is configured, but no pipeline results are indexed yet. Upload JUnit XML from
          your CI job, then click <strong>Load from storage</strong> in the sidebar to index
          results.
        </p>

        {isCloudDrive ? (
          <div className="rounded-ui border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-relaxed text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
            You chose <strong>Local Sync Folder (OneDrive / Dropbox / Google Drive)</strong>. CI
            runs on remote servers and cannot copy files to your computer&apos;s sync folder. Push
            results to your cloud drive instead; gitoza reads them after they sync locally.
          </div>
        ) : null}

        {isS3 ? (
          <div className="rounded-ui border border-slate-200 bg-slate-50 px-3 py-2 text-sm leading-relaxed text-slate-700 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300">
            You chose <strong>Cloud Object Storage (S3-compatible)</strong>. Upload objects directly
            to your bucket using <code className="rounded bg-slate-200 px-1 text-xs dark:bg-slate-800">aws s3 cp</code>{" "}
            or any S3-compatible tool.
            {cfg?.s3_bucket ? (
              <>
                {" "}
                Bucket: <code className="rounded bg-slate-200 px-1 text-xs dark:bg-slate-800">{cfg.s3_bucket}</code>
              </>
            ) : null}
          </div>
        ) : null}

        <section className="space-y-2">
          <h3 className="font-semibold text-slate-900 dark:text-slate-100">
            1. {isCloudDrive ? "Cloud drive path" : "S3 object key"}
          </h3>
          <p className="text-slate-600 dark:text-slate-400">
            {isCloudDrive
              ? "Upload to this path inside your cloud drive sync root (replace "
              : "Upload to this object key in your bucket (replace "}
            <code className="rounded bg-slate-100 px-1 text-xs dark:bg-slate-800">{"{pipeline}"}</code>
            ,{" "}
            <code className="rounded bg-slate-100 px-1 text-xs dark:bg-slate-800">{"{date}"}</code>
            , and{" "}
            <code className="rounded bg-slate-100 px-1 text-xs dark:bg-slate-800">{"{build_id}"}</code>
            ):
          </p>
          <CodeBlock>{uploadPath}</CodeBlock>
          {isCloudDrive && localSyncPath && localSyncPath !== uploadPath ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              After sync, gitoza reads from{" "}
              <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">{localSyncPath}</code> on
              this device.
            </p>
          ) : null}
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Optional <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">meta.json</code>{" "}
            in the same folder can include branch, commit, and CI URL.
          </p>
        </section>

        <section className="space-y-2">
          <h3 className="font-semibold text-slate-900 dark:text-slate-100">
            2. Add upload step to CI YAML
          </h3>
          {isCloudDrive ? (
            <>
              <p className="text-slate-600 dark:text-slate-400">
                Use a cloud-drive upload tool in CI (for example{" "}
                <code className="rounded bg-slate-100 px-1 text-xs dark:bg-slate-800">rclone</code>).
                Set <code className="rounded bg-slate-100 px-1 text-xs dark:bg-slate-800">RCLONE_REMOTE</code>{" "}
                to your configured remote name (
                <code className="rounded bg-slate-100 px-1 text-xs dark:bg-slate-800">onedrive</code>
                ,{" "}
                <code className="rounded bg-slate-100 px-1 text-xs dark:bg-slate-800">dropbox</code>
                ,{" "}
                <code className="rounded bg-slate-100 px-1 text-xs dark:bg-slate-800">gdrive</code>
                , etc.). Configure rclone and store its config as a CI secret before this step runs.
              </p>
              <CodeBlock>{ciSnippet}</CodeBlock>
            </>
          ) : (
            <>
              <p className="text-slate-600 dark:text-slate-400">
                Example GitHub Actions step using{" "}
                <code className="rounded bg-slate-100 px-1 text-xs dark:bg-slate-800">aws s3 cp</code>
                :
              </p>
              <CodeBlock>{ciSnippet}</CodeBlock>
            </>
          )}
        </section>

        <section className="space-y-2">
          <h3 className="font-semibold text-slate-900 dark:text-slate-100">3. Load results</h3>
          <p className="text-slate-600 dark:text-slate-400">
            {isCloudDrive
              ? "After CI uploads to your cloud drive and files sync to this device, click Load from storage in the sidebar to index pipelines here."
              : "After CI uploads to your bucket, click Load from storage in the sidebar to pull and index pipelines here."}
          </p>
        </section>
      </div>
    </DetailPanel>
  );
}

export default AutomationCiUploadTutorialPanel;
