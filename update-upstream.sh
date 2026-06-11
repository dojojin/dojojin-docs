#!/usr/bin/env bash
# update-upstream.sh — pull latest from upstream repos into _upstream/
# Usage: bash update-upstream.sh [vigil-platform|vigil-mobile|ai-stack|all]
# Default (no arg): updates all three
#
# After running: git diff HEAD~1 HEAD -- _upstream/ to see what changed
# Then open UPSTREAM-WORKFLOW.md and start a Claude session

set -euo pipefail

TARGET="${1:-all}"
PLATFORM_REMOTE="git@github.com:dojojin/vigil-platform.git"
MOBILE_REMOTE="git@github.com:dojojin/vigil-mobile.git"
AI_STACK_REMOTE="https://github.com/dojojin/ai-stack.git"
PLATFORM_BRANCH="main"
MOBILE_BRANCH="main"
AI_STACK_BRANCH="main"

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

update_ai_stack() {
  echo "==> Pulling ai-stack (public HTTPS, rsync method)..."
  # ai-stack is public — use git fetch + rsync into _upstream/ai-stack/
  # SHA reference stored in _upstream/.ai-stack-sha
  TMPDIR=$(mktemp -d)
  trap 'rm -rf "$TMPDIR"' EXIT
  git clone --depth 1 --branch "$AI_STACK_BRANCH" "$AI_STACK_REMOTE" "$TMPDIR/ai-stack" 2>&1
  NEW_SHA=$(git -C "$TMPDIR/ai-stack" rev-parse HEAD)
  OLD_SHA=$(cat _upstream/.ai-stack-sha 2>/dev/null || echo "none")
  if [ "$NEW_SHA" = "$OLD_SHA" ]; then
    echo "    ai-stack is already up-to-date ($NEW_SHA)."
    return
  fi
  rsync -a --delete --exclude='.git' "$TMPDIR/ai-stack/" _upstream/ai-stack/
  echo "$NEW_SHA" > _upstream/.ai-stack-sha
  git add _upstream/ai-stack/ _upstream/.ai-stack-sha
  git commit -m "chore(upstream): pull ai-stack $(date +%Y-%m-%d) [$NEW_SHA]"
  echo "    Done ($OLD_SHA → $NEW_SHA)."
}

case "$TARGET" in
  vigil-platform) update_platform ;;
  vigil-mobile)   update_mobile ;;
  ai-stack)       update_ai_stack ;;
  all)
    update_platform
    update_mobile
    update_ai_stack
    ;;
  *)
    echo "Usage: $0 [vigil-platform|vigil-mobile|ai-stack|all]" >&2
    exit 1
    ;;
esac

echo ""
echo "Upstream sync complete. Review the diff:"
echo "  git diff HEAD~1 HEAD -- _upstream/"
echo ""
echo "Then open UPSTREAM-WORKFLOW.md and start a Claude session."
