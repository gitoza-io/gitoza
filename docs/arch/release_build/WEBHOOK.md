# Release registration webhook (license server contract)

GitHub Actions calls this webhook after each tagged release uploads to R2. The **license server** must implement the endpoint and upsert release metadata (DB). The desktop app does not call this API.

**Caller:** [`.github/workflows/release.yml`](../../../.github/workflows/release.yml) job `register-release`  
**Manifest builder (per platform):** [`.github/scripts/build-platform-release-manifest.mjs`](../../../.github/scripts/build-platform-release-manifest.mjs)  
**Payload merger:** [`.github/scripts/build-release-webhook-payload.mjs`](../../../.github/scripts/build-release-webhook-payload.mjs)

CI writes one manifest per platform to R2 at `{channel}/{tag}/_meta/{target}.json` (`windows`, `darwin`, `linux`). After all matrix jobs succeed, `register-release` downloads those three files and POSTs the merged payload below. The webhook contract is unchanged.

---

## Endpoint

Configure the full URL in GitHub secret `LICENSE_SERVER_RELEASE_WEBHOOK_URL`. Path shape:

`POST https://example.com/internal/releases/register`

Do not commit the production host; store it only in that secret. Auth is the shared header secret below, not the URL.

## Authentication

| Header | Value |
|--------|--------|
| `Content-Type` | `application/json` |
| `X-Gitoza-Release-Webhook-Secret` | GitHub secret `LICENSE_SERVER_RELEASE_WEBHOOK_SECRET` |

Reject requests with missing or wrong secret (`401` or `403`).

---

## Request body

```json
{
  "tag": "v1.0.0",
  "version": "1.0.0",
  "channel": "stable",
  "platforms": [
    {
      "target": "windows",
      "arch": "x86_64",
      "updater_r2_key": "stable/v1.0.0/Gitoza_1.0.0_x64-setup.exe",
      "signature": "<full minisign .sig file contents from Gitoza_1.0.0_x64-setup.exe.sig>",
      "installer_r2_key": "stable/v1.0.0/Gitoza_1.0.0_x64-setup.exe"
    },
    {
      "target": "darwin",
      "arch": "aarch64",
      "updater_r2_key": "stable/v1.0.0/Gitoza_1.0.0_aarch64.app.tar.gz",
      "signature": "<full minisign .sig file contents>",
      "installer_r2_key": "stable/v1.0.0/Gitoza_1.0.0_aarch64.dmg"
    },
    {
      "target": "linux",
      "arch": "x86_64",
      "updater_r2_key": "stable/v1.0.0/Gitoza_1.0.0_amd64.AppImage",
      "signature": "<full minisign .sig file contents from Gitoza_1.0.0_amd64.AppImage.sig>",
      "installer_r2_key": "stable/v1.0.0/Gitoza_1.0.0_amd64.AppImage"
    }
  ]
}
```

### Field semantics

| Field | Description |
|-------|-------------|
| `tag` | Git tag (e.g. `v1.0.0-rc.4`) |
| `version` | App semver without `v` prefix |
| `channel` | `stable` or `rc` (same rule as R2 prefix: tag contains `-rc` → `rc`) |
| `platforms[].target` | `windows`, `darwin`, or `linux` |
| `platforms[].arch` | `x86_64` or `aarch64` |
| `updater_r2_key` | R2 object key for **in-app update** bundle (`*-setup.exe` on Windows, `.app.tar.gz` on macOS, `.AppImage` on Linux) |
| `signature` | Entire `.sig` file text (including `untrusted comment:` lines) |
| `installer_r2_key` | R2 object key for first-install artifact (`.exe` / `.dmg` / `.AppImage`; on Linux, same file as updater) |

R2 bucket: `gitoza-releases`. Keys are `{channel}/{tag}/{filename}`.

### Server behavior (recommended)

1. Validate webhook secret.
2. Upsert one row per `platforms[]` entry for the given `channel` + `version`.
3. For `channel: stable`, rows are served by `GET /updates/stable/...` (latest stable per `target`+`arch`).
4. For `channel: rc`, rows are served by `GET /updates/rc/...` (latest rc per `target`+`arch`). Strict isolation — no cross-channel updates.
5. On update check, generate **presigned R2 URLs** for `updater_r2_key` (private bucket).

Return `2xx` on success. Non-2xx fails the GitHub Actions workflow (`curl -sf`).

---

## GitHub secrets

| Secret | Purpose |
|--------|---------|
| `LICENSE_SERVER_RELEASE_WEBHOOK_URL` | Full POST URL |
| `LICENSE_SERVER_RELEASE_WEBHOOK_SECRET` | Shared header secret |

---

## Related documentation

- [`docs/arch/release_build/README.md`](README.md) — full CI pipeline
- [`docs/arch/update/README.md`](../update/README.md) — desktop update check contract (`GET /updates/...`)
