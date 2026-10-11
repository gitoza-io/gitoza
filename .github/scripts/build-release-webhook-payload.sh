#!/usr/bin/env bash
# Build JSON payload for license-server POST /internal/releases/register (or equivalent).
# Usage: build-release-webhook-payload.sh <manifests-dir>
# Requires: jq

set -euo pipefail

MANIFESTS_DIR="${1:?manifests directory required}"

for manifest in windows.json darwin.json linux.json; do
  if [[ ! -f "$MANIFESTS_DIR/$manifest" ]]; then
    echo "ERROR: missing manifest: $manifest (under $MANIFESTS_DIR)" >&2
    exit 1
  fi
done

TAG="$(jq -r '.tag' "$MANIFESTS_DIR/windows.json")"
VERSION="$(jq -r '.version' "$MANIFESTS_DIR/windows.json")"
CHANNEL="$(jq -r '.channel' "$MANIFESTS_DIR/windows.json")"

for manifest in darwin.json linux.json; do
  other_tag="$(jq -r '.tag' "$MANIFESTS_DIR/$manifest")"
  other_version="$(jq -r '.version' "$MANIFESTS_DIR/$manifest")"
  other_channel="$(jq -r '.channel' "$MANIFESTS_DIR/$manifest")"
  if [[ "$other_tag" != "$TAG" || "$other_version" != "$VERSION" || "$other_channel" != "$CHANNEL" ]]; then
    echo "ERROR: manifest mismatch in $manifest" >&2
    exit 1
  fi
done

jq -n \
  --arg tag "$TAG" \
  --arg version "$VERSION" \
  --arg channel "$CHANNEL" \
  --slurpfile windows "$MANIFESTS_DIR/windows.json" \
  --slurpfile darwin "$MANIFESTS_DIR/darwin.json" \
  --slurpfile linux "$MANIFESTS_DIR/linux.json" \
  '{
    tag: $tag,
    version: $version,
    channel: $channel,
    platforms: [
      {
        target: $windows[0].target,
        arch: $windows[0].arch,
        updater_r2_key: $windows[0].updater_r2_key,
        signature: $windows[0].signature,
        installer_r2_key: $windows[0].installer_r2_key
      },
      {
        target: $darwin[0].target,
        arch: $darwin[0].arch,
        updater_r2_key: $darwin[0].updater_r2_key,
        signature: $darwin[0].signature,
        installer_r2_key: $darwin[0].installer_r2_key
      },
      {
        target: $linux[0].target,
        arch: $linux[0].arch,
        updater_r2_key: $linux[0].updater_r2_key,
        signature: $linux[0].signature,
        installer_r2_key: $linux[0].installer_r2_key
      }
    ]
  }'
