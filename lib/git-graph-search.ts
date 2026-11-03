import { formatCommitDate, WORKING_TREE_NODE_ID, type GraphRowData } from "./git-graph-model";

export interface GitGraphMatchRange { start: number; end: number }

export interface GitGraphSearchMatch {
  sha: string;
  rowIndex: number;
  subject: GitGraphMatchRange[];
  refs: GitGraphMatchRange[][];
  author: GitGraphMatchRange[];
  date: GitGraphMatchRange[];
  shortSha: GitGraphMatchRange[];
}

export interface GitGraphSearchResult {
  matches: GitGraphSearchMatch[];
  error: "invalid-pattern" | "empty-match" | null;
}

/** Find in loaded rows, without changing the rows or their graph connections. */
export function findGitGraphMatches(
  rows: readonly GraphRowData[],
  query: string,
  caseSensitive: boolean,
  useRegex: boolean,
): GitGraphSearchResult {
  if (!query) return { matches: [], error: null };
  let expression: RegExp;
  try {
    const source = useRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    expression = new RegExp(source, caseSensitive ? "gu" : "giu");
  } catch {
    return { matches: [], error: "invalid-pattern" };
  }

  let hasEmptyMatch = false;
  const ranges = (text: string): GitGraphMatchRange[] => {
    expression.lastIndex = 0;
    const found: GitGraphMatchRange[] = [];
    let match: RegExpExecArray | null;
    while ((match = expression.exec(text)) !== null) {
      if (match[0].length === 0) {
        hasEmptyMatch = true;
        break;
      }
      found.push({ start: match.index, end: expression.lastIndex });
    }
    return found;
  };

  // Test the empty string too, even in an empty repository.
  ranges("");
  const matches: GitGraphSearchMatch[] = [];
  for (const [rowIndex, row] of rows.entries()) {
    const commit = row.commit;
    if (commit.sha === WORKING_TREE_NODE_ID) continue;
    const subject = ranges(commit.subject);
    const refs = commit.refs.map((ref) => ranges(ref.name));
    const author = ranges(commit.author);
    const date = ranges(formatCommitDate(commit.committedAt));
    const shortSha = ranges(commit.shortSha);
    // As in Git Graph, a full SHA can be found by its prefix even when that
    // prefix extends beyond the abbreviation displayed in the table.
    const fullSha = ranges(commit.sha);
    const fullShaPrefix = fullSha.some((range) => range.start === 0);
    if (fullShaPrefix && shortSha.length === 0) shortSha.push({ start: 0, end: commit.shortSha.length });
    if (subject.length || refs.some((ref) => ref.length) || author.length || date.length || shortSha.length) {
      matches.push({ sha: commit.sha, rowIndex, subject, refs, author, date, shortSha });
    }
    if (hasEmptyMatch) break;
  }
  return hasEmptyMatch ? { matches: [], error: "empty-match" } : { matches, error: null };
}
