"use strict";
// Version 0.1.2 recognises only OvoshiHelp installer names. Publish byte-identical
// aliases alongside the renamed installers so its manual update check still works.
const fs = require("node:fs/promises");
const path = require("node:path");
const { version } = require("../package.json");

(async () => {
  const directory = path.resolve(
    process.argv[2] || path.join(__dirname, "../dist"),
  );
  const installers = (await fs.readdir(directory)).filter(
    (name) =>
      name.startsWith(`fresh-supply-${version}-`) &&
      /\.(?:exe|dmg)$/.test(name),
  );
  if (!installers.length) throw new Error("No current-version installer found");
  for (const name of installers) {
    await fs.copyFile(
      path.join(directory, name),
      path.join(directory, name.replace(/^fresh-supply-/, "OvoshiHelp-")),
    );
  }
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
