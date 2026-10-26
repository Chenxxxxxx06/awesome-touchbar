"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
const { spawn } = require("node:child_process");
const { StringDecoder } = require("node:string_decoder");
const NAMES = { codex: "Codex", claude: "Claude Code", pi: "Pi" };
function launchSpec(executable, args) {
  if (/\.cmd$/i.test(executable)) {
    if (
      /["\r\n%&|<>^!]/.test(executable) ||
      args.some((a) => /["\r\n%&|<>^!]/.test(a))
    )
      throw new Error("启动参数不受支持");
    return {
      file: process.env.ComSpec || "C:\\Windows\\System32\\cmd.exe",
      args: [
        "/d",
        "/s",
        "/c",
        '"' + [executable, ...args].map((a) => '"' + a + '"').join(" ") + '"',
      ],
      windowsVerbatimArguments: true,
    };
  }
  return { file: executable, args, windowsVerbatimArguments: false };
}
function runProcess(
  executable,
  args,
  { cwd, input = "", timeout = 180000, signal, env = process.env } = {},
) {
  return new Promise((resolve, reject) => {
    const spec = launchSpec(executable, args),
      child = spawn(spec.file, spec.args, {
        cwd,
        env,
        windowsHide: true,
        windowsVerbatimArguments: spec.windowsVerbatimArguments,
        stdio: ["pipe", "pipe", "pipe"],
        shell: false,
      });
    let settled = false,
      total = 0,
      out = "",
      err = "";
    const outDecoder = new StringDecoder("utf8"),
      errDecoder = new StringDecoder("utf8");
    const kill = () => {
      if (!child.pid) return;
      if (process.platform === "win32")
        spawn(
          path.join(
            process.env.SystemRoot || "C:\\Windows",
            "System32",
            "taskkill.exe",
          ),
          ["/PID", String(child.pid), "/T", "/F"],
          { windowsHide: true, stdio: "ignore" },
        ).on("error", () => {});
      else child.kill("SIGKILL");
    };
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      error ? reject(error) : resolve(result);
    };
    const abort = () => {
      kill();
      finish(new Error("已取消生成"));
    };
    const timer = setTimeout(() => {
      kill();
      finish(new Error("AI 响应超时，未安装组件；可重试或换一个工具"));
    }, timeout);
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
    const data = (decoder, kind, chunk) => {
      total += chunk.length;
      if (total > 1024 * 1024) {
        kill();
        finish(new Error("AI 输出超出大小限制"));
        return;
      }
      if (kind === "out") out += decoder.write(chunk);
      else err += decoder.write(chunk);
    };
    child.stdout.on("data", (c) => data(outDecoder, "out", c));
    child.stderr.on("data", (c) => data(errDecoder, "err", c));
    child.on("error", () =>
      finish(new Error("无法启动此 AI 工具，请检查安装")),
    );
    child.on("close", (code) =>
      finish(null, {
        code,
        stdout: out + outDecoder.end(),
        stderr: err + errDecoder.end(),
      }),
    );
    child.stdin.on("error", () => {});
    child.stdin.end(input, "utf8");
  });
}
function locate(id) {
  const roots = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  const local = process.env.LOCALAPPDATA,
    home = os.homedir();
  roots.push(path.join(home, ".local", "bin"));
  if (local) roots.push(path.join(local, "Programs", "AI-CLI", "bin"));
  if (local && id === "codex")
    try {
      for (const dir of fs.readdirSync(
        path.join(local, "OpenAI", "Codex", "bin"),
      ))
        roots.push(path.join(local, "OpenAI", "Codex", "bin", dir));
    } catch {}
  for (const root of [...new Set(roots)])
    for (const ext of process.platform === "win32" ? [".exe", ".cmd"] : [""]) {
      const f = path.join(root, id + ext);
      try {
        if (fs.statSync(f).isFile()) return f;
      } catch {}
    }
  return null;
}
function options(id, model, output) {
  if (model && !/^[a-zA-Z0-9][a-zA-Z0-9._/:+-]{0,119}$/.test(model))
    throw new Error("模型 ID 格式无效");
  let args;
  if (id === "codex")
    args = [
      "exec",
      "--skip-git-repo-check",
      "--ephemeral",
      "--ignore-user-config",
      "--sandbox",
      "read-only",
      "--color",
      "never",
      "--disable",
      "shell_tool",
      "--disable",
      "apps",
      "--disable",
      "hooks",
      "--disable",
      "browser_use",
      "--disable",
      "computer_use",
      "--disable",
      "image_generation",
      "-c",
      "project_doc_max_bytes=0",
      "-c",
      "web_search=disabled",
      "-o",
      output,
      "-",
    ];
  else if (id === "claude")
    args = [
      "--print",
      "--output-format",
      "json",
      "--no-session-persistence",
      "--safe-mode",
      "--strict-mcp-config",
      "--tools",
      "",
    ];
  else if (id === "pi")
    args = [
      "--print",
      "--no-session",
      "--no-tools",
      "--no-extensions",
      "--no-skills",
      "--no-prompt-templates",
      "--no-context-files",
    ];
  else throw new Error("不支持的 AI 工具");
  if (model) {
    if (id === "codex") args.splice(args.length - 1, 0, "--model", model);
    else args.push("--model", model);
  }
  return args;
}
async function discover() {
  return (
    await Promise.all(
      Object.keys(NAMES).map(async (id) => {
        const executable = locate(id);
        if (!executable) return null;
        try {
          const result = await runProcess(executable, ["--help"], {
            timeout: 25000,
          });
          const help = result.stdout + result.stderr;
          const required =
            id === "codex"
              ? ["exec"]
              : id === "claude"
                ? ["--safe-mode", "--tools", "--print"]
                : ["--no-tools", "--no-context-files", "--no-extensions"];
          if (
            result.code !== 0 ||
            !required.every((flag) => help.includes(flag))
          )
            return null;
          return {
            id,
            name: NAMES[id],
            executable,
            status: "已安装 · 登录状态由首次调用验证",
          };
        } catch {
          return null;
        }
      }),
    )
  ).filter(Boolean);
}
async function generate(tool, { prompt, model = "", signal }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "touchbar-diy-")),
    output = path.join(dir, "result.txt");
  try {
    // Only the local CLI handles its normal authentication. No auth files are read here.
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.CLAUDECODE;
    const result = await runProcess(
      tool.executable,
      options(tool.id, model, output),
      { cwd: dir, input: prompt, signal, env },
    );
    if (result.code !== 0) {
      if (tool.id === "claude") {
        let info;
        try {
          info = JSON.parse(result.stdout);
        } catch {}
        if (
          info?.api_error_status === 403 &&
          /paused|unavailable/i.test(info.result || "")
        )
          throw new Error(
            "Claude Code 当前配置的服务已暂停（403），请恢复该服务或选择 Codex / Pi",
          );
      }
      throw new Error(
        "AI 调用失败：请在该工具中检查登录、额度和模型配置，然后重试",
      );
    }
    if (tool.id === "codex") {
      if (!fs.existsSync(output) || fs.statSync(output).size > 40000)
        throw new Error("Codex 未生成有效结果");
      return fs.readFileSync(output, "utf8");
    }
    if (tool.id === "claude") {
      let value;
      try {
        value = JSON.parse(result.stdout);
      } catch {
        throw new Error("Claude Code 输出格式不兼容");
      }
      if (value.is_error)
        throw new Error("Claude Code 调用失败，请检查登录或额度");
      return typeof value.structured_output === "object"
        ? JSON.stringify(value.structured_output)
        : value.result;
    }
    return result.stdout;
  } finally {
    const resolved = path.resolve(dir);
    if (
      path.dirname(resolved) === path.resolve(os.tmpdir()) &&
      path.basename(resolved).startsWith("touchbar-diy-")
    )
      try {
        fs.rmSync(resolved, { recursive: true, force: true });
      } catch {
        /* A cancelled CLI may still be releasing its output file. */
      }
  }
}
module.exports = { discover, generate, options, launchSpec, runProcess };
