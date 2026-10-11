import { describe, expect, it } from "vitest";
import {
  buildAutomationCloudDriveJunitPath,
  buildAutomationLocalSyncJunitPath,
  buildAutomationRepoRelativeUploadPrefix,
  buildAutomationUploadJunitPath,
  buildAutomationUploadJunitPathDisplay,
  buildAutomationUploadPrefix,
  buildCloudDriveCiUploadSnippet,
  buildLocalCiUploadSnippet,
  buildS3CiUploadSnippet,
} from "./buildAutomationUploadPrefix.js";

describe("buildAutomationUploadPrefix", () => {
  it("builds path without s3 prefix", () => {
    expect(buildAutomationUploadPrefix("my-repo", null)).toBe(
      "my-repo/test_results/{pipeline}/{date}/{build_id}",
    );
  });

  it("builds path with s3 prefix", () => {
    expect(buildAutomationUploadPrefix("my-repo", "team-assets/")).toBe(
      "team-assets/my-repo/test_results/{pipeline}/{date}/{build_id}",
    );
  });

  it("builds junit file path for S3", () => {
    expect(buildAutomationUploadJunitPath("my-repo", "team-assets")).toBe(
      "team-assets/my-repo/test_results/{pipeline}/{date}/{build_id}/junit.xml",
    );
  });

  it("builds cloud-drive relative path without local base", () => {
    expect(buildAutomationCloudDriveJunitPath("test")).toBe(
      "test/test_results/{pipeline}/{date}/{build_id}/junit.xml",
    );
  });

  it("builds local sync path for cloud drive provider", () => {
    expect(buildAutomationLocalSyncJunitPath("test", "/Users/me/OneDrive/Assets")).toBe(
      "/Users/me/OneDrive/Assets/test/test_results/{pipeline}/{date}/{build_id}/junit.xml",
    );
  });

  it("builds display path for S3 using s3_prefix and repo slug", () => {
    expect(
      buildAutomationUploadJunitPathDisplay("test", {
        provider_type: "cloud_api",
        s3_prefix: "Assets",
      }),
    ).toBe("Assets/test/test_results/{pipeline}/{date}/{build_id}/junit.xml");
  });

  it("builds display path for cloud drive as cloud-relative path only", () => {
    expect(
      buildAutomationUploadJunitPathDisplay("test", {
        provider_type: "local_path",
        local_assets_path: "/Users/me/OneDrive/Assets",
      }),
    ).toBe("test/test_results/{pipeline}/{date}/{build_id}/junit.xml");
  });
});

describe("buildS3CiUploadSnippet", () => {
  it("includes repo slug and aws s3 cp commands", () => {
    const snippet = buildS3CiUploadSnippet({
      repoSlug: "acme-tests",
      uploadPrefix: "acme-tests/test_results/{pipeline}/{date}/{build_id}",
      bucket: "my-bucket",
    });
    expect(snippet).toContain("REPO_SLUG: acme-tests");
    expect(snippet).toContain("BUCKET: my-bucket");
    expect(snippet).toContain("aws s3 cp reports/junit.xml");
    expect(snippet).toContain("aws s3 cp meta.json");
    expect(snippet).toContain("${PIPELINE}");
    expect(snippet).toContain("${DATE_DAY}");
    expect(snippet).toContain("${BUILD_ID}");
  });
});

describe("buildCloudDriveCiUploadSnippet", () => {
  it("uses rclone to push to cloud drive remote", () => {
    const snippet = buildCloudDriveCiUploadSnippet({
      repoSlug: "acme-tests",
      uploadPrefix: buildAutomationRepoRelativeUploadPrefix("acme-tests"),
    });
    expect(snippet).toContain("RCLONE_REMOTE: onedrive");
    expect(snippet).toContain("rclone copy reports/junit.xml");
    expect(snippet).toContain("rclone copy meta.json");
    expect(snippet).not.toContain("aws s3 cp");
    expect(snippet).not.toContain("STORAGE_BASE");
  });
});
