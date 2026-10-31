import { spawn } from "node:child_process";
import { GitGraphActionError, validateGitGraphRef } from "@/lib/git-graph-actions";
import { gitGraphErrorResponse, requireGitGraphRepository } from "@/lib/git-graph-access";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const root = await requireGitGraphRepository(url.searchParams.get("cwd"));
    const ref = url.searchParams.get("ref");
    if (!ref) throw new GitGraphActionError("invalid_request", "ref is required");
    // Pin the archive to the verified object, not a potentially ambiguous short name.
    const sha = await validateGitGraphRef(root, ref, ["heads", "remotes", "tags"]);
    const env = { ...process.env };
    delete env.PI_WEB_PASSWORD;
    const child = spawn("git", ["-C", root, "archive", "--format=zip", sha], { stdio: ["ignore", "pipe", "ignore"], env });
    const timer = setTimeout(() => child.kill(), 30_000);
    let ended = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        child.stdout.on("data", (chunk: Buffer) => {
          if (ended) return;
          controller.enqueue(new Uint8Array(chunk));
          if ((controller.desiredSize ?? 0) <= 0) child.stdout.pause();
        });
        child.once("error", (error) => { if (!ended) { ended = true; clearTimeout(timer); controller.error(error); } });
        child.once("close", (code) => {
          if (ended) return;
          ended = true;
          clearTimeout(timer);
          if (code === 0) controller.close();
          else controller.error(new Error("Git archive failed"));
        });
      },
      pull() { child.stdout.resume(); },
      cancel() { ended = true; clearTimeout(timer); child.kill(); },
    });
    return new Response(stream, { headers: { "Content-Type": "application/zip", "Content-Disposition": 'attachment; filename="git-archive.zip"', "Cache-Control": "no-store" } });
  } catch (error) {
    return gitGraphErrorResponse(error);
  }
}
