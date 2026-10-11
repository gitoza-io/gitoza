const TEST_RESULTS_SUBFOLDER = "test_results";

/**
 * Path under repo slug only (cloud drive sync root or S3 without team prefix).
 *
 * @param {string | null | undefined} repoSlug
 * @returns {string}
 */
export function buildAutomationRepoRelativeUploadPrefix(repoSlug) {
  const slug = (repoSlug ?? "").trim();
  const rel = `${TEST_RESULTS_SUBFOLDER}/{pipeline}/{date}/{build_id}`;
  return slug ? `${slug}/${rel}` : rel;
}

/**
 * Build the storage-relative prefix for CI JUnit uploads, mirroring
 * `s3_repo_relative_key` in rust-backend/src/automation_paths.rs.
 *
 * @param {string | null | undefined} repoSlug
 * @param {string | null | undefined} s3Prefix
 * @returns {string} e.g. `team-assets/my-repo/test_results/{pipeline}/{date}/{build_id}`
 */
export function buildAutomationUploadPrefix(repoSlug, s3Prefix) {
  const combined = buildAutomationRepoRelativeUploadPrefix(repoSlug);
  const prefix = (s3Prefix ?? "").trim().replace(/\/+$/, "");
  if (!prefix) {
    return combined;
  }
  return `${prefix}/${combined}`;
}

/**
 * Full S3 object key including junit.xml filename.
 *
 * @param {string | null | undefined} repoSlug
 * @param {string | null | undefined} s3Prefix
 * @returns {string}
 */
export function buildAutomationUploadJunitPath(repoSlug, s3Prefix) {
  return `${buildAutomationUploadPrefix(repoSlug, s3Prefix)}/junit.xml`;
}

/**
 * Cloud-drive upload path (relative to sync folder root). Used by CI jobs.
 *
 * @param {string | null | undefined} repoSlug
 * @returns {string}
 */
export function buildAutomationCloudDriveJunitPath(repoSlug) {
  return `${buildAutomationRepoRelativeUploadPrefix(repoSlug)}/junit.xml`;
}

/**
 * Local filesystem path where gitoza reads after cloud sync.
 *
 * @param {string | null | undefined} repoSlug
 * @param {string | null | undefined} localAssetsPath
 * @returns {string}
 */
export function buildAutomationLocalSyncJunitPath(repoSlug, localAssetsPath) {
  const rel = buildAutomationCloudDriveJunitPath(repoSlug);
  const base = (localAssetsPath ?? "").trim().replace(/\/+$/, "");
  if (!base) {
    return rel;
  }
  return `${base}/${rel}`;
}

/**
 * User-facing upload path for the tutorial panel.
 *
 * @param {string | null | undefined} repoSlug
 * @param {{ provider_type?: string | null; s3_prefix?: string | null; local_assets_path?: string | null } | null | undefined} cfg
 * @returns {string}
 */
export function buildAutomationUploadJunitPathDisplay(repoSlug, cfg) {
  const provider = (cfg?.provider_type ?? "").trim().toLowerCase();
  if (provider === "local_path") {
    return buildAutomationCloudDriveJunitPath(repoSlug);
  }
  return buildAutomationUploadJunitPath(repoSlug, cfg?.s3_prefix);
}

/**
 * Minimal GitHub Actions upload snippet for S3-compatible object storage.
 *
 * @param {{ repoSlug: string; uploadPrefix: string; bucket?: string | null }} opts
 * @returns {string}
 */
export function buildS3CiUploadSnippet({ repoSlug, uploadPrefix, bucket }) {
  const bucketVar = bucket?.trim() ? bucket.trim() : "${BUCKET}";
  return `      - name: Upload JUnit to S3
        if: always()
        env:
          AWS_ACCESS_KEY_ID: \${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: \${{ secrets.AWS_SECRET_ACCESS_KEY }}
          AWS_DEFAULT_REGION: \${{ vars.AWS_REGION }}
          BUCKET: ${bucketVar}
          REPO_SLUG: ${repoSlug}
          PIPELINE: pr-checks
          BUILD_ID: \${{ github.run_id }}
          DATE: \${{ github.run_started_at }}
        run: |
          DATE_DAY=$(date -u -d "$DATE" +%Y-%m-%d 2>/dev/null || date -u +%Y-%m-%d)
          PREFIX="${uploadPrefix.replace(/\{pipeline\}/g, "${PIPELINE}").replace(/\{date\}/g, "${DATE_DAY}").replace(/\{build_id\}/g, "${BUILD_ID}")}"
          echo "{\\"branch\\":\\"\${{ github.ref_name }}\\",\\"commit_sha\\":\\"\${{ github.sha }}\\",\\"ci_url\\":\\"\${{ github.server_url }}/\${{ github.repository }}/actions/runs/\${{ github.run_id }}\\"}" > meta.json
          aws s3 cp reports/junit.xml "s3://\${BUCKET}/\${PREFIX}/junit.xml"
          aws s3 cp meta.json "s3://\${BUCKET}/\${PREFIX}/meta.json"`;
}

/**
 * GitHub Actions upload snippet for OneDrive / Dropbox / Google Drive via rclone.
 * CI cannot write to your desktop sync folder; push to the cloud drive instead.
 *
 * @param {{ repoSlug: string; uploadPrefix: string }} opts
 * @returns {string}
 */
export function buildCloudDriveCiUploadSnippet({ repoSlug, uploadPrefix }) {
  return `      - name: Upload JUnit to cloud drive
        if: always()
        env:
          RCLONE_REMOTE: onedrive
          REPO_SLUG: ${repoSlug}
          PIPELINE: pr-checks
          BUILD_ID: \${{ github.run_id }}
          DATE: \${{ github.run_started_at }}
        run: |
          DATE_DAY=$(date -u -d "$DATE" +%Y-%m-%d 2>/dev/null || date -u +%Y-%m-%d)
          REMOTE_PATH="${uploadPrefix.replace(/\{pipeline\}/g, "${PIPELINE}").replace(/\{date\}/g, "${DATE_DAY}").replace(/\{build_id\}/g, "${BUILD_ID}")}"
          echo "{\\"branch\\":\\"\${{ github.ref_name }}\\",\\"commit_sha\\":\\"\${{ github.sha }}\\",\\"ci_url\\":\\"\${{ github.server_url }}/\${{ github.repository }}/actions/runs/\${{ github.run_id }}\\"}" > meta.json
          rclone copy reports/junit.xml "\${RCLONE_REMOTE}:\${REMOTE_PATH}/junit.xml"
          rclone copy meta.json "\${RCLONE_REMOTE}:\${REMOTE_PATH}/meta.json"`;
}
