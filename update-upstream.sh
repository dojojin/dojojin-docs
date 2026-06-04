#!/usr/bin/env bash
# update-upstream.sh — pull latest from vigil-platform and vigil-mobile subtrees
# Usage: bash update-upstream.sh [vigil-platform|vigil-mobile|all]
# Default (no arg): updates both
#
# After running: git diff HEAD~1 HEAD -- _upstream/ to see what changed
# Then open UPSTREAM-WORKFLOW.md and start a Claude session

set -euo pipefail

TARGET="${1:-all}"
PLATFORM_REMOTE="git@github.com:dojojin/vigil-platform.git"
MOBILE_REMOTE="git@github.com:dojojin/vigil-mobile.git"
PLATFORM_BRANCH="main"
MOBILE_BRANCH="main"

cd "$(git rev-parse --show-toplevel)"

if ! git diff --quiet || ! git diff --staged --quiet; then
  echo "ERROR: working tree is not clean. Commit or stash changes first." >&2
  exit 1
fi

update_platform() {
  echo "==> Pulling vigil-platform (squash)..."
  git subtree pull \
    --prefix _upstream/vigil-platform \
    "$PLATFORM_REMOTE" \
    "$PLATFORM_BRANCH" \
    --squash \
    -m "chore(upstream): pull vigil-platform $(date +%Y-%m-%d)"
  echo "    Done."
}

update_mobile() {
  echo "==> Pulling vigil-mobile (squash)..."
  git subtree pull \
    --prefix _upstream/vigil-mobile \
    "$MOBILE_REMOTE" \
    "$MOBILE_BRANCH" \
    --squash \
    -m "chore(upstream): pull vigil-mobile $(date +%Y-%m-%d)"
  echo "    Done."
}

case "$TARGET" in
  vigil-platform) update_platform ;;
  vigil-mobile)   update_mobile ;;
  all)
    update_platform
    update_mobile
    ;;
  *)
    echo "Usage: $0 [vigil-platform|vigil-mobile|all]" >&2
    exit 1
    ;;
esac

echo ""
echo "Upstream sync complete. Review the diff:"
echo "  git diff HEAD~4 HEAD -- _upstream/   # (ถ้า pull ทั้งสอง)"
echo "  git diff HEAD~2 HEAD -- _upstream/   # (ถ้า pull อันเดียว)"
echo ""
echo "Then open UPSTREAM-WORKFLOW.md and start a Claude session."
