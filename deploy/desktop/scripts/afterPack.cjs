// afterPack hook: stamp the app icon + metadata onto the unpacked exe with
// rcedit. This replaces electron-builder's own executable editing, which
// requires the winCodeSign package (macOS symlinks — cannot extract without
// admin/Developer-Mode on Windows). NSIS then packs the stamped exe.
const path = require('node:path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const { rcedit } = require('rcedit');
  const exe = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
  const icon = path.join(__dirname, '..', 'resources', 'icon.ico');
  const appInfo = context.packager.appInfo;
  await rcedit(exe, {
    icon,
    'version-string': {
      FileDescription: appInfo.productName,
      ProductName: appInfo.productName,
      CompanyName: appInfo.companyName,
      LegalCopyright: appInfo.copyright,
      FileVersion: appInfo.version,
      ProductVersion: appInfo.version,
    },
  });
  console.log(`  • afterPack: icon + metadata stamped → ${exe}`);
};
