export interface ConnectionTimer {
  start: () => void;
  clear: () => void;
}

/**
 * Creates a reusable connection timer that can be started and cleared.
 * Calling start() restarts the timer if already running.
 *
 * @param ms Delay in milliseconds
 * @param onTimeout Callback executed when timer expires
 */
export function createConnectionTimer(ms: number, onTimeout: () => void): ConnectionTimer {
  let timerId: ReturnType<typeof setTimeout> | null = null;

  return {
    start: () => {
      if (timerId !== null) {
        clearTimeout(timerId);
      }
      timerId = setTimeout(() => {
        timerId = null;
        onTimeout();
      }, ms);
    },
    clear: () => {
      if (timerId !== null) {
        clearTimeout(timerId);
        timerId = null;
      }
    },
  };
}
