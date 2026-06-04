#!/usr/bin/env node
// ============================================================
// DojoJin Tech Dashboard — License Keygen CLI
// ============================================================
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary — INTERNAL USE ONLY
// ============================================================
// Issues a signed Ed25519/JWT license bound to a specific machine
// fingerprint. NEVER deploy this script (or the private key it reads)
// to a customer's server — it's the engine for forging valid licenses
// that pass src/license.js verification.
//
// Usage:
//   node scripts/keygen/issue-license.js \
//     --machine A3B2C1-D5E6F7-G8H9I0-J1K2L3 \
//     --customer "Acme Building" \
//     --tier STANDARD \
//     --max-cameras 500 \
//     --days 365
//
// See scripts/keygen/README.md for the full operator playbook.
// ============================================================

const fs = require('fs');
const path = require('path');
const os = require('os');

// jose is installed in src/node_modules — fall through to it if the
// keygen folder doesn't have its own copy. Lets the script run without
// a separate npm install in this folder.
let SignJWT, importPKCS8;
try {
  ({ SignJWT, importPKCS8 } = require('jose'));
} catch {
  const srcJosePath = path.join(__dirname, '..', '..', 'src', 'node_modules', 'jose');
  if (!fs.existsSync(srcJosePath)) {
    console.error('❌ jose npm package not found.');
    console.error(`   Looked in: ${srcJosePath}`);
    console.error('   Fix: cd src && npm install');
    process.exit(1);
  }
  ({ SignJWT, importPKCS8 } = require(srcJosePath));
}

// ── Defaults ───────────────────────────────────────────────────
const TIER_DEFAULT_MAX_CAMERAS = {
  STARTER:       100,
  STANDARD:      500,
  PROFESSIONAL: 1000,
  ENTERPRISE:   2000,
  DATACENTER:   3000,
};
const ALL_FEATURES = [
  'line_alerts',
  'scheduled_reports',
  'reports',
  'iva_full',
  'multi_recipient',
  'health_check',
];
// "Standalone mode" = this folder was copied somewhere outside the main
// dashboard repo (e.g. onto a Windows laptop as the sales tool). Detected
// by the absence of the sibling src/license.js. In standalone mode the
// output + ledger live RIGHT NEXT TO the script so the path is predictable
// regardless of where the operator unpacks it; inside the main repo it
// stays at <repo>/licenses-issued/ as before.
const REPO_ROOT = path.join(__dirname, '..', '..');
const INSIDE_MAIN_REPO = fs.existsSync(path.join(REPO_ROOT, 'src', 'license.js'));
const DEFAULT_PRIVATE_KEY = path.join(os.homedir(), 'Documents', 'dojojin-keys', 'license-private.pem');
const DEFAULT_OUT_DIR     = INSIDE_MAIN_REPO
  ? path.join(REPO_ROOT, 'licenses-issued')
  : path.join(__dirname, 'licenses-issued');
const LEDGER_PATH         = path.join(DEFAULT_OUT_DIR, 'ledger.csv');
const MACHINE_ID_PATTERN  = /^[0-9A-F]{6}-[0-9A-F]{6}-[0-9A-F]{6}-[0-9A-F]{6}$/i;

// ── Args ───────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        args[key.replace(/-/g, '_')] = argv[++i];
      } else {
        args[key.replace(/-/g, '_')] = true;
      }
    }
  }
  return args;
}

function showHelp() {
  console.log(`
DojoJin License Keygen — issue a signed Ed25519/JWT license.

Required:
  --machine <id>           Customer Machine ID (24 hex chars in 4 groups:
                           AAAAAA-BBBBBB-CCCCCC-DDDDDD). The customer
                           reads this off Settings → 🔐 License in
                           their dashboard.
  --customer <name>        Customer display name (e.g. "Acme Building")
  --days <n>               License validity in days (e.g. 90, 180, 365, 730)

Optional:
  --customer-id <id>       Short customer code for the ledger (auto-slug if not given)
  --tier <tier>            STARTER | STANDARD | PROFESSIONAL | ENTERPRISE | DATACENTER
                           (default: STANDARD)
  --max-cameras <n>        Override the tier's default max_cameras
  --features <csv>         Comma-separated feature flags (default: all)
  --private-key <path>     Path to license-private.pem
                           (default: ~/Documents/dojojin-keys/license-private.pem)
  --out <path>             Output file path
                           (default: licenses-issued/<date>_<slug>.license)
  --dry-run                Print what would be issued without writing files
  --help                   Show this help

Examples:
  # 1-year STANDARD for Acme Building (max 500 cameras)
  node scripts/keygen/issue-license.js \\
    --machine A3B2C1-D5E6F7-G8H9I0-J1K2L3 \\
    --customer "Acme Building" \\
    --customer-id ACM001 \\
    --tier STANDARD \\
    --max-cameras 500 \\
    --days 365

  # 90-day trial extension
  node scripts/keygen/issue-license.js \\
    --machine ... --customer "XYZ Corp" --tier STARTER --days 90

  # See what would happen, without writing anything
  node scripts/keygen/issue-license.js --machine ... --customer ... --days 30 --dry-run
`);
}

function csvField(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function slugify(s) {
  return String(s).toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'customer';
}

// ── Main ───────────────────────────────────────────────────────
(async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { showHelp(); process.exit(0); }

  // Validate required
  const machine = (args.machine || '').toUpperCase().trim();
  if (!machine || !MACHINE_ID_PATTERN.test(machine)) {
    console.error('❌ --machine is required and must look like:  AAAAAA-BBBBBB-CCCCCC-DDDDDD');
    console.error(`   got: "${args.machine || ''}"`);
    process.exit(1);
  }
  const customer = (args.customer || '').trim();
  if (!customer) { console.error('❌ --customer "Display Name" is required'); process.exit(1); }
  const days = parseInt(args.days, 10);
  if (!Number.isFinite(days) || days < 1 || days > 3650) {
    console.error('❌ --days must be a positive integer (1..3650, i.e. up to 10 years)');
    process.exit(1);
  }

  const tier = (args.tier || 'STANDARD').toUpperCase();
  if (!TIER_DEFAULT_MAX_CAMERAS[tier]) {
    console.error(`❌ --tier "${tier}" not recognised. Allowed: ${Object.keys(TIER_DEFAULT_MAX_CAMERAS).join(', ')}`);
    process.exit(1);
  }
  const maxCameras = args.max_cameras ? parseInt(args.max_cameras, 10) : TIER_DEFAULT_MAX_CAMERAS[tier];
  if (!Number.isFinite(maxCameras) || maxCameras < 1) {
    console.error('❌ --max-cameras must be a positive integer');
    process.exit(1);
  }
  const customerId = (args.customer_id || slugify(customer).toUpperCase().replace(/-/g, '_')).trim();
  const features = args.features
    ? String(args.features).split(',').map(s => s.trim()).filter(Boolean)
    : ALL_FEATURES.slice();
  const privateKeyPath = args.private_key || DEFAULT_PRIVATE_KEY;
  if (!fs.existsSync(privateKeyPath)) {
    console.error(`❌ Private key not found at: ${privateKeyPath}`);
    console.error('   Run scripts/keygen/setup-keys.sh first (once per deployment lifetime).');
    process.exit(1);
  }

  // Sanity-check the public key on the dashboard side is real — not the
  // placeholder. If it's still placeholder, the license we issue WILL
  // be valid cryptographically but won't be verifiable by the running
  // dashboard until the operator pastes the real public key.
  try {
    const licenseSrc = fs.readFileSync(path.join(REPO_ROOT, 'src', 'license.js'), 'utf8');
    if (licenseSrc.includes('PLACEHOLDER_PUBLIC_KEY')) {
      console.warn('');
      console.warn('⚠️  src/license.js still has the PLACEHOLDER public key.');
      console.warn('    The license you issue WILL be valid cryptographically, but the dashboard');
      console.warn('    cannot verify it until you paste the matching PUBLIC key (from');
      console.warn('    setup-keys.sh) into LICENSE_PUBLIC_KEY in src/license.js.');
      console.warn('');
    }
  } catch {}

  // Build payload
  const issuedAtDate = new Date();
  const expiresAtDate = new Date(issuedAtDate.getTime() + days * 86400000);
  const payload = {
    customer,
    customer_id:  customerId,
    machine_id:   machine,
    tier,
    max_cameras:  maxCameras,
    features,
    period_days:  days,
    version:      1,
  };

  // Sign
  let privateKey;
  try {
    const pem = fs.readFileSync(privateKeyPath, 'utf8');
    privateKey = await importPKCS8(pem, 'EdDSA');
  } catch (e) {
    console.error(`❌ Failed to load private key: ${e.message}`);
    process.exit(1);
  }

  const jwt = await new SignJWT(payload)
    .setProtectedHeader({ alg: 'EdDSA', typ: 'JWT' })
    .setIssuedAt(Math.floor(issuedAtDate.getTime() / 1000))
    .setExpirationTime(Math.floor(expiresAtDate.getTime() / 1000))
    .sign(privateKey);

  // Print summary always
  const dateStamp = issuedAtDate.toISOString().slice(0, 10);
  const expStamp  = expiresAtDate.toISOString().slice(0, 10);
  const outPath = args.out || path.join(DEFAULT_OUT_DIR, `${dateStamp}_${slugify(customer)}.license`);

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  LICENSE ISSUED' + (args.dry_run ? ' (DRY RUN — nothing written)' : ''));
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Customer       : ${customer}`);
  console.log(`  Customer ID    : ${customerId}`);
  console.log(`  Machine ID     : ${machine}`);
  console.log(`  Tier           : ${tier}`);
  console.log(`  Max cameras    : ${maxCameras}`);
  console.log(`  Features       : ${features.join(', ')}`);
  console.log(`  Period         : ${days} days`);
  console.log(`  Issued         : ${dateStamp}`);
  console.log(`  Expires        : ${expStamp}`);
  console.log(`  Output file    : ${outPath}`);
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
  console.log('License key (paste this in the customer dashboard):');
  console.log('───────────────────────────────────────────────────────────────');
  console.log(jwt);
  console.log('───────────────────────────────────────────────────────────────');
  console.log('');

  if (args.dry_run) {
    console.log('🟡 Dry run — no file written, no ledger entry made.');
    process.exit(0);
  }

  // Write file
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, jwt + '\n', { mode: 0o600 });

  // Append ledger
  const ledgerHeader = 'issued_at,customer,customer_id,machine_id,tier,max_cameras,period_days,expires_at,out_path\n';
  if (!fs.existsSync(LEDGER_PATH)) {
    fs.mkdirSync(path.dirname(LEDGER_PATH), { recursive: true });
    fs.writeFileSync(LEDGER_PATH, ledgerHeader);
  }
  const ledgerRow = [
    issuedAtDate.toISOString(), customer, customerId, machine, tier,
    maxCameras, days, expStamp, path.relative(REPO_ROOT, outPath),
  ].map(csvField).join(',') + '\n';
  fs.appendFileSync(LEDGER_PATH, ledgerRow);

  console.log(`✅ License written to    : ${outPath}  (chmod 600)`);
  console.log(`✅ Ledger entry appended : ${LEDGER_PATH}`);
  console.log('');
  console.log('📧 Next step — email the license key above to the customer.');
  console.log('   (or attach the .license file as a plain-text file.)');
  console.log('');
})().catch(e => {
  console.error('❌', e.message);
  process.exit(1);
});
