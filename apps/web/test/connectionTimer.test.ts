import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createConnectionTimer } from '../src/lib/connectionTimer';

describe('createConnectionTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('fires callback after the specified delay', () => {
    const onTimeout = vi.fn();
    const timer = createConnectionTimer(20000, onTimeout);

    timer.start();

    // 10 seconds in -> not fired
    vi.advanceTimersByTime(10000);
    expect(onTimeout).not.toHaveBeenCalled();

    // 20 seconds in -> fired once
    vi.advanceTimersByTime(10000);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('does not fire after clear() is called', () => {
    const onTimeout = vi.fn();
    const timer = createConnectionTimer(20000, onTimeout);

    timer.start();
    vi.advanceTimersByTime(10000);

    timer.clear();

    // Advance past remaining time and well beyond
    vi.advanceTimersByTime(20000);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('start() restarts the timer if already running', () => {
    const onTimeout = vi.fn();
    const timer = createConnectionTimer(20000, onTimeout);

    timer.start();
    // Advance 15 seconds
    vi.advanceTimersByTime(15000);
    expect(onTimeout).not.toHaveBeenCalled();

    // Restart timer (new 20s window)
    timer.start();

    // Advance 10 seconds (total 25s from first start, but 10s from restart)
    vi.advanceTimersByTime(10000);
    expect(onTimeout).not.toHaveBeenCalled();

    // Advance another 10s (now 20s from restart) -> should fire
    vi.advanceTimersByTime(10000);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('supports 5 second disconnect grace timer delay', () => {
    const onGraceTimeout = vi.fn();
    const timer = createConnectionTimer(5000, onGraceTimeout);

    timer.start();
    vi.advanceTimersByTime(4999);
    expect(onGraceTimeout).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onGraceTimeout).toHaveBeenCalledTimes(1);
  });

  it('supports the 30 second transfer confirmation timeout', () => {
    const onTimeout = vi.fn();
    const timer = createConnectionTimer(30000, onTimeout);

    timer.start();
    vi.advanceTimersByTime(29999);
    expect(onTimeout).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });
});
