import { stat } from "fs/promises";
import { resolve } from "path";
import { NextResponse } from "next/server";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { isFileManagerSupported, isLoopbackHost, launchFileManager } from "@/lib/open-in-file-manager";
import { findVisualStudioCode, isApplicationAvailable, launchApplication, parseApplicationTarget } from "@/lib/open-in-application";
import { isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Whether this request may raise a file-manager window on the server. */
function availabilityFor(request: Request): { supported: boolean; reason: string | null } {
  if (!isLoopbackHost(request.headers.get("host"))) return { supported: false, reason: "remote" };
  if (!isFileManagerSupported(process.platform)) return { supported: false, reason: "unsupported-platform" };
  return { supported: true, reason: null };
}

/** Lets the sidebar pick the button label and disable it when unavailable. */
export async function GET(request: Request) {
  const { supported, reason } = availabilityFor(request);
  const vscodeAvailable = supported && Boolean(await findVisualStudioCode());
  return NextResponse.json({ supported, reason, platform: process.platform, vscodeAvailable });
}

/** Opens the session workspace in the OS file manager. */
export async function POST(request: Request) {
  try {
    const { supported, reason } = availabilityFor(request);
    if (!supported) {
      return NextResponse.json({ error: reason }, { status: 403 });
    }

    if (!isApiRequestAllowed(request)) {
      return NextResponse.json({ error: "request-denied" }, { status: 403 });
    }
    const body = await request.json() as { cwd?: unknown; application?: unknown } | null;
    if (!body || typeof body.cwd !== "string" || !body.cwd.trim()) {
      return NextResponse.json({ error: "cwd-required" }, { status: 400 });
    }
    const target = resolve(body.cwd);
    // Authorize before touching the path, so a location outside the allowed
    // roots answers 403 whether or not it exists.
    const roots = await getAllowedFileRoots();
    if (!isExistingFilePathAllowed(target, roots)) {
      return NextResponse.json({ error: "access-denied" }, { status: 403 });
    }
    if (!(await stat(target)).isDirectory()) {
      return NextResponse.json({ error: "not-a-directory" }, { status: 400 });
    }

    // An omitted application retains the original file-manager API.
    if (body.application === undefined) {
      await launchFileManager(target);
    } else {
      const application = parseApplicationTarget(body.application);
      if (!application) return NextResponse.json({ error: "application-invalid" }, { status: 400 });
      const appPath = application.kind === "vscode" ? await findVisualStudioCode() : application.path;
      if (!appPath || !(await isApplicationAvailable(process.platform, appPath))) {
        return NextResponse.json({ error: "application-not-found" }, { status: 404 });
      }
      try {
        await launchApplication(appPath, target);
      } catch {
        return NextResponse.json({ error: "application-launch-failed" }, { status: 500 });
      }
    }
    return NextResponse.json({ opened: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
