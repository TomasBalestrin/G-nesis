import { useCallback, useState } from "react";

interface CommandState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

interface UseTauriCommandResult<TArgs extends unknown[], TResult>
  extends CommandState<TResult> {
  execute: (...args: TArgs) => Promise<TResult | null>;
  reset: () => void;
}

/**
 * Wrap a tauri-bridge function with loading/error state so components can
 * render progress without writing boilerplate. Returns null on failure and
 * stores the error message in `error`.
 *
 * @example
 * ```tsx
 * const { data, loading, error, execute } = useTauriCommand(listProjects);
 * useEffect(() => { execute(); }, [execute]);
 * ```
 */
export function useTauriCommand<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
): UseTauriCommandResult<TArgs, TResult> {
  const [state, setState] = useState<CommandState<TResult>>({
    data: null,
    loading: false,
    error: null,
  });

  const execute = useCallback(
    async (...args: TArgs): Promise<TResult | null> => {
      setState((s) => ({ ...s, loading: true, error: null }));
      try {
        const data = await fn(...args);
        setState({ data, loading: false, error: null });
        return data;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setState({ data: null, loading: false, error: message });
        return null;
      }
    },
    [fn],
  );

  const reset = useCallback(() => {
    setState({ data: null, loading: false, error: null });
  }, []);

  return { ...state, execute, reset };
}
