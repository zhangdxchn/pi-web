// These repairs only insert quotes around plain flowchart text. They never
// rewrite identifiers, links, shapes or the original source held by callers.
const SIMPLE_TEXT = /^[A-Za-z0-9_\u00C0-\uFFFF .,/+:()\-]+$/;
const ID_CHAR = /[A-Za-z0-9_\u00C0-\uFFFF-]/;
const ID_START = /[A-Za-z_\u00C0-\uFFFF]/;

function isPlainParenthesizedText(text: string): boolean {
  if (!text || !SIMPLE_TEXT.test(text) || /[\u2028\u2029]/.test(text)) return false;
  let depth = 0;
  let found = false;
  for (const char of text) {
    if (char === "(") {
      if (depth !== 0) return false;
      depth = 1;
      found = true;
    } else if (char === ")") {
      if (depth !== 1) return false;
      depth = 0;
    }
  }
  return found && depth === 0;
}

/** Tracks quoted or Markdown labels across lines; comment contents are ignored. */
function inspectQuotedLine(line: string, state: { quote: string | null }): boolean {
  let protectedLine = state.quote !== null;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (state.quote) {
      if (char === "\\") index++;
      else if (char === state.quote) state.quote = null;
    } else if (char === "%" && line[index + 1] === "%") {
      return true;
    } else if (char === '"' || char === "`") {
      state.quote = char;
      protectedLine = true;
    }
  }
  return protectedLine;
}

function quoteSubgraph(line: string, source: string): string {
  const match = /^([ \t]*subgraph[ \t]+)(.*?)([ \t]*)$/i.exec(line);
  if (!match) return line;
  const [, prefix, title, trailing] = match;
  if (!/[ \t]/.test(title) || !isPlainParenthesizedText(title)) return line;
  const firstWord = title.split(/[ \t]+/, 1)[0];
  // An implicit subgraph may be referenced by a name or its generated ID.
  // In that case there is no safe way to infer the intended identifier.
  if (source.indexOf(firstWord) !== source.lastIndexOf(firstWord) || /\bsubGraph\d+\b/i.test(source)) return line;
  return `${prefix}"${title}"${trailing}`;
}

function quoteRectangularNodes(line: string): string {
  if (
    /[{}'\\]/.test(line)
    || /[A-Za-z0-9_\u00C0-\uFFFF][ \t]*>/.test(line)
    || /^[ \t]*(?:subgraph|style|classDef|class|linkStyle|click|direction|accTitle|accDescr)\b/i.test(line)
  ) return line;
  const insertions: number[] = [];
  let pipe = false;
  let roundDepth = 0;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (char === "|") {
      pipe = !pipe;
      continue;
    }
    if (pipe) continue;
    if (char === "(") { roundDepth++; continue; }
    if (char === ")") {
      if (roundDepth === 0) return line;
      roundDepth--;
      continue;
    }
    if (char !== "[") continue;

    let depth = 1;
    let nested = false;
    let close = index + 1;
    for (; close < line.length && depth > 0; close++) {
      if (line[close] === "[") { depth++; nested = true; }
      else if (line[close] === "]") depth--;
    }
    if (depth !== 0) return line;
    const end = close - 1;
    const label = line.slice(index + 1, end);
    let beforeId = index - 1;
    while (beforeId >= 0 && ID_CHAR.test(line[beforeId])) beforeId--;
    const id = line.slice(beforeId + 1, index);
    const prefix = line.slice(0, beforeId + 1);
    const nodePosition = !prefix.trim() || /(?:-->|---|==>|-\.->)(?:\|[^|]*\|)?[ \t]*$/.test(prefix);
    const idBoundary = beforeId < 0 || !/[.\-@]/.test(line[beforeId]);
    if (
      !roundDepth && !nested && id && ID_START.test(id[0]) && idBoundary && nodePosition
      && !/^[ \t]*[(/]/.test(label) && isPlainParenthesizedText(label)
    ) {
      insertions.push(index + 1, end);
    }
    index = end;
  }
  if (pipe || roundDepth) return line;
  let output = "";
  let start = 0;
  for (const position of insertions) {
    output += line.slice(start, position) + '"';
    start = position;
  }
  return output + line.slice(start);
}

/** Returns a conservative, preview-only candidate, or null when no rule applies. */
export function repairMermaidSyntax(code: string): string | null {
  // Directives can span lines and are outside these two small repair rules.
  if (code.includes("%%{")) return null;
  const parts = code.split(/(\r\n|\r|\n)/);
  let lineIndex = 0;
  if (parts[0]?.trim() === "---") {
    lineIndex = 2;
    while (lineIndex < parts.length && parts[lineIndex].trim() !== "---") lineIndex += 2;
    if (lineIndex >= parts.length) return null;
    lineIndex += 2;
  }
  while (lineIndex < parts.length && (!parts[lineIndex].trim() || /^[ \t]*%%/.test(parts[lineIndex]))) lineIndex += 2;
  if (!/^[ \t]*(?:graph|flowchart)[ \t]+(?:TB|TD|BT|RL|LR)[ \t]*;?[ \t]*$/i.test(parts[lineIndex] ?? "")) return null;

  const state: { quote: string | null } = { quote: null };
  let changed = false;
  for (lineIndex += 2; lineIndex < parts.length; lineIndex += 2) {
    const line = parts[lineIndex];
    if (inspectQuotedLine(line, state)) continue;
    const next = /^[ \t]*subgraph\b/i.test(line) ? quoteSubgraph(line, code) : quoteRectangularNodes(line);
    if (next !== line) {
      parts[lineIndex] = next;
      changed = true;
    }
  }
  return changed ? parts.join("") : null;
}
