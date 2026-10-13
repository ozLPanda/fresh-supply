#!/usr/bin/env node
"use strict";
// Run after prepare:runtime, on the target OS. Only a fresh private test cluster is used.
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const net = require("node:net");
const { randomBytes } = require("node:crypto");
const { spawn } = require("node:child_process");
const { Client } = require("pg");
const project = path.resolve(__dirname, "../..");
const MAX_OUTPUT = 64 * 1024;
const TEST_REPORT = path.join(
  project,
  "backend/target/surefire-reports/TEST-kz.company.shop.datatransfer.DataTransferTrackingIntegrationTest.xml",
);

function assertExecutedReport(report) {
  const suite = report.match(/<testsuite\b([^>]*)>/)?.[1];
  const count = (name) => {
    const value = suite?.match(new RegExp(`\\b${name}="([0-9]+)"`))?.[1];
    if (value === undefined)
      throw new Error("Native tracking test report is incomplete");
    return Number(value);
  };
  const tests = count("tests");
  if (
    tests < 1 ||
    count("skipped") !== 0 ||
    count("errors") !== 0 ||
    count("failures") !== 0
  )
    throw new Error("Native tracking tests did not all execute successfully");
  return tests;
}

function component(root, relative) {
  if (typeof relative !== "string" || !relative || path.isAbsolute(relative))
    throw new Error("Invalid native runtime component path");
  const result = path.resolve(root, relative);
  if (!result.startsWith(root + path.sep))
    throw new Error("Native runtime component escapes its directory");
  return result;
}

function run(
  command,
  args,
  env = process.env,
  { allowFailure = false, windowsVerbatimArguments = false } = {},
) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: project,
      env,
      windowsHide: true,
      windowsVerbatimArguments,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const append = (part) => {
      output = (output + part.toString()).slice(-MAX_OUTPUT);
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      const result = { code, signal, output };
      if (code === 0 || allowFailure) resolve(result);
      else
        reject(
          Object.assign(
            new Error(
              `Native tracking check failed (${path.basename(command)}, ${code ?? signal}):\n${output.slice(-6000)}`,
            ),
            result,
          ),
        );
    });
  });
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

function mavenInvocation(env, platform = process.platform) {
  const executable =
    env.DESKTOP_MAVEN || (platform === "win32" ? "mvn.cmd" : "mvn");
  if (
    typeof executable !== "string" ||
    !executable ||
    /[\0\r\n"]/u.test(executable)
  )
    throw new Error("Invalid DESKTOP_MAVEN executable");
  if (platform !== "win32")
    return {
      command: executable,
      args: [
        "-B",
        "-f",
        "backend/pom.xml",
        "-Dtest=DataTransferTrackingIntegrationTest",
        "test",
      ],
      env,
    };
  // Only the executable is expanded from one environment variable; test arguments are static.
  // No shell:true interpolation, CALL double-expansion, or delayed ! expansion is used.
  return {
    command: env.ComSpec || env.COMSPEC || "cmd.exe",
    args: [
      "/d",
      "/v:off",
      "/s",
      "/c",
      '""%OVOSHI_TRACKING_MAVEN%" -B -f backend\\pom.xml -Dtest=DataTransferTrackingIntegrationTest test"',
    ],
    env: { ...env, OVOSHI_TRACKING_MAVEN: executable },
    windowsVerbatimArguments: true,
  };
}

async function main() {
  if (process.argv.includes("--help")) {
    console.log(
      "Usage: node desktop/scripts/verify-data-tracking.cjs [prepared-runtime-directory]\nOptional: DESKTOP_MAVEN executable; JAVA_HOME. Always creates a disposable loopback test database.",
    );
    return;
  }
  const root = path.resolve(
    process.argv[2] || path.join(__dirname, "../runtime"),
  );
  const manifest = JSON.parse(
    await fs.readFile(path.join(root, "manifest.json"), "utf8"),
  );
  if (
    manifest.schemaVersion !== 1 ||
    manifest.platform !== process.platform ||
    manifest.arch !== process.arch
  )
    throw new Error("Prepared runtime does not match this OS and architecture");
  const initdb = component(root, manifest.postgres?.initdb);
  const pgCtl = component(root, manifest.postgres?.pgCtl);
  const java = component(root, manifest.java);
  await Promise.all([initdb, pgCtl, java].map((file) => fs.access(file)));
  const temporary = await fs.mkdtemp(
    path.join(os.tmpdir(), "ovoshi-tracking-native-"),
  );
  const data = path.join(temporary, "postgres");
  const database = "ovoshi_sync_test_" + randomBytes(12).toString("hex");
  if (!/^ovoshi_sync_test_[a-z0-9]+$/.test(database))
    throw new Error("Test database name is outside the reserved namespace");
  let startAttempted = false;
  let client;
  let mayRemove = true;
  try {
    const port = await freePort();
    await run(initdb, [
      "-D",
      data,
      "-A",
      "trust",
      "-U",
      "sync_test",
      "-E",
      "UTF8",
      "--locale=C",
    ]);
    startAttempted = true;
    await run(pgCtl, [
      "-D",
      data,
      "-l",
      path.join(temporary, "postgres.log"),
      "-o",
      `-h 127.0.0.1 -p ${port} -c unix_socket_directories=`,
      "-w",
      "start",
    ]);
    client = new Client({
      host: "127.0.0.1",
      port,
      user: "sync_test",
      database: "postgres",
      password: "",
      ssl: false,
    });
    await client.connect();
    await client.query('CREATE DATABASE "' + database + '"');
    await client.end();
    client = null;
    const invocation = mavenInvocation({
      ...process.env,
      JAVA_HOME: process.env.JAVA_HOME || path.dirname(path.dirname(java)),
      OVOSHI_SYNC_TEST_URL: `jdbc:postgresql://127.0.0.1:${port}/${database}`,
      OVOSHI_SYNC_TEST_USER: "sync_test",
    });
    // A stale successful report or skipped conditional test cannot count as a native pass.
    await fs.rm(TEST_REPORT, { force: true });
    const result = await run(
      invocation.command,
      invocation.args,
      invocation.env,
      invocation,
    );
    const tests = assertExecutedReport(await fs.readFile(TEST_REPORT, "utf8"));
    const summary = result.output
      .split(/\r?\n/)
      .filter((line) => /Tests run:|BUILD SUCCESS|Total time:/.test(line));
    console.log(summary.join("\n"));
    console.log(
      `${tests} native data tracking integration checks passed on ${process.platform}/${process.arch}, none skipped`,
    );
  } finally {
    if (client) await client.end().catch(() => {});
    if (startAttempted) {
      const stopped = await run(
        pgCtl,
        ["-D", data, "-m", "fast", "-w", "stop"],
        process.env,
        { allowFailure: true },
      );
      if (stopped.code !== 0) {
        const status = await run(pgCtl, ["-D", data, "status"], process.env, {
          allowFailure: true,
        });
        if (status.code !== 3) {
          mayRemove = false;
          throw new Error(
            "Disposable PostgreSQL could not be confirmed stopped; temporary cluster retained: " +
              temporary,
          );
        }
      }
    }
    if (mayRemove) await fs.rm(temporary, { recursive: true, force: true });
  }
}

if (require.main === module)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = { component, mavenInvocation, assertExecutedReport, main };
