const { spawn } = require("node:child_process");

const [executable, ...args] = process.argv.slice(2);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(executable, args, {
  stdio: "inherit",
  env,
  windowsHide: true,
});
let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  child.kill("SIGTERM");
  setTimeout(() => {
    if (process.platform === "win32") {
      const killer = spawn(
        "taskkill",
        ["/PID", String(child.pid), "/T", "/F"],
        { windowsHide: true, stdio: "ignore" },
      );
      killer.on("exit", () => process.exit(1));
    } else child.kill("SIGKILL");
  }, 35000).unref();
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
process.on("disconnect", stop);
process.on("message", (message) => {
  if (message?.type === "stop") stop();
});
child.on("error", () => process.exit(1));
child.on("exit", (code) => process.exit(code ?? (stopping ? 0 : 1)));
