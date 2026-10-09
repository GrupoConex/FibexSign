import { useCallback, useEffect, useRef, useState } from "react";

export const OTP_RESEND_COOLDOWN_SECONDS = 60;
const TICK_MS = 1000;
const MS_PER_SECOND = 1000;

const secondsUntil = (deadline) =>
  Math.max(Math.ceil((deadline - Date.now()) / MS_PER_SECOND), 0);

export const useOtpResendCooldown = (sendOtp) => {
  const [isSending, setIsSending] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const isLockedRef = useRef(false);
  const deadlineRef = useRef(0);
  const epochRef = useRef(0);
  const isCoolingDown = secondsLeft > 0;

  useEffect(
    () => () => {
      epochRef.current += 1;
      isLockedRef.current = false;
    },
    []
  );

  useEffect(() => {
    if (!isCoolingDown) return undefined;
    const intervalId = setInterval(
      () => setSecondsLeft(secondsUntil(deadlineRef.current)),
      TICK_MS
    );
    return () => clearInterval(intervalId);
  }, [isCoolingDown]);

  const send = useCallback(
    async (...args) => {
      if (isLockedRef.current || deadlineRef.current > Date.now()) {
        return false;
      }
      const epoch = epochRef.current;
      const isStale = () => epochRef.current !== epoch;
      isLockedRef.current = true;
      setIsSending(true);
      try {
        const isSent = Boolean(await sendOtp({ isStale }, ...args));
        if (isStale()) return false;
        if (isSent) {
          deadlineRef.current =
            Date.now() + OTP_RESEND_COOLDOWN_SECONDS * MS_PER_SECOND;
          setSecondsLeft(OTP_RESEND_COOLDOWN_SECONDS);
        }
        return isSent;
      } finally {
        if (!isStale()) {
          isLockedRef.current = false;
          setIsSending(false);
        }
      }
    },
    [sendOtp]
  );

  const reset = useCallback(() => {
    epochRef.current += 1;
    isLockedRef.current = false;
    deadlineRef.current = 0;
    setIsSending(false);
    setSecondsLeft(0);
  }, []);

  return {
    send,
    reset,
    isSending,
    secondsLeft,
    isResendDisabled: isSending || isCoolingDown
  };
};
