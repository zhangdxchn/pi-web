/**
 * Links that open a session or a fresh composer of this Pi Web, and the click
 * rule that keeps an ordinary session-link click inside the page.
 *
 * `?session=<id>` alone, resolved against the page the link sits on: the
 * origin and path stay (a sub-path deployment keeps its prefix), and every
 * other query parameter and the hash go. A stale `?cwd=` must go: it wins
 * over `session` in getInitialNavigation() and would open a fresh composer
 * instead. The explicit `session` also wins over a tab's remembered session
 * (withTabOpen()), so a new tab opens the linked session whatever it inherits.
 */

/** A same-instance link to one session; the id is encoded, never a URL of its own. */
export function sessionDeepLink(sessionId: string): string {
  return `?session=${encodeURIComponent(sessionId)}`;
}

/** A full canonical link to one session, using current window origin if available or provided baseUrl. */
export function sessionCanonicalDeepLink(sessionId: string, baseUrl?: string): string {
  const base = baseUrl ?? (typeof window !== "undefined" ? `${window.location.origin}${window.location.pathname}` : "");
  return `${base}${sessionDeepLink(sessionId)}`;
}

/** A custom protocol link (pi://sessions/<id>). */
export function sessionProtocolDeepLink(sessionId: string): string {
  return `pi://sessions/${encodeURIComponent(sessionId)}`;
}

/**
 * Extracts a session ID from a string, URL, or protocol link.
 * Matches:
 *  - pi://sessions/<id>
 *  - codex://threads/<id>
 *  - https?://.../?session=<id> or ?session=<id>
 * Returns decoded sessionId or null.
 */
export function parseSessionDeepLink(raw: string): string | null {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();

  // 1. pi://sessions/<id>
  const piMatch = /^pi:\/\/sessions\/([^/?#\s]+)/i.exec(trimmed);
  if (piMatch) {
    try {
      return decodeURIComponent(piMatch[1]);
    } catch {
      return piMatch[1];
    }
  }

  // 2. codex://threads/<id>
  const codexMatch = /^codex:\/\/threads\/([^/?#\s]+)/i.exec(trimmed);
  if (codexMatch) {
    try {
      return decodeURIComponent(codexMatch[1]);
    } catch {
      return codexMatch[1];
    }
  }

  // 3. Web URL: http(s)://.../?session=<id> or relative ?session=<id>
  try {
    const url = trimmed.startsWith("?") || trimmed.startsWith("/")
      ? new URL(trimmed, "http://localhost")
      : new URL(trimmed);
    const id = url.searchParams.get("session");
    if (id) return id;
  } catch {
    const queryMatch = /[?&]session=([^&#\s]+)/i.exec(trimmed);
    if (queryMatch) {
      try {
        return decodeURIComponent(queryMatch[1]);
      } catch {
        return queryMatch[1];
      }
    }
  }

  return null;
}

/**
 * Regex identifying potential session deep links in plain text.
 * Avoid lookbehinds for Safari 16.2 / iOS compatibility.
 */
const DEEPLINK_FIND_REGEX = /(?:pi:\/\/sessions\/|codex:\/\/threads\/)[^\s"'<>()]+|https?:\/\/[^\s"'<>]+\?[^\s"'<>]*\bsession=[^\s"'<>&]+|\?session=[^\s"'<>&]+/gi;

/**
 * Scans text for session deeplinks (pi://, codex://, or web URLs with ?session=)
 * and replaces them with Markdown links `[💬 <title>](?session=<id>)`.
 * Returns null if no deeplinks were found and replaced.
 */
export function replaceSessionDeepLinksWithMarkdown(
  text: string,
  resolveTitle?: (sessionId: string) => string | undefined,
): string | null {
  if (!text || typeof text !== "string") return null;

  let hasReplacement = false;
  const result = text.replace(DEEPLINK_FIND_REGEX, (matched, offset, fullText) => {
    // Avoid replacing if it's already inside a Markdown link target: `](url)`
    if (offset >= 2 && fullText.slice(offset - 2, offset) === "](") {
      return matched;
    }
    const sessionId = parseSessionDeepLink(matched);
    if (!sessionId) return matched;

    const resolved = resolveTitle?.(sessionId);
    const title = (resolved || `会话 ${sessionId.slice(0, 8)}`).replace(/[[\]]/g, "");
    hasReplacement = true;
    return `[💬 ${title}](${sessionDeepLink(sessionId)})`;
  });

  return hasReplacement ? result : null;
}

/** A same-instance fresh-composer link; cwd wins over any remembered session. */
export function newSessionDeepLink(cwd: string): string {
  return `?cwd=${encodeURIComponent(cwd)}`;
}

export interface ActivationEvent {
  button: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
}

/**
 * A primary-button click (or Enter on a focused link) without modifiers:
 * the page handles it in place. Anything else (Ctrl/Cmd, Shift, Alt, another
 * button) is the browser's: a new tab, a new window, a download, as the user
 * and the browser decide.
 */
export function isPlainActivation(event: ActivationEvent): boolean {
  return !event.defaultPrevented
    && event.button === 0
    && !event.ctrlKey
    && !event.metaKey
    && !event.shiftKey
    && !event.altKey;
}
