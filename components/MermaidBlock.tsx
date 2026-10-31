"use client";

import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { SyntaxHighlighterProps } from "react-syntax-highlighter";
import renderSyntaxNode from "react-syntax-highlighter/dist/esm/create-element";
import SyntaxHighlighter from "react-syntax-highlighter/dist/esm/prism-light";
import { vs } from "react-syntax-highlighter/dist/cjs/styles/prism";
import { vscDarkPlus } from "react-syntax-highlighter/dist/cjs/styles/prism";
import { useTheme } from "@/hooks/useTheme";
import { useI18n } from "@/hooks/useI18n";
import { usePrismLanguages } from "@/hooks/usePrismLanguages";
import { copyText } from "@/lib/clipboard";
import { takeHighlightBudget, waitForHighlight } from "@/lib/highlight-queue";
import { repairMermaidSyntax } from "@/lib/mermaid-syntax-repair";
import { prismLanguagesLoaded } from "@/lib/prism-languages";

interface MermaidBlockProps {
  code: string;
  isStreaming?: boolean;
  defaultPreview?: boolean;
}

const ZOOM_STEP = 0.25;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;

export function downloadSvgFile(xml: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([xml], { type: "image/svg+xml;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function downloadMermaidSvg(svg: SVGSVGElement): void {
  // Mermaid's HTML serialization can leave void tags such as <br> unclosed.
  downloadSvgFile(new XMLSerializer().serializeToString(svg), "mermaid-diagram.svg");
}

type RenderStage = "load" | "parse" | "render";
type RenderState =
  | { key: string; status: "loading" }
  | { key: string; status: "error"; stage: RenderStage; line?: number; unknownType?: boolean; detail?: string }
  | { key: string; status: "ready"; svg: string; repairedCode?: string };

function mermaidParserLine(error: unknown): number | undefined {
  if (!error || typeof error !== "object" || !("hash" in error)) return;
  const hash = error.hash;
  if (!hash || typeof hash !== "object" || !("loc" in hash)) return;
  const loc = hash.loc;
  if (!loc || typeof loc !== "object" || !("first_line" in loc)) return;
  const line = loc.first_line;
  return typeof line === "number" && Number.isInteger(line) && line > 0 ? line : undefined;
}

export function MermaidBlock({ code, isStreaming, defaultPreview = false }: MermaidBlockProps) {
  const { isDark } = useTheme();
  const { t } = useI18n();
  const [showPreview, setShowPreview] = useState(defaultPreview);
  const [renderState, setRenderState] = useState<RenderState | null>(null);
  const [zoomOpen, setZoomOpen] = useState(false);
  const [repairCopied, setRepairCopied] = useState(false);
  const previewRef = useRef<HTMLButtonElement>(null);
  const currentKey = `${isDark ? "dark" : "light"}\n${code}`;
  const previewVisible = showPreview && !isStreaming;

  useEffect(() => {
    if (!previewVisible) return;

    let cancelled = false;
    let stage: RenderStage = "load";
    setRenderState({ key: currentKey, status: "loading" });

    const render = async () => {
      const { default: mermaid } = await import("mermaid");
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        suppressErrorRendering: true,
        theme: isDark ? "dark" : "default",
      });

      // Diagram types load lazily here, so not every parse failure is syntax.
      stage = "parse";
      let repairedCode: string | undefined;
      let originalError: unknown;
      try {
        await mermaid.parse(code);
      } catch (error) {
        if (!mermaidParserLine(error)) throw error;
        originalError = error;
        try {
          const diagramType = mermaid.detectType(code);
          if (diagramType !== "flowchart" && diagramType !== "flowchart-v2") throw error;
          const candidate = repairMermaidSyntax(code);
          if (!candidate) throw error;
          await mermaid.parse(candidate);
          repairedCode = candidate;
        } catch {
          throw error;
        }
      }

      stage = "render";
      const id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? `mermaid-${crypto.randomUUID()}`
          : `mermaid-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      // Mermaid can leave its temporary SVG behind if rendering fails before
      // its own cleanup. Give it a hidden container that we always remove.
      const container = document.createElement("div");
      Object.assign(container.style, { position: "fixed", top: "0", left: "0", width: "100%", visibility: "hidden", pointerEvents: "none" });
      document.body.appendChild(container);
      let result;
      try {
        result = await mermaid.render(id, repairedCode ?? code, container);
      } catch (error) {
        if (repairedCode) {
          stage = "parse";
          throw originalError;
        }
        throw error;
      } finally {
        container.remove();
      }
      if (!cancelled) {
        setRenderState({ key: currentKey, status: "ready", svg: result.svg, repairedCode });
      }
    };

    render().catch((error: unknown) => {
      if (!cancelled) setRenderState({
        key: currentKey,
        status: "error",
        stage,
        line: stage === "parse" ? mermaidParserLine(error) : undefined,
        unknownType: stage === "parse" && error instanceof Error && error.name === "UnknownDiagramError",
        detail: error instanceof Error ? error.message : typeof error === "string" ? error : undefined,
      });
    });

    return () => {
      cancelled = true;
    };
  }, [code, currentKey, isDark, previewVisible]);

  const previewButton = useMemo(() => (
    <PreviewToggleButton
      isStreaming={isStreaming}
      previewVisible={previewVisible}
      onToggle={() => setShowPreview((v) => !v)}
      title={previewVisible ? t("i18n.showMermaidSource") : t("i18n.previewMermaid")}
    />
  ), [isStreaming, previewVisible, t]);

  if (!previewVisible) {
    return <CodeBlock code={code} lang="mermaid" headerAction={previewButton} isStreaming={isStreaming} />;
  }

  const body = renderState?.key === currentKey && renderState.status === "error" ? (
      <div className="mermaid-block mermaid-block-error">
        {renderState.stage === "load" && <div>{t("i18n.mermaidLoadError")}</div>}
        {renderState.stage === "render" && <div>{t("i18n.mermaidRenderError")}</div>}
        {renderState.stage === "parse" && (
          <>
            <div>{t(renderState.line ? "i18n.mermaidSyntaxError" : renderState.unknownType ? "i18n.mermaidUnknownType" : "i18n.mermaidParseError")}</div>
            {renderState.line && <div>{t("i18n.mermaidParserLine", { line: renderState.line })}</div>}
          </>
        )}
        {renderState.detail && (
          <details>
            <summary>{t("i18n.showDetails")}</summary>
            <pre>{renderState.detail}</pre>
          </details>
        )}
      </div>
    ) : renderState?.key !== currentKey || renderState.status !== "ready" ? (
      <div className="mermaid-block mermaid-block-loading" aria-label={t("i18n.renderingMermaid")} />
    ) : (
      <>
        {!zoomOpen && (
          <button
            ref={previewRef}
            type="button"
            className="mermaid-block mermaid-preview-button"
            title={t("i18n.openMermaidViewer")}
            aria-label={t("i18n.openMermaidViewer")}
            onClick={() => setZoomOpen(true)}
            dangerouslySetInnerHTML={{ __html: renderState.svg }}
          />
        )}
        {zoomOpen && (
          <DiagramZoomDialog title={t("i18n.mermaidDiagram")} label={t("i18n.mermaidViewer")} onClose={() => setZoomOpen(false)}>
            <div dangerouslySetInnerHTML={{ __html: renderState.svg }} />
          </DiagramZoomDialog>
        )}
      </>
    );

  return (
    <PreviewFrame
      lang="mermaid"
      actions={
        <>
          {renderState?.key === currentKey && renderState.status === "ready" && renderState.repairedCode && (
            <button
              type="button"
              className="markdown-code-action"
              onClick={() => {
                copyText(renderState.repairedCode!).then(() => {
                  setRepairCopied(true);
                  setTimeout(() => setRepairCopied(false), 1500);
                });
              }}
            >
              {repairCopied ? t("i18n.copied") : t("i18n.copyCorrectedMermaid")}
            </button>
          )}
          {renderState?.key === currentKey && renderState.status === "ready" && (
            <SvgDownloadButton
              onClick={() => {
                const svg = previewRef.current?.querySelector("svg");
                if (svg) downloadMermaidSvg(svg);
              }}
            />
          )}
          {previewButton}
        </>
      }
    >
      {body}
    </PreviewFrame>
  );
}

// What a previewed fence (mermaid here, svg in components/SvgBlock.tsx) shares:
// the header with its toggle and download button, and the zoom viewer.

export function PreviewToggleButton({ isStreaming, previewVisible, onToggle, title }: {
  isStreaming?: boolean;
  previewVisible: boolean;
  onToggle: () => void;
  /** What a click shows: the source while the preview is visible, else the preview. */
  title: string;
}) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={isStreaming}
      title={isStreaming ? t("i18n.previewAfterStreaming") : title}
      className={["markdown-code-action", previewVisible ? "is-active" : ""].filter(Boolean).join(" ")}
    >
      {previewVisible ? t("i18n.source") : t("i18n.preview")}
    </button>
  );
}

export function SvgDownloadButton({ onClick }: { onClick: () => void }) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      className="markdown-code-action"
      title={`${t("i18n.downloadFile")} (SVG)`}
      aria-label={`${t("i18n.downloadFile")} (SVG)`}
      onClick={onClick}
    >
      SVG
    </button>
  );
}

export function PreviewFrame({ lang, actions, children }: { lang: string; actions: ReactNode; children: ReactNode }) {
  return (
    <div className="markdown-code-block">
      <div className="markdown-code-header">
        <span className="markdown-code-lang">{lang}</span>
        <div className="markdown-code-actions">{actions}</div>
      </div>
      {children}
    </div>
  );
}

export function DiagramZoomDialog({ title, label, onClose, children }: {
  title: string;
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();

    return () => {
      document.body.style.overflow = previousOverflow;
      if (dialog.open) dialog.close();
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="mermaid-zoom-dialog"
      aria-label={label}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        onClose();
      }}
    >
      <div className="mermaid-zoom-layout">
        <div className="mermaid-zoom-toolbar">
          <span className="mermaid-zoom-title">{title}</span>
          <div className="mermaid-zoom-actions">
            <div className="mermaid-zoom-stepper">
              <button
                type="button"
                onClick={() => setZoom((value) => Math.max(ZOOM_MIN, value - ZOOM_STEP))}
                disabled={zoom <= ZOOM_MIN}
                title={t("i18n.zoomOut")}
                aria-label={t("i18n.zoomOut")}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M5 12h14" />
                </svg>
              </button>
              <span className="mermaid-zoom-value">{Math.round(zoom * 100)}%</span>
              <button
                type="button"
                onClick={() => setZoom((value) => Math.min(ZOOM_MAX, value + ZOOM_STEP))}
                disabled={zoom >= ZOOM_MAX}
                title={t("i18n.zoomIn")}
                aria-label={t("i18n.zoomIn")}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </button>
            </div>
            <button
              type="button"
              className="mermaid-zoom-icon-button"
              onClick={() => setZoom(1)}
              title={t("i18n.fitToWidth")}
              aria-label={t("i18n.fitToWidth")}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" />
              </svg>
            </button>
            <button
              type="button"
              className="mermaid-zoom-icon-button"
              onClick={onClose}
              title={t("i18n.close")}
              aria-label={t("i18n.close")}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>
        </div>
        <div
          className="mermaid-zoom-viewport"
          onClick={(event) => {
            if (event.target === event.currentTarget) onClose();
          }}
        >
          <div className="mermaid-zoom-canvas" style={{ width: `${zoom * 100}%` }}>
            {children}
          </div>
        </div>
      </div>
    </dialog>
  );
}

interface CodeBlockProps {
  code: string;
  lang: string;
  headerAction?: ReactNode;
  isStreaming?: boolean;
}

// Prism's light theme uses backgroundColor, while its dark theme uses the
// background shorthand. Keep the pre background solely in customStyle so a
// theme switch cannot remove/update one and reset the other in React's diff.
const codeBlockDarkTheme = {
  ...vscDarkPlus,
  'pre[class*="language-"]': {
    ...vscDarkPlus['pre[class*="language-"]'],
  },
};
delete codeBlockDarkTheme['pre[class*="language-"]'].background;

type CodeLinesProps = Parameters<NonNullable<SyntaxHighlighterProps["renderer"]>>[0];

/**
 * A fence's lines, each a row of its number and its text (`.markdown-code-line`
 * in app/globals.css): long lines wrap, as in pi's TUI, and a wrapped line goes
 * on under its own text, never under the number. The text keeps the row's own
 * classes, which color the later lines of a token that spans several (a block
 * comment).
 */
function renderCodeLines({ rows, stylesheet, useInlineStyles }: CodeLinesProps) {
  return rows.map((row, index) => {
    const children = row.children ?? [];
    const number = children[0]?.properties?.className.includes("react-syntax-highlighter-line-number") ? children[0] : null;
    const text = {
      ...row,
      properties: { ...row.properties, className: [...(row.properties?.className ?? []), "markdown-code-line-text"] },
      children: number ? children.slice(1) : children,
    };
    return (
      <span key={index} className="markdown-code-line">
        {number && renderSyntaxNode({ node: number, stylesheet, useInlineStyles, key: "number" })}
        {renderSyntaxNode({ node: text, stylesheet, useInlineStyles, key: "text" })}
      </span>
    );
  });
}

/**
 * Syntax-highlighted code block with copy button.
 * Used as the "source" view for mermaid blocks and for all non-mermaid code fences.
 *
 * Memoized: parent markdown re-renders (e.g. streaming updates elsewhere in
 * the message list) must not re-run Prism tokenization on unchanged code.
 * While the owning message is still streaming, the block renders as plain
 * monospace text — highlighting a growing block re-tokenizes all of it on
 * every chunk, which is the single most expensive part of streamed rendering.
 * A finished block past this task's highlight budget (lib/highlight-queue.ts),
 * or mounted before the Prism languages have loaded (lib/prism-languages.ts),
 * renders through the same highlighter as `text` (same lines, numbers and
 * box, no tokens) until an idle slice lets it take its language.
 */
export const CodeBlock = memo(function CodeBlock({ code, lang, headerAction, isStreaming }: CodeBlockProps) {
  const { isDark } = useTheme();
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  // Loading starts with the first block, streaming or not, so a streamed
  // reply usually finds the languages ready when it ends.
  const languagesReady = usePrismLanguages();
  const [highlighted, setHighlighted] = useState(
    () => !isStreaming && prismLanguagesLoaded() && takeHighlightBudget(code.length),
  );

  useEffect(() => {
    if (isStreaming || highlighted || !languagesReady) return;
    return waitForHighlight(() => setHighlighted(true));
  }, [isStreaming, highlighted, languagesReady]);

  const copy = () => {
    copyText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="markdown-code-block">
      <div className="markdown-code-header">
        <span className="markdown-code-lang">{lang || "text"}</span>
        <div className="markdown-code-actions">
          {headerAction}
          <button
            onClick={copy}
            className="markdown-code-action"
          >
            {copied ? t("i18n.copied") : t("i18n.copy")}
          </button>
        </div>
      </div>
      {isStreaming ? (
        <pre
          style={{
            margin: 0,
            padding: "11px 13px",
            fontSize: "calc(12.5px + var(--chat-font-size-offset, 0px))",
            lineHeight: 1.62,
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
            backgroundColor: "color-mix(in srgb, var(--bg) 92%, var(--bg-panel))",
          }}
        >
          <code style={{ fontFamily: "var(--font-mono)" }}>{code}</code>
        </pre>
      ) : (
        <SyntaxHighlighter
          language={highlighted ? lang || "text" : "text"}
          style={isDark ? codeBlockDarkTheme : vs}
          showLineNumbers
          lineNumberStyle={{ color: "var(--text-dim)", fontStyle: "normal", flexShrink: 0 }}
          renderer={renderCodeLines}
          customStyle={{
            margin: 0,
            padding: "11px 13px",
            fontSize: "calc(12.5px + var(--chat-font-size-offset, 0px))",
            lineHeight: 1.62,
            fontWeight: "var(--font-mono-weight)",
            // The light `vs` theme puts its own 1px #ddd border on <pre>; the
            // block's wrapper already draws the frame.
            border: "none",
            borderRadius: 0,
            backgroundColor: "color-mix(in srgb, var(--bg) 92%, var(--bg-panel))",
          }}
          codeTagProps={{ style: { fontFamily: "var(--font-mono)", fontWeight: "var(--font-mono-weight)" } }}
        >
          {code}
        </SyntaxHighlighter>
      )}
    </div>
  );
});
