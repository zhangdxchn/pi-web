import { performGitGraphAction, GitGraphActionError } from "@/lib/git-graph-actions";
import { gitGraphErrorResponse, requireGitGraphRepository } from "@/lib/git-graph-access";

export async function POST(request: Request) {
  try {
    let body: unknown;
    try { body = await request.json(); }
    catch { throw new GitGraphActionError("invalid_request", "Invalid JSON"); }
    const cwd = body && typeof body === "object" && !Array.isArray(body) ? (body as { cwd?: unknown }).cwd : null;
    const root = await requireGitGraphRepository(cwd);
    await performGitGraphAction(root, body);
    return Response.json({ ok: true });
  } catch (error) {
    return gitGraphErrorResponse(error);
  }
}
