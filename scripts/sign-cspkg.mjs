#!/usr/bin/env node
// ==========================================================================
// .cspkg signing CLI (FR-05)
//
//   node scripts/sign-cspkg.mjs --genkey <keyfile.json>
//   node scripts/sign-cspkg.mjs <package-dir> --key <keyfile.json> [--out file.cspkg] [--signer NAME]
//   node scripts/sign-cspkg.mjs --verify <file.cspkg> [--trust <keyfile.json>]
//
// Uses the same pure-TS ed25519 implementation as the browser installer, so
// a package signed here verifies byte-identically there. Requires Node >=
// 23.6 (native TypeScript type stripping) — matches the repo toolchain.
// ==========================================================================

import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { join, dirname, basename, relative, sep } from 'node:path';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import {
  signPackage,
  verifyPackageSignature,
  computeFingerprint,
  getPublicKey,
  generateKeyPair,
  bytesToHex,
  hexToBytes,
  OFFICIAL_TRUSTED_KEYS,
} from '../src/core/plugin-signing.ts';

function usage() {
  console.error(
    [
      'usage:',
      '  node scripts/sign-cspkg.mjs --genkey <keyfile.json>',
      '  node scripts/sign-cspkg.mjs <package-dir> --key <keyfile.json> [--out file.cspkg] [--signer NAME]',
      '  node scripts/sign-cspkg.mjs --verify <file.cspkg> [--trust <keyfile.json>]',
    ].join('\n'),
  );
  process.exit(1);
}

/** Walk a package directory into normalized `/`-keyed file bytes. */
function readPackageDir(dir) {
  const files = {};
  const walk = (current) => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) walk(full);
      else files[relative(dir, full).split(sep).join('/')] = new Uint8Array(readFileSync(full));
    }
  };
  walk(dir);
  return files;
}

function loadKeyFile(path) {
  const key = JSON.parse(readFileSync(path, 'utf8'));
  if (typeof key.seed !== 'string' || typeof key.publicKey !== 'string') {
    throw new Error(`key file ${path} must contain { seed, publicKey } hex strings`);
  }
  return key;
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--genkey' || a === '--key' || a === '--out' || a === '--signer' || a === '--trust' || a === '--verify') {
      args[a.slice(2)] = argv[(i += 1)];
      if (args[a.slice(2)] === undefined) usage();
    } else if (a.startsWith('-')) {
      console.error(`unknown option: ${a}`);
      usage();
    } else {
      args._.push(a);
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.genkey) {
    const kp = generateKeyPair();
    const doc = {
      alg: 'ed25519',
      seed: bytesToHex(kp.seed),
      publicKey: bytesToHex(kp.publicKey),
      fingerprint: computeFingerprint(kp.publicKey),
      createdAt: new Date().toISOString(),
    };
    writeFileSync(args.genkey, `${JSON.stringify(doc, null, 2)}\n`);
    console.log(`key pair written to ${args.genkey}`);
    console.log(`fingerprint: ${doc.fingerprint}`);
    console.log('keep the seed file secret; share only the fingerprint with your users.');
    return;
  }

  if (args.verify) {
    const buffer = new Uint8Array(readFileSync(args.verify));
    const files = unzipSync(buffer);
    const manifestRaw = files['manifest.json'];
    if (!manifestRaw) throw new Error('not a .cspkg: missing manifest.json');
    const manifest = JSON.parse(strFromU8(manifestRaw));
    const entryKey = String(manifest.entry || '').replace(/\\/g, '/').replace(/^\.\//, '');
    const entryBytes = files[entryKey];
    if (!entryBytes) throw new Error(`entry "${entryKey}" not found in archive`);
    const trusted = [...OFFICIAL_TRUSTED_KEYS];
    if (args.trust) {
      const key = loadKeyFile(args.trust);
      trusted.push({
        fingerprint: computeFingerprint(hexToBytes(key.publicKey)),
        publicKey: key.publicKey,
        label: key.label || basename(args.trust),
      });
    }
    const result = verifyPackageSignature({ manifest, entryBytes }, trusted);
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 2);
  }

  const dir = args._[0];
  if (!dir || !args.key) usage();
  const key = loadKeyFile(args.key);
  const files = readPackageDir(dir);
  const manifestRaw = files['manifest.json'];
  if (!manifestRaw) throw new Error('package dir must contain manifest.json');
  const manifest = JSON.parse(strFromU8(manifestRaw));
  const entryKey = String(manifest.entry || '').replace(/\\/g, '/').replace(/^\.\//, '');
  const entryBytes = files[entryKey];
  if (!entryBytes) throw new Error(`manifest.entry "${entryKey}" not found under ${dir}`);

  const signature = signPackage(manifest, entryBytes, {
    seedHex: key.seed,
    signer: args.signer || manifest.author || 'unknown',
    permissions: Array.isArray(manifest.permissions) ? manifest.permissions : undefined,
  });
  const signedManifest = { ...manifest, signature };
  files['manifest.json'] = strToU8(`${JSON.stringify(signedManifest, null, 2)}\n`);

  const zipped = zipSync(files);
  const out = args.out || `${basename(dir)}.cspkg`;
  mkdirSync(dirname(out) || '.', { recursive: true });
  writeFileSync(out, zipped);
  console.log(`signed ${out}`);
  console.log(`fingerprint: ${signature.fingerprint} (signer: ${signature.signer})`);
}

try {
  main();
} catch (err) {
  console.error(`sign-cspkg: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
