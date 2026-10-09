import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StrictMode, useEffect } from "react";
import { renderHook, act } from "@testing-library/react";
import {
  useOtpResendCooldown,
  OTP_RESEND_COOLDOWN_SECONDS
} from "../useOtpResendCooldown";

const flush = () => act(async () => {});

describe("useOtpResendCooldown", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("forwards its arguments to the send function", async () => {
    const send = vi.fn().mockResolvedValue(true);
    const { result } = renderHook(() => useOtpResendCooldown(send));
    await act(async () => {
      await result.current.send("a@b.co");
    });
    expect(send).toHaveBeenCalledWith(
      { isStale: expect.any(Function) },
      "a@b.co"
    );
  });

  it("starts idle with no cooldown", () => {
    const { result } = renderHook(() =>
      useOtpResendCooldown(vi.fn().mockResolvedValue(true))
    );
    expect(result.current.isSending).toBe(false);
    expect(result.current.secondsLeft).toBe(0);
    expect(result.current.isResendDisabled).toBe(false);
  });

  it("starts the cooldown after a successful send", async () => {
    const send = vi.fn().mockResolvedValue(true);
    const { result } = renderHook(() => useOtpResendCooldown(send));
    let isSent;
    await act(async () => {
      isSent = await result.current.send();
    });
    expect(isSent).toBe(true);
    expect(result.current.secondsLeft).toBe(OTP_RESEND_COOLDOWN_SECONDS);
    expect(result.current.isResendDisabled).toBe(true);
  });

  it("counts down every second and re-enables at zero", async () => {
    const { result } = renderHook(() =>
      useOtpResendCooldown(vi.fn().mockResolvedValue(true))
    );
    await act(async () => {
      await result.current.send();
    });
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(result.current.secondsLeft).toBe(OTP_RESEND_COOLDOWN_SECONDS - 3);
    act(() => {
      vi.advanceTimersByTime((OTP_RESEND_COOLDOWN_SECONDS - 3) * 1000);
    });
    expect(result.current.secondsLeft).toBe(0);
    expect(result.current.isResendDisabled).toBe(false);
  });

  it("does not start a cooldown when the send fails", async () => {
    const send = vi.fn().mockResolvedValue(false);
    const { result } = renderHook(() => useOtpResendCooldown(send));
    let isSent;
    await act(async () => {
      isSent = await result.current.send();
    });
    expect(isSent).toBe(false);
    expect(result.current.secondsLeft).toBe(0);
    expect(result.current.isResendDisabled).toBe(false);
  });

  it("rethrows send errors without cooldown and releases the lock", async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(true);
    const { result } = renderHook(() => useOtpResendCooldown(send));
    let caught;
    await act(async () => {
      caught = await result.current.send().catch((error) => error);
    });
    expect(caught.message).toBe("boom");
    expect(result.current.secondsLeft).toBe(0);
    expect(result.current.isSending).toBe(false);
    await act(async () => {
      await result.current.send();
    });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("flags sending while the request is in flight", async () => {
    let resolveSend;
    const send = vi.fn(() => new Promise((resolve) => (resolveSend = resolve)));
    const { result } = renderHook(() => useOtpResendCooldown(send));
    act(() => {
      result.current.send();
    });
    expect(result.current.isSending).toBe(true);
    expect(result.current.isResendDisabled).toBe(true);
    await act(async () => {
      resolveSend(true);
    });
    expect(result.current.isSending).toBe(false);
  });

  it("ignores a second call while the first is in flight", async () => {
    let resolveSend;
    const send = vi.fn(() => new Promise((resolve) => (resolveSend = resolve)));
    const { result } = renderHook(() => useOtpResendCooldown(send));
    act(() => {
      result.current.send();
      result.current.send();
    });
    expect(send).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveSend(true);
    });
  });

  it("ignores calls during the cooldown", async () => {
    const send = vi.fn().mockResolvedValue(true);
    const { result } = renderHook(() => useOtpResendCooldown(send));
    await act(async () => {
      await result.current.send();
    });
    let isSent;
    await act(async () => {
      isSent = await result.current.send();
    });
    expect(isSent).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("allows sending again after the cooldown ends", async () => {
    const send = vi.fn().mockResolvedValue(true);
    const { result } = renderHook(() => useOtpResendCooldown(send));
    await act(async () => {
      await result.current.send();
    });
    act(() => {
      vi.advanceTimersByTime(OTP_RESEND_COOLDOWN_SECONDS * 1000);
    });
    await act(async () => {
      await result.current.send();
    });
    expect(send).toHaveBeenCalledTimes(2);
    expect(result.current.secondsLeft).toBe(OTP_RESEND_COOLDOWN_SECONDS);
  });

  it("clears the cooldown on reset and allows sending again", async () => {
    const send = vi.fn().mockResolvedValue(true);
    const { result } = renderHook(() => useOtpResendCooldown(send));
    await act(async () => {
      await result.current.send();
    });
    act(() => {
      result.current.reset();
    });
    expect(result.current.secondsLeft).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => {
      await result.current.send();
    });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("does not stretch the cooldown while timers are throttled", async () => {
    const { result } = renderHook(() =>
      useOtpResendCooldown(vi.fn().mockResolvedValue(true))
    );
    await act(async () => {
      await result.current.send();
    });
    act(() => {
      vi.setSystemTime(Date.now() + 30000);
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.secondsLeft).toBeLessThanOrEqual(29);
    act(() => {
      vi.setSystemTime(Date.now() + 40000);
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.secondsLeft).toBe(0);
  });

  it("invalidates an in-flight send on reset and releases the lock", async () => {
    const resolvers = [];
    const send = vi.fn(() => new Promise((resolve) => resolvers.push(resolve)));
    const { result } = renderHook(() => useOtpResendCooldown(send));
    let firstResult;
    act(() => {
      result.current.send().then((value) => (firstResult = value));
    });
    expect(result.current.isSending).toBe(true);
    act(() => {
      result.current.reset();
    });
    expect(result.current.isSending).toBe(false);
    expect(result.current.isResendDisabled).toBe(false);
    act(() => {
      result.current.send();
    });
    expect(send).toHaveBeenCalledTimes(2);
    await act(async () => {
      resolvers[0](true);
    });
    expect(firstResult).toBe(false);
    expect(result.current.secondsLeft).toBe(0);
    expect(result.current.isSending).toBe(true);
    await act(async () => {
      resolvers[1](true);
    });
    expect(result.current.secondsLeft).toBe(OTP_RESEND_COOLDOWN_SECONDS);
    expect(result.current.isSending).toBe(false);
  });

  it("tells the send function when its result became stale", async () => {
    let capturedContext;
    let resolveSend;
    const send = vi.fn((context) => {
      capturedContext = context;
      return new Promise((resolve) => (resolveSend = resolve));
    });
    const { result } = renderHook(() => useOtpResendCooldown(send));
    act(() => {
      result.current.send();
    });
    expect(capturedContext.isStale()).toBe(false);
    act(() => {
      result.current.reset();
    });
    expect(capturedContext.isStale()).toBe(true);
    await act(async () => {
      resolveSend(true);
    });
  });

  it("can send again after a StrictMode mount cycle started a send from an effect", async () => {
    const send = vi.fn().mockResolvedValue(true);
    const { result } = renderHook(
      () => {
        const otp = useOtpResendCooldown(send);
        useEffect(() => {
          otp.send();
        }, []);
        return otp;
      },
      { wrapper: StrictMode }
    );
    await flush();
    expect(send).toHaveBeenCalledTimes(2);
    expect(result.current.isSending).toBe(false);
    expect(result.current.secondsLeft).toBe(OTP_RESEND_COOLDOWN_SECONDS);
    act(() => {
      vi.advanceTimersByTime(OTP_RESEND_COOLDOWN_SECONDS * 1000);
    });
    await act(async () => {
      await result.current.send();
    });
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("clears the interval on unmount", async () => {
    const { result, unmount } = renderHook(() =>
      useOtpResendCooldown(vi.fn().mockResolvedValue(true))
    );
    await act(async () => {
      await result.current.send();
    });
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not update state when unmounted during the request", async () => {
    let resolveSend;
    const send = vi.fn(() => new Promise((resolve) => (resolveSend = resolve)));
    const { result, unmount } = renderHook(() => useOtpResendCooldown(send));
    act(() => {
      result.current.send();
    });
    unmount();
    await act(async () => {
      resolveSend(true);
    });
    await flush();
    expect(vi.getTimerCount()).toBe(0);
  });
});
