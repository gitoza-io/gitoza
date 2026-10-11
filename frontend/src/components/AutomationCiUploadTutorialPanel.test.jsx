import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AutomationCiUploadTutorialPanel from "./AutomationCiUploadTutorialPanel.jsx";
import AutomationPipelineSummaryPanel from "./AutomationPipelineSummaryPanel.jsx";

describe("AutomationCiUploadTutorialPanel", () => {
  it("renders S3-specific guidance", () => {
    const html = renderToStaticMarkup(
      createElement(AutomationCiUploadTutorialPanel, {
        repoSlug: "my-repo",
        projectSyncConfig: {
          provider_type: "cloud_api",
          s3_prefix: "team-assets",
          s3_bucket: "my-bucket",
        },
      }),
    );
    expect(html).toContain("Cloud Object Storage (S3-compatible)");
    expect(html).toContain("my-bucket");
    expect(html).toContain(
      "team-assets/my-repo/test_results/{pipeline}/{date}/{build_id}/junit.xml",
    );
    expect(html).toContain("aws s3 cp reports/junit.xml");
    expect(html).not.toContain("rclone copy");
    expect(html).not.toContain("cannot copy files to your computer");
  });

  it("renders cloud-drive guidance with rclone instead of local cp", () => {
    const html = renderToStaticMarkup(
      createElement(AutomationCiUploadTutorialPanel, {
        repoSlug: "my-repo",
        projectSyncConfig: {
          provider_type: "local_path",
          local_assets_path: "/Users/me/OneDrive/Assets",
        },
      }),
    );
    expect(html).toContain("OneDrive / Dropbox / Google Drive");
    expect(html).toContain("cannot copy files to your computer");
    expect(html).toContain("my-repo/test_results/{pipeline}/{date}/{build_id}/junit.xml");
    expect(html).toContain("/Users/me/OneDrive/Assets/my-repo/test_results");
    expect(html).toContain("rclone copy reports/junit.xml");
    expect(html).toContain("RCLONE_REMOTE");
    expect(html).not.toContain("aws s3 cp");
    expect(html).not.toContain('cp reports/junit.xml "$DEST');
  });
});

describe("AutomationPipelineSummaryPanel", () => {
  it("does not render the removed pipeline intro paragraph", () => {
    const html = renderToStaticMarkup(
      createElement(AutomationPipelineSummaryPanel, {
        pipeline: {
          pipeline_name: "nightly",
          execution_count: 2,
          failed_count: 0,
          last_finished_at: "2024-06-01T10:00:00Z",
        },
        executions: [],
      }),
    );
    expect(html).toContain("Runs indexed");
    expect(html).not.toContain("Pipeline summary from indexed CI runs");
  });
});
