import { GitGraphActionError, getAnnotatedTag } from "@/lib/git-graph-actions";
import { gitGraphErrorResponse, requireGitGraphRepository } from "@/lib/git-graph-access";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const root = await requireGitGraphRepository(url.searchParams.get("cwd"));
    const ref = url.searchParams.get("ref");
    if (!ref) throw new GitGraphActionError("invalid_request", "ref is required");
    return Response.json(await getAnnotatedTag(root, ref));
  } catch (error) {
    return gitGraphErrorResponse(error);
  }
}
