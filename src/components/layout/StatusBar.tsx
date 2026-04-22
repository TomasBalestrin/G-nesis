interface StatusBarProps {
  status?: string;
}

export function StatusBar({ status = "Idle" }: StatusBarProps) {
  return (
    <footer
      role="status"
      aria-live="polite"
      className="h-8 border-t border-border bg-[var(--bg-subtle)] flex items-center px-4 text-xs text-[var(--text-2)]"
    >
      <span>
        <span className="font-semibold text-[var(--text)]">Status:</span>{" "}
        {status}
      </span>
    </footer>
  );
}
