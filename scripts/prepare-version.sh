#!/bin/bash
set -euo pipefail

VERSION_JSON="${1:?Usage: prepare-version.sh <version.json>}"

# Read fields from GitVersion JSON
SEMVER=$(jq -r '.SemVer' "$VERSION_JSON")
FULL_SEMVER=$(jq -r '.FullSemVer' "$VERSION_JSON")
SHA=$(jq -r '.Sha' "$VERSION_JSON")
SHORT_SHA=$(jq -r '.ShortSha' "$VERSION_JSON")
COMMIT_DATE=$(jq -r '.CommitDate' "$VERSION_JSON")
BRANCH=$(jq -r '.BranchName' "$VERSION_JSON")
MAJOR=$(jq -r '.Major' "$VERSION_JSON")
MINOR=$(jq -r '.Minor' "$VERSION_JSON")
PATCH=$(jq -r '.Patch' "$VERSION_JSON")
WEIGHTED=$(jq -r '.WeightedPreReleaseNumber' "$VERSION_JSON")
PRE_RELEASE_LABEL=$(jq -r '.PreReleaseLabel' "$VERSION_JSON")

BUILD_DATE=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# ── 1. Backend: copy full GitVersion JSON as-is ──
cp "$VERSION_JSON" src/back/YobaPub.Proxy/version.json
echo "Backend: src/back/YobaPub.Proxy/version.json"

# ── 2. Frontend: .env file for webpack ──
cat > src/front/.env <<EOF
GITVERSION_SEMVER=$SEMVER
GITVERSION_FULL_SEMVER=$FULL_SEMVER
GITVERSION_SHA=$SHA
GITVERSION_SHORT_SHA=$SHORT_SHA
GITVERSION_COMMIT_DATE=$COMMIT_DATE
GITVERSION_BUILD_DATE=$BUILD_DATE
EOF
echo "Frontend: src/front/.env"

# ── 3. Tizen: update version in config.xml ──
sed -i "s/version=\"[^\"]*\"/version=\"$MAJOR.$MINOR.$PATCH\"/" \
  src/tizen-widget/src/config.xml
echo "Tizen: config.xml version=$MAJOR.$MINOR.$PATCH"

# ── 4. APK: gradle version properties ──
cat > src/apk/version.properties <<EOF
versionName=$SEMVER
versionCode=$WEIGHTED
EOF
echo "APK: src/apk/version.properties versionName=$SEMVER versionCode=$WEIGHTED"

# ── 5. Export variables for GitHub Actions ──
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  {
    echo "semVer=$SEMVER"
    echo "fullSemVer=$FULL_SEMVER"
    echo "sha=$SHA"
    echo "shortSha=$SHORT_SHA"
    echo "commitDate=$COMMIT_DATE"
    echo "buildDate=$BUILD_DATE"
    echo "weightedPreReleaseNumber=$WEIGHTED"
    echo "majorMinorPatch=$MAJOR.$MINOR.$PATCH"
    echo "preReleaseLabel=$PRE_RELEASE_LABEL"
  } >> "$GITHUB_OUTPUT"
fi

echo "Done: SemVer=$SEMVER"
