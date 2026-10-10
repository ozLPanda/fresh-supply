"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const { createReadStream } = require("node:fs");
const { createHash } = require("node:crypto");
(async () => {
  const directory = path.resolve(
    process.argv[2] || path.join(__dirname, "../dist"),
  );
  const { version } = require("../package.json");
  const entries = (await fs.readdir(directory))
    .filter(
      (name) =>
        /^latest(?:-[\w-]+)?\.yml$/.test(name) ||
        ([`fresh-supply-${version}-`, `OvoshiHelp-${version}-`].some((prefix) =>
          name.startsWith(prefix),
        ) &&
          /\.(?:exe|dmg|zip|blockmap)$/.test(name)),
    )
    .sort();
  if (!entries.length) throw new Error("No installer artifacts found");
  const lines = [];
  for (const name of entries) {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(path.join(directory, name)))
      hash.update(chunk);
    lines.push(`${hash.digest("hex")}  ${name}`);
  }
  await fs.writeFile(
    path.join(directory, "SHA256SUMS"),
    lines.join("\n") + "\n",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
