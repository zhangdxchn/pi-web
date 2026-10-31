import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { posix, win32 } from "node:path";
import { spawn } from "node:child_process";
import { sanitizeProjectCommandEnvironment } from "./project-command-env";

export type ApplicationTarget = { kind: "vscode" } | { kind: "custom"; path: string };

/** The application is data, never a shell command or a list of arguments. */
export function parseApplicationTarget(value: unknown): ApplicationTarget | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entry = value as Record<string, unknown>;
  if (entry.kind === "vscode") return { kind: "vscode" };
  if (entry.kind === "custom" && typeof entry.path === "string" && entry.path.trim()) {
    return { kind: "custom", path: entry.path.trim() };
  }
  return null;
}

/** Known locations, not shell commands; custom installations can be added in the menu. */
export function visualStudioCodeCandidates(
  platform: string,
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
): string[] {
  if (platform === "darwin") {
    return [posix.join("/Applications", "Visual Studio Code.app"), posix.join(home, "Applications", "Visual Studio Code.app")];
  }
  if (platform === "win32") {
    return [env.LOCALAPPDATA, env.ProgramFiles, env["ProgramFiles(x86)"]]
      .filter((root): root is string => Boolean(root))
      .map((root, index) => index === 0 && root === env.LOCALAPPDATA
        ? win32.join(root, "Programs", "Microsoft VS Code", "Code.exe")
        : win32.join(root, "Microsoft VS Code", "Code.exe"));
  }
  if (platform === "linux") {
    return (env.PATH ?? "").split(posix.delimiter).filter(posix.isAbsolute).map((directory) => posix.join(directory, "code"));
  }
  return [];
}

/** Validate a bundle or executable without running it. */
export async function isApplicationAvailable(platform: string, appPath: string): Promise<boolean> {
  const absolute = platform === "win32" ? win32.isAbsolute(appPath) : posix.isAbsolute(appPath);
  if (!absolute || appPath.includes("\0")) return false;
  if (platform === "darwin" && !appPath.toLowerCase().endsWith(".app")) return false;
  if (platform === "win32" && !appPath.toLowerCase().endsWith(".exe")) return false;
  if (platform !== "darwin" && platform !== "win32" && platform !== "linux") return false;
  try {
    const info = await stat(appPath);
    if (platform === "darwin") return info.isDirectory();
    if (!info.isFile()) return false;
    if (platform === "linux") await access(appPath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function findVisualStudioCode(
  platform: string = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
): Promise<string | null> {
  for (const candidate of visualStudioCodeCandidates(platform, env, home)) {
    if (await isApplicationAvailable(platform, candidate)) return candidate;
  }
  return null;
}

/** Construct an argv array, including when paths contain spaces or shell metacharacters. */
export function applicationCommand(platform: string, appPath: string, target: string): { command: string; args: string[] } {
  return platform === "darwin"
    ? { command: "/usr/bin/open", args: ["-a", appPath, target] }
    : { command: appPath, args: [target] };
}

/** Start a validated application. macOS's short-lived `open` reports Launch Services errors on exit. */
export function launchApplication(appPath: string, target: string, platform: NodeJS.Platform = process.platform): Promise<void> {
  const spec = applicationCommand(platform, appPath, target);
  return new Promise((resolve, reject) => {
    const child = spawn(spec.command, spec.args, {
      detached: platform !== "darwin",
      stdio: "ignore",
      env: sanitizeProjectCommandEnvironment(process.env, platform),
    });
    child.once("error", reject);
    if (platform === "darwin") {
      child.once("exit", (code) => code === 0 ? resolve() : reject(new Error("application-launch-failed")));
    } else {
      child.once("spawn", () => { child.unref(); resolve(); });
    }
  });
}
