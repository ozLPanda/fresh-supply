"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const PINNED =
  "74c4dbb4163cdd90ca4850b75d304e916235c882d6af7b5cdad63bffbc977072";
const MARKER = "# fresh-supply transactional installation v1";
const PREPARE =
  'Goto freshTransactionalPreparation\nPush "SHELL_CONTEXT"\nCall uninstallOldVersion\nPush "SHELL_CONTEXT"\nCall handleUninstallResult\nfreshTransactionalPreparation:\n!insertmacro freshPrepareInstallation';
const ICON_BLOCK =
  '!ifdef UNINSTALLER_ICON\n  File /oname=uninstallerIcon.ico "${UNINSTALLER_ICON}"\n!endif\n\n';
function patch(source) {
  if (source.startsWith(MARKER + "\n")) {
    let original = source
      .slice(MARKER.length + 1)
      .replace(
        PREPARE,
        '!insertmacro uninstallOldVersion SHELL_CONTEXT\n!insertmacro handleUninstallResult SHELL_CONTEXT\n\n${if} $installMode == "all"\n  !insertmacro uninstallOldVersion HKEY_CURRENT_USER\n  !insertmacro handleUninstallResult HKEY_CURRENT_USER\n${endIf}',
      )
      .replace(
        "!insertmacro freshInstallApplicationFiles",
        "!insertmacro installApplicationFiles",
      );
    if (!original.includes(ICON_BLOCK))
      original = original.replace(
        "!insertmacro installApplicationFiles",
        ICON_BLOCK + "!insertmacro installApplicationFiles",
      );
    if (createHash("sha256").update(original).digest("hex") !== PINNED)
      throw Error("Patched NSIS template changed");
    return patch(original);
  }
  if (createHash("sha256").update(source).digest("hex") !== PINNED)
    throw Error("NSIS template changed; transactional patch needs review");
  const remove =
    '!insertmacro uninstallOldVersion SHELL_CONTEXT\n!insertmacro handleUninstallResult SHELL_CONTEXT\n\n${if} $installMode == "all"\n  !insertmacro uninstallOldVersion HKEY_CURRENT_USER\n  !insertmacro handleUninstallResult HKEY_CURRENT_USER\n${endIf}';
  if (!source.includes(remove)) throw Error("NSIS uninstall ordering changed");
  // The stock template deletes the old application before extraction and ignores
  // some extraction failures. Fully verify a sibling payload first, then rename
  // both directories on the same volume. Existing uninstall registration remains
  // in place until the new complete application is activated.
  // Keep unreachable references to stock helper functions so NSIS does not
  // reject the build for unused-function warnings. They are never executed.
  return (
    MARKER +
    "\n" +
    source
      .replace(remove, PREPARE)
      .replace(ICON_BLOCK, "")
      .replace(
        "!insertmacro installApplicationFiles",
        "!insertmacro freshInstallApplicationFiles",
      )
  );
}
async function main() {
  const config = require("../package.json").build;
  if (config.win?.signAndEditExecutable === false)
    throw Error(
      "NSIS integrity requires the afterSign hook; executable editing cannot be disabled",
    );
  if (config.afterSign !== "./scripts/package-integrity.cjs")
    throw Error("Missing final Windows package integrity hook");
  if (
    config.nsis?.packElevateHelper !== false ||
    config.nsis?.perMachine === true
  )
    throw Error(
      "Late NSIS elevation helper would escape the final package integrity manifest",
    );
  if (config.nsis?.preCompressedFileExtensions?.length !== 0)
    throw Error("All application files must be inside the checked archive");
  const builder = require("app-builder-lib/package.json");
  if (builder.version !== "26.15.3")
    throw Error("Unsupported electron-builder version");
  const file = path.join(
    path.dirname(require.resolve("app-builder-lib/package.json")),
    "templates/nsis/installSection.nsh",
  );
  await fs.writeFile(file, patch(await fs.readFile(file, "utf8")));
  // The NSIS Nsis7z plugin distributed by electron-builder was built in 2019.
  // Modern archives use ARM64 filters (including pip's ARM64 launcher files),
  // which that old decoder cannot extract. Ship the matching pinned decoder.
  const {
    downloadBuilderToolset,
  } = require("app-builder-lib/out/util/electronGet");
  const source = await downloadBuilderToolset({
    releaseName: "7zip@1.0.0",
    filenameWithExt: "7zip-win-x64.tar.gz",
    checksums: {
      "7zip-win-x64.tar.gz":
        "be071f15bd6da2f78fe81c6ddef2009b0c4d8a51f36b780cb806c7e6df95e1b3",
    },
    githubOrgRepo: "electron-userland/electron-builder-binaries",
  });
  const decoder = path.join(source, "bin/7za.exe");
  if (
    createHash("sha256")
      .update(await fs.readFile(decoder))
      .digest("hex") !==
    "223b873c50380fe9a39f1a22b6abf8d46db506e1c08d08312902f6f3cd1f7ac3"
  )
    throw Error("Pinned Windows archive decoder SHA256 mismatch");
  const destination = path.resolve(__dirname, "../.cache/windows-installer");
  await fs.mkdir(destination, { recursive: true });
  await fs.copyFile(decoder, path.join(destination, "7za.exe"));
}
if (require.main === module)
  main().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
module.exports = { patch, main, PINNED, MARKER };
