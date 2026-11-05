"use client";

import { memo, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { isPlainActivation, sessionDeepLink } from "@/lib/session-links";
import { useI18n } from "@/hooks/useI18n";

interface SessionLinkPillProps {
  sessionId: string;
  href?: string;
  label?: string;
  children?: ReactNode;
  onSelect?: (sessionId: string) => void;
  resolveTitle?: (sessionId: string) => string | undefined;
}

export const SessionLinkPill = memo(function SessionLinkPill({
  sessionId,
  href,
  label,
  children,
  onSelect,
  resolveTitle,
}: SessionLinkPillProps) {
  const { t } = useI18n();

  const resolved = resolveTitle?.(sessionId);
  let displayTitle = resolved;

  if (!displayTitle) {
    if (label && label !== href && !label.includes(sessionId) && !label.startsWith("http")) {
      displayTitle = label.replace(/^💬\s*/, "");
    } else {
      displayTitle = t("chat.sessionPill", { id: sessionId.slice(0, 8) });
    }
  }

  const tooltip = `${displayTitle}\n${t("chat.clickToOpenSession")}`;

  const handleClick = (event: ReactMouseEvent<HTMLAnchorElement>) => {
    if (isPlainActivation(event.nativeEvent)) {
      event.preventDefault();
      if (onSelect) {
        onSelect(sessionId);
      } else {
        window.location.href = sessionDeepLink(sessionId);
      }
    }
  };

  return (
    <a
      href={href ?? sessionDeepLink(sessionId)}
      className="session-link-pill"
      title={tooltip}
      onClick={handleClick}
      role="link"
    >
      <span className="session-link-pill-icon" aria-hidden="true">
        💬
      </span>
      <span className="session-link-pill-title">
        {displayTitle}
      </span>
      {children && typeof children !== "string" && (
        <span className="sr-only">{children}</span>
      )}
    </a>
  );
});
