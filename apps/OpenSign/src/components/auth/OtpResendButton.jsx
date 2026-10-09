import { useId } from "react";
import { useTranslation } from "react-i18next";
import { OTP_RESEND_COOLDOWN_SECONDS } from "../../hook/useOtpResendCooldown";

function OtpResendButton({
  onClick,
  isDisabled,
  isSending = false,
  secondsLeft,
  className,
  returnFocusTo
}) {
  const { t } = useTranslation();
  const hintId = useId();
  const isCoolingDown = secondsLeft > 0;

  const handleClick = async () => {
    await onClick();
    returnFocusTo?.()?.focus();
  };

  const getLabel = () => {
    if (isSending) return t("loading");
    if (isCoolingDown) return t("resend-in-seconds", { seconds: secondsLeft });
    return t("resend");
  };

  return (
    <>
      <button
        type="button"
        className={className}
        onClick={handleClick}
        disabled={isDisabled}
        aria-describedby={isCoolingDown ? hintId : undefined}
      >
        {getLabel()}
      </button>
      {isCoolingDown && (
        <span id={hintId} className="sr-only">
          {t("resend-available-in-seconds", {
            seconds: OTP_RESEND_COOLDOWN_SECONDS
          })}
        </span>
      )}
    </>
  );
}

export default OtpResendButton;
