import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Terminal as XTerm } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import { WebLinksAddon } from "xterm-addon-web-links";
import "xterm/css/xterm.css";

import { useToast } from "@/hooks/useToast";
import {
  terminalKill,
  terminalResize,
  terminalSpawn,
  terminalWrite,
} from "@/lib/tauri-bridge";
import type { TerminalDataEvent, TerminalExitEvent } from "@/types/events";

/**
 * Embedded interactive terminal. Owns one xterm.js instance and one PTY
 * session in the Rust side. Lifecycle:
 *   1. mount → spawn PTY + xterm + fit addon, wire bidirectional pipe
 *   2. resize observer fires → call `term.fit()` + `terminal_resize` IPC
 *   3. unmount → `terminal_kill` + dispose xterm + cleanup listeners
 *
 * Bytes from Rust come in as `number[]` (serde Vec<u8>); we wrap them in a
 * Uint8Array so xterm receives the raw stream without UTF-8 corruption.
 * Bytes typed by the user go back as `Array.from(TextEncoder)`.
 *
 * Theme: greenish on dark, mirroring `--code-bg` / `--code-tx`. The xterm
 * `theme` field doesn't pull from CSS variables (xterm reads colors at
 * init), so we hardcode-but-document the values here.
 */
export function TerminalPanel() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const [exited, setExited] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new XTerm({
      fontFamily: "JetBrains Mono, Fira Code, ui-monospace, monospace",
      fontSize: 13,
      cursorBlink: true,
      // Deliberately readable on the design-system dark bg. Light mode would
      // need a separate theme — leaves an opening for a future polish task.
      theme: {
        background: "#1a1815",
        foreground: "#e4e0db",
        cursor: "#7898EF",
        cursorAccent: "#1a1815",
        selectionBackground: "rgba(120, 152, 239, 0.35)",
        black: "#1a1815",
        red: "#ef4444",
        green: "#22c55e",
        yellow: "#f59e0b",
        blue: "#4A76EA",
        magenta: "#a78bfa",
        cyan: "#3b82f6",
        white: "#e4e0db",
        brightBlack: "#57534d",
        brightRed: "#ef4444",
        brightGreen: "#22c55e",
        brightYellow: "#f59e0b",
        brightBlue: "#7898EF",
        brightMagenta: "#c4b5fd",
        brightCyan: "#60a5fa",
        brightWhite: "#f0ede8",
      },
    });
    const fit = new FitAddon();
    const links = new WebLinksAddon();
    term.loadAddon(fit);
    term.loadAddon(links);
    term.open(containerRef.current);
    termRef.current = term;
    fitRef.current = fit;

    // Run fit once the element is in the DOM with real dimensions. Calling
    // before layout produces zero rows and the PTY rejects the spawn.
    const initialDims = (() => {
      try {
        fit.fit();
        return { rows: term.rows, cols: term.cols };
      } catch {
        return { rows: 24, cols: 80 };
      }
    })();

    let unlistenData: (() => void) | undefined;
    let unlistenExit: (() => void) | undefined;
    let cancelled = false;
    let resizeObserver: ResizeObserver | null = null;

    const encoder = new TextEncoder();

    (async () => {
      try {
        const id = await terminalSpawn({
          rows: initialDims.rows,
          cols: initialDims.cols,
          cwd: null,
        });
        if (cancelled) {
          await terminalKill({ sessionId: id }).catch(() => {});
          return;
        }
        sessionIdRef.current = id;

        // Stream PTY bytes → xterm. listen() resolves to an unlisten fn.
        unlistenData = await listen<TerminalDataEvent>("terminal:data", (e) => {
          if (e.payload.session_id !== id) return;
          term.write(new Uint8Array(e.payload.data));
        });
        unlistenExit = await listen<TerminalExitEvent>("terminal:exit", (e) => {
          if (e.payload.session_id !== id) return;
          setExited(true);
          term.write(
            "\r\n\x1b[33m[sessão encerrada — recarregue a página pra abrir uma nova]\x1b[0m\r\n",
          );
        });

        // xterm → PTY. onData fires for keystrokes, paste, signal sequences.
        term.onData((data) => {
          terminalWrite({
            sessionId: id,
            data: Array.from(encoder.encode(data)),
          }).catch(() => {});
        });

        // ResizeObserver bridges container resize → fit → IPC. Throttling
        // not strictly needed because resize is cheap (kernel ioctl), but
        // we coalesce via requestAnimationFrame to skip layout thrash.
        let pending = 0;
        resizeObserver = new ResizeObserver(() => {
          if (pending) return;
          pending = requestAnimationFrame(() => {
            pending = 0;
            try {
              fit.fit();
              if (sessionIdRef.current) {
                void terminalResize({
                  sessionId: sessionIdRef.current,
                  rows: term.rows,
                  cols: term.cols,
                });
              }
            } catch {
              // fit can throw when the container has zero size mid-transition
            }
          });
        });
        if (containerRef.current) {
          resizeObserver.observe(containerRef.current);
        }
      } catch (err) {
        toast({
          title: "Falha ao abrir terminal",
          description: err instanceof Error ? err.message : String(err),
          variant: "destructive",
        });
      }
    })();

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      unlistenData?.();
      unlistenExit?.();
      const id = sessionIdRef.current;
      sessionIdRef.current = null;
      if (id) {
        void terminalKill({ sessionId: id });
      }
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [toast]);

  return (
    <div className="flex h-full flex-col bg-[var(--bg-primary)]">
      <header className="flex items-center justify-between border-b border-border px-6 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">Terminal</h2>
          <p className="text-xs text-[var(--text-secondary)]">
            Shell interativo no diretório do usuário ($SHELL).
          </p>
        </div>
        {exited ? (
          <span className="rounded-full bg-[var(--warning-soft)] px-2 py-0.5 text-[11px] font-semibold text-[var(--warning)]">
            encerrada
          </span>
        ) : null}
      </header>
      <div className="flex-1 overflow-hidden p-2">
        <div
          ref={containerRef}
          className="h-full w-full overflow-hidden rounded-lg bg-[#1a1815] p-2"
        />
      </div>
    </div>
  );
}
