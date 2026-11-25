// Build the Ergalics Studio Android distribution (Capacitor WebView).
//
// Chain: version sync → renderer (vite) → stage dist into deploy/android/app-dist
// → cap sync → Gradle assembleDebug/assembleRelease → APK in deploy/android/release.
//
// Just like the Windows build, website/ and docs/ never enter the APK: only the
// staged renderer copy is bundled. The app runs the web edition inside the
// WebView (no Electron bridge, no node-pty, no portable CPython).
//
// Usage:
//   node scripts/android-build.mjs                 # debug APK
//   node scripts/android-build.mjs --release       # release APK (unsigned)
//   node scripts/android-build.mjs --from-dist     # reuse an existing dist/
//   node scripts/android-build.mjs --no-gradle     # stop after cap sync
//   node scripts/android-build.mjs --dry-run       # print the plan only
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const fromDist = args.has('--from-dist');
const release = args.has('--release');
const noGradle = args.has('--no-gradle');

function log(msg) {
  console.log(`[android-build] ${msg}`);
}

function run(cmd, cwd) {
  log(`${dryRun ? 'DRY RUN' : '$'} ${cmd} (cwd=${path.relative(root, cwd) || '.'})`);
  if (!dryRun) execSync(cmd, { cwd, stdio: 'inherit' });
}

const androidDir = path.join(root, 'deploy', 'android');
const nativeDir = path.join(androidDir, 'android');
const version = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;

// 1. Keep the mobile package + Gradle metadata in step with the web edition.
const pkgPath = path.join(androidDir, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
if (pkg.version !== version) {
  pkg.version = version;
  if (!dryRun) writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  log(`mobile package version -> ${version}`);
}

const gradlePath = path.join(nativeDir, 'app', 'build.gradle');
const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
if (!match) throw new Error(`Cannot derive Android versionCode from ${version}`);
const versionCode = Number(match[1]) * 10000 + Number(match[2]) * 100 + Number(match[3]);
const before = readFileSync(gradlePath, 'utf8');
const after = before
  .replace(/versionCode\s+\d+/, `versionCode ${versionCode}`)
  .replace(/versionName\s+"[^"]*"/, `versionName "${version}"`);
if (after !== before) {
  if (!dryRun) writeFileSync(gradlePath, after);
  log(`gradle versionName -> ${version}, versionCode -> ${versionCode}`);
}

// 2. Renderer: the exact same Vite build the web edition ships.
if (!fromDist) {
  run(`${npm} run build:web --silent`, root);
}
const distDir = path.join(root, 'dist');
if (!dryRun && !existsSync(path.join(distDir, 'index.html'))) {
  throw new Error('dist/index.html missing — run the renderer build first');
}

// 3. Stage dist where capacitor.config.ts expects it.
const appDist = path.join(androidDir, 'app-dist');
log(`stage ${path.relative(root, distDir)} -> ${path.relative(root, appDist)}`);
if (!dryRun) {
  mkdirSync(appDist, { recursive: true });
  cpSync(distDir, appDist, { recursive: true, force: true });
}

// 4. Copy web assets + config into the native project.
run(`${npm} run cap:sync --silent`, androidDir);
if (noGradle) {
  log('stopped after cap sync (--no-gradle)');
  process.exit(0);
}

// 5. Gradle. CI sets up JDK + Android SDK; on Windows use gradlew.bat.
//    Invoke the POSIX wrapper through `sh` instead of executing it directly:
//    the native project is authored on Windows (core.filemode=false), so the
//    executable bit is not preserved in git and `./gradlew` fails with
//    "Permission denied" on Linux runners. A chmod in the build script would
//    still leave the committed mode wrong; `sh gradlew` works in both cases.
const gradlew = process.platform === 'win32' ? 'gradlew.bat' : 'sh ./gradlew';
const wrapperFile = process.platform === 'win32' ? 'gradlew.bat' : 'gradlew';
if (!dryRun && !existsSync(path.join(nativeDir, wrapperFile))) {
  throw new Error(`Missing ${wrapperFile} — native project is incomplete`);
}
run(`${gradlew} assemble${release ? 'Release' : 'Debug'}`, nativeDir);

// 6. Collect the APK into a stable location (and onto the desktop on Windows).
if (!dryRun) {
  const apkDir = path.join(nativeDir, 'app', 'build', 'outputs', 'apk', release ? 'release' : 'debug');
  const apks = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith('.apk')) apks.push(p);
    }
  };
  if (existsSync(apkDir)) walk(apkDir);
  if (apks.length === 0) throw new Error(`No APK found under ${apkDir}`);
  const outDir = path.join(androidDir, 'release');
  mkdirSync(outDir, { recursive: true });
  const outName = `Ergalics-Studio-${version}-${release ? 'release' : 'debug'}.apk`;
  const outPath = path.join(outDir, outName);
  copyFileSync(apks[0], outPath);
  log(`APK -> ${path.relative(root, outPath)}`);
  if (process.platform === 'win32' && process.env.USERPROFILE) {
    const desktop = path.join(process.env.USERPROFILE, 'Desktop');
    if (existsSync(desktop)) {
      copyFileSync(outPath, path.join(desktop, outName));
      log(`copied -> ${path.join(desktop, outName)}`);
    }
  }
}
log('done.');
