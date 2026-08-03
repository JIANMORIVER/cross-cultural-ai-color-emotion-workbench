import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const cacheRoot = path.join(root, ".cache");
mkdirSync(path.join(cacheRoot, "matplotlib"), { recursive: true });
mkdirSync(path.join(cacheRoot, "fontconfig"), { recursive: true });

let python = null;
try {
  const response = await fetch("http://127.0.0.1:8765/health", { signal: AbortSignal.timeout(800) });
  if (!response.ok) throw new Error("unhealthy");
  console.log("沿用已运行的 Python 图片服务：http://127.0.0.1:8765");
} catch {
  python = spawn("python3", [path.join(root, "python_figures", "server.py")], {
    cwd: path.join(root, "python_figures"),
    env: {
      ...process.env,
      MPLCONFIGDIR: path.join(cacheRoot, "matplotlib"),
      XDG_CACHE_HOME: cacheRoot,
    },
    stdio: "inherit",
  });
}

const site = spawn(path.join(root, "node_modules", ".bin", "vinext"), ["dev"], {
  cwd: root,
  env: { ...process.env, WRANGLER_LOG_PATH: ".wrangler/wrangler.log" },
  stdio: "inherit",
});

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  if (python && !python.killed) python.kill("SIGTERM");
  if (!site.killed) site.kill("SIGTERM");
  process.exitCode = code;
}

python?.on("exit", code => {
  if (!stopping && code) {
    console.error("Python 图片服务启动失败。");
    stop(code);
  }
});
site.on("exit", code => stop(code || 0));
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
