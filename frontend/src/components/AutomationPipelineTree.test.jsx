import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AutomationPipelineTree from "./AutomationPipelineTree.jsx";

describe("AutomationPipelineTree", () => {
  it("renders pipeline and execution rows", () => {
    const html = renderToStaticMarkup(
      createElement(AutomationPipelineTree, {
        pipelines: [
          {
            pipeline_name: "nightly",
            execution_count: 1,
            last_finished_at: "2024-06-01T10:00:00Z",
            failed_count: 0,
          },
        ],
        executionsByPipeline: {
          nightly: [
            {
              execution_id: "nightly/2024-06-01/42",
              pipeline_name: "nightly",
              build_id: "42",
              branch: "main",
              commit_sha: "abc1234",
              junit_file_count: 1,
              total: 10,
              failed: 0,
              error: 0,
            },
          ],
        },
        expandedPipelines: { nightly: true },
        expandedExecutions: { "nightly/2024-06-01/42": true },
        selectedExecutionId: "nightly/2024-06-01/42",
      }),
    );
    expect(html).toContain("nightly");
    expect(html).toContain("10 tests");
  });

  it("renders suite rows under an expanded execution", () => {
    const html = renderToStaticMarkup(
      createElement(AutomationPipelineTree, {
        pipelines: [
          {
            pipeline_name: "nightly-ui",
            execution_count: 1,
            last_finished_at: "2026-06-24T10:00:00Z",
            failed_count: 1,
          },
        ],
        executionsByPipeline: {
          "nightly-ui": [
            {
              execution_id: "nightly-ui/2026-06-24/55",
              pipeline_name: "nightly-ui",
              build_id: "55",
              branch: "main",
              commit_sha: "abc1234",
              junit_file_count: 1,
              total: 7,
              failed: 1,
              error: 0,
            },
          ],
        },
        suitesByExecution: {
          "nightly-ui/2026-06-24/55": [
            {
              suite_key: "junit-ui.xml\u001fLoginSuite",
              junit_file: "junit-ui.xml",
              suite_name: "LoginSuite",
              display_name: "LoginSuite",
              total: 3,
              passed: 2,
              failed: 1,
              skipped: 0,
              error: 0,
            },
            {
              suite_key: "junit-ui.xml\u001fDashboardSuite",
              junit_file: "junit-ui.xml",
              suite_name: "DashboardSuite",
              display_name: "DashboardSuite",
              total: 4,
              passed: 3,
              failed: 0,
              skipped: 1,
              error: 0,
            },
          ],
        },
        expandedPipelines: { "nightly-ui": true },
        expandedExecutions: { "nightly-ui/2026-06-24/55": true },
        selectedExecutionId: "nightly-ui/2026-06-24/55",
        selectedSuiteKey: "junit-ui.xml\u001fLoginSuite",
      }),
    );
    expect(html).toContain("LoginSuite");
    expect(html).toContain("DashboardSuite");
    expect(html).toContain("3 tests");
  });

  it("highlights only the suite in the selected execution when suite_key is duplicated", () => {
    const sharedSuiteKey = "junit-integration.xml\u001fIntegrationSuite";
    const html = renderToStaticMarkup(
      createElement(AutomationPipelineTree, {
        pipelines: [
          {
            pipeline_name: "pr-checks",
            execution_count: 2,
            last_finished_at: "2026-06-25T10:00:00Z",
            failed_count: 0,
          },
        ],
        executionsByPipeline: {
          "pr-checks": [
            {
              execution_id: "pr-checks/2026-06-25/112",
              pipeline_name: "pr-checks",
              build_id: "112",
              branch: "feature/nested-suites",
              commit_sha: "pr112co",
              junit_file_count: 2,
              total: 9,
              failed: 0,
              error: 0,
            },
            {
              execution_id: "pr-checks/2026-06-24/108",
              pipeline_name: "pr-checks",
              build_id: "108",
              branch: "feature/test-automation",
              commit_sha: "def4567",
              junit_file_count: 1,
              total: 2,
              failed: 0,
              error: 0,
            },
          ],
        },
        suitesByExecution: {
          "pr-checks/2026-06-25/112": [
            {
              suite_key: sharedSuiteKey,
              junit_file: "junit-integration.xml",
              suite_name: "IntegrationSuite",
              display_name: "IntegrationSuite",
              total: 3,
              passed: 3,
              failed: 0,
              skipped: 0,
              error: 0,
            },
          ],
          "pr-checks/2026-06-24/108": [
            {
              suite_key: sharedSuiteKey,
              junit_file: "junit-integration.xml",
              suite_name: "IntegrationSuite",
              display_name: "IntegrationSuite",
              total: 2,
              passed: 2,
              failed: 0,
              skipped: 0,
              error: 0,
            },
          ],
        },
        expandedPipelines: { "pr-checks": true },
        expandedExecutions: {
          "pr-checks/2026-06-25/112": true,
          "pr-checks/2026-06-24/108": true,
        },
        selectedExecutionId: "pr-checks/2026-06-25/112",
        selectedSuiteKey: sharedSuiteKey,
      }),
    );

    const selectedCount = (html.match(/bg-list-selected/g) ?? []).length;
    expect(selectedCount).toBe(1);
    expect(html).toContain("IntegrationSuite");
  });
});
