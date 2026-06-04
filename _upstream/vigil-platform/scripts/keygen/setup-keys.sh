#!/bin/bash
# ============================================================
# DojoJin Tech Dashboard — License keypair generator
# ============================================================
# Run ONCE at initial deployment setup (or when rotating the issuing
# key — which invalidates every license already issued, so don't).
#
# Generates an Ed25519 keypair:
#   - PRIVATE key → stored OUTSIDE this repo (default: ~/Documents/dojojin-keys/)
#   - PUBLIC  key → printed for pasting into src/license.js
#
# Usage:
#   bash scripts/keygen/setup-keys.sh [keys-dir]
# ============================================================

set -e

KEYS_DIR="${1:-$HOME/Documents/dojojin-keys}"
PRIVATE_KEY_PATH="$KEYS_DIR/license-private.pem"
PUBLIC_KEY_PATH="$KEYS_DIR/license-public.pem"

# Sanity — keep keys outside the repo to prevent accidental commit.
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
case "$KEYS_DIR" in
  "$REPO_ROOT"*)
    echo "❌ Refusing to put private key inside the repo at $KEYS_DIR"
    echo "   Use a path outside $REPO_ROOT (default: ~/Documents/dojojin-keys/)"
    exit 1
    ;;
esac

if [ -f "$PRIVATE_KEY_PATH" ]; then
  echo "⚠️  Private key already exists at $PRIVATE_KEY_PATH"
  echo "    Regenerating INVALIDATES every license you've issued before."
  read -p "    Continue anyway? Type 'yes' to confirm: " confirm
  if [ "$confirm" != "yes" ]; then
    echo "    Aborted (no changes made)."
    exit 1
  fi
fi

mkdir -p "$KEYS_DIR"
chmod 700 "$KEYS_DIR"

echo "🔑 Generating Ed25519 keypair…"
openssl genpkey -algorithm ed25519 -out "$PRIVATE_KEY_PATH"
chmod 600 "$PRIVATE_KEY_PATH"
openssl pkey -in "$PRIVATE_KEY_PATH" -pubout -out "$PUBLIC_KEY_PATH"

echo ""
echo "✅ Keys generated:"
echo "   Private: $PRIVATE_KEY_PATH  (chmod 600)"
echo "   Public:  $PUBLIC_KEY_PATH"
echo ""
echo "📋 NEXT STEP — paste this PUBLIC key into src/license.js"
echo "   Replace the LICENSE_PUBLIC_KEY constant value with the block below."
echo ""
echo "──────────── COPY FROM HERE ────────────"
cat "$PUBLIC_KEY_PATH"
echo "──────────── END ────────────"
echo ""
echo "🔐 BACKUP REMINDER — store the PRIVATE key safely:"
echo "   1. Copy:    cat \"$PRIVATE_KEY_PATH\" | pbcopy"
echo "   2. Paste into 1Password Business → Secure Note → \"DojoJin License Private Key\""
echo "   3. Keep an offline backup (encrypted USB, locked drawer)"
echo ""
echo "⚠️  NEVER commit the private key, NEVER email it, NEVER share it."
echo "   If it leaks, every license ever issued becomes forgeable."
