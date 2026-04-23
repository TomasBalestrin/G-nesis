import { useEffect, useRef } from "react";

interface LogViewerProps {
  lines: string[];
  /** Rendered in red at the end of the buffer. Currently used for step errors. */
  stderr?: string | null;
}

/**
 * Monospace log viewer with auto-scroll to the bottom as new lines arrive.
 * stderr text is rendered separately in the error color so the user can
 * spot failures without parsing the full buffer.
 */
export function LogViewer({ lines, stderr }: LogViewerProps) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
  }, [lines.length, stderr]);

  if (lines.length === 0 && !stderr) {
    return (
      <div className="bg-[var(--code-bg)] p-4 font-mono text-xs italic text-[var(--text-3)]">
        Sem logs ainda.
      </div>
    );
  }

  return (
    <div className="max-h-80 overflow-y-auto bg-[var(--code-bg)] p-3 font-mono text-xs">
      {lines.map((line, i) => (
        <div
          key={i}
          className="whitespace-pre-wrap break-words text-[var(--code-tx)]"
        >
          {line || " "}
        </div>
      ))}
      {stderr ? (
        <div className="mt-2 whitespace-pre-wrap break-words text-[var(--status-error-tx)]">
          {stderr}
        </div>
      ) : null}
      <div ref={endRef} />
    </div>
  );
}
