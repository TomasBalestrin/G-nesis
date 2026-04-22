import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";

import type { TauriEventMap, TauriEventName } from "@/types/events";

type UnlistenFn = () => void;

/**
 * Subscribe to a Tauri event emitted from the Rust backend. Handles the
 * listen/unlisten lifecycle, including the race when the component unmounts
 * before `listen()` resolves. The callback is stored in a ref, so parents
 * can pass an inline function without triggering re-subscriptions.
 *
 * Known event names from `TauriEventMap` (docs/PRD.md §4) get typed
 * payloads for free. Custom event names fall back to `unknown`.
 *
 * @example
 * ```ts
 * useTauriEvent("execution:step_completed", (event) => {
 *   executionStore.updateStep(event.step_id, { status: event.status });
 * });
 * ```
 */
export function useTauriEvent<K extends TauriEventName>(
  eventName: K,
  callback: (payload: TauriEventMap[K]) => void,
): void;
export function useTauriEvent<T = unknown>(
  eventName: string,
  callback: (payload: T) => void,
): void;
export function useTauriEvent<T = unknown>(
  eventName: string,
  callback: (payload: T) => void,
): void {
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    let cancelled = false;

    listen<T>(eventName, (event) => {
      if (!cancelled) {
        callbackRef.current(event.payload);
      }
    }).then((fn) => {
      if (cancelled) {
        fn();
      } else {
        unlisten = fn;
      }
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [eventName]);
}
