# CI upload: JUnit XML to storage

Configure **Storage Sync** first (S3-compatible bucket or shared folder). CI jobs upload artifacts; Gitoza discovers them under `test_results/` when you click **Refresh** in **Test Automation**.

## Path convention

Replace placeholders:

| Placeholder | Example |
|-------------|---------|
| `{repo_slug}` | Workspace slug in Gitoza |
| `{pipeline}` | `nightly-api`, `pr-checks` |
| `{date}` | `2024-06-01` (UTC date) |
| `{build_id}` | GitHub `run_id`, Azure `Build.BuildId` |

```
{repo_slug}/test_results/{pipeline}/{date}/{build_id}/junit.xml
{repo_slug}/test_results/{pipeline}/{date}/{build_id}/meta.json
```

### Optional `meta.json`

```json
{
  "title": "Nightly API #42",
  "branch": "main",
  "commit_sha": "abc123def456",
  "ci_url": "https://github.com/org/repo/actions/runs/12345",
  "triggered_by": "schedule",
  "finished_at": "2024-06-01T02:15:00Z",
  "duration_sec": 320.5
}
```

---

## GitHub Actions

Prerequisites: AWS credentials (or compatible) as repository secrets `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and variables for bucket/region.

```yaml
name: Tests

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Run tests
        run: |
          mkdir -p reports
          # Your test command; example:
          # pytest --junitxml=reports/junit.xml

      - name: Upload JUnit to storage
        if: always()
        env:
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          AWS_DEFAULT_REGION: ${{ vars.AWS_REGION }}
          BUCKET: ${{ vars.S3_BUCKET }}
          REPO_SLUG: my-workspace-slug
          PIPELINE: pr-checks
          BUILD_ID: ${{ github.run_id }}
          DATE: ${{ github.run_started_at }}
        run: |
          DATE_DAY=$(date -u -d "$DATE" +%Y-%m-%d 2>/dev/null || date -u +%Y-%m-%d)
          PREFIX="${REPO_SLUG}/test_results/${PIPELINE}/${DATE_DAY}/${BUILD_ID}"
          echo "{\"branch\":\"${{ github.ref_name }}\",\"commit_sha\":\"${{ github.sha }}\",\"ci_url\":\"${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}\"}" > meta.json
          aws s3 cp reports/junit.xml "s3://${BUCKET}/${PREFIX}/junit.xml"
          aws s3 cp meta.json "s3://${BUCKET}/${PREFIX}/meta.json"
```

If your bucket uses a team prefix (same as image sync), include it in the key, e.g. `team-assets/${REPO_SLUG}/test_results/...`.

---

## Azure Pipelines

```yaml
trigger:
  - main

pool:
  vmImage: ubuntu-latest

variables:
  repoSlug: my-workspace-slug
  pipelineName: pr-checks

steps:
  - script: |
      mkdir -p reports
      # dotnet test --logger "trx;LogFileName=results.trx"
      # or publish JUnit from your test runner into reports/junit.xml
    displayName: Run tests

  - task: AmazonWebServices.aws-vsts-tools.S3Upload.S3Upload@1
    condition: always()
    inputs:
      awsCredentials: 'MyAwsServiceConnection'
      regionName: 'eu-central-1'
      bucketName: 'my-bucket'
      sourceFolder: 'reports'
      globExpressions: 'junit.xml'
      targetFolder: '$(repoSlug)/test_results/$(pipelineName)/$(Build.BuildId)'
    displayName: Upload JUnit (adjust path to include date folder if needed)
```

For Azure, set `build_id` to `$(Build.BuildId)` and add a date segment to match the layout above. Upload `meta.json` with a similar `aws s3 cp` or Azure CLI step.

---

## Local shared folder

When `provider_type` is `local_path`, copy files into:

```
{local_assets_path}/{repo_slug}/test_results/{pipeline}/{date}/{build_id}/junit.xml
```

Ensure the folder is readable from machines running Gitoza.

---

## Viewing results

1. Open **Test Automation** in the sidebar.
2. Click **Refresh** to sync from remote storage.
3. Expand a pipeline, select an execution, browse cases in the middle column, and open failure details on the right.
