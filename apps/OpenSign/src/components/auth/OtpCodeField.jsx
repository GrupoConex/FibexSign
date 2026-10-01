import { useTranslation } from "react-i18next";
import FieldError from "./FieldError";
import { OTP_INPUT_PATTERN, OTP_LENGTH } from "../../utils/otpPolicy";

const OTP_FIELD_ID = "otp";
const OTP_ERROR_ID = "otp-error";

function OtpCodeField({ value, onChange, errorKey, autoFocus = false }) {
  const { t } = useTranslation();
  return (
    <div>
      <label
        className="block text-xs font-semibold mb-1 text-base-content"
        htmlFor={OTP_FIELD_ID}
      >
        {t("verification-code")}
      </label>
      <input
        id={OTP_FIELD_ID}
        type="tel"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern={OTP_INPUT_PATTERN}
        className={`op-input op-input-bordered w-full text-sm${errorKey ? " op-input-error" : ""}`}
        placeholder={t("otp-placeholder")}
        value={value}
        onChange={(event) =>
          onChange(event.target.value.replace(/\D/g, "").slice(0, OTP_LENGTH))
        }
        aria-invalid={Boolean(errorKey)}
        aria-describedby={errorKey ? OTP_ERROR_ID : undefined}
        autoFocus={autoFocus}
        required
      />
      <FieldError id={OTP_ERROR_ID} message={errorKey && t(errorKey)} />
    </div>
  );
}

export default OtpCodeField;
