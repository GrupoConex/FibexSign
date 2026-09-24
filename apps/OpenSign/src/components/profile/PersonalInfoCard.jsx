import Tooltip from "../../primitives/Tooltip";
import { User, CheckCircle2, AlertTriangle, MailCheck } from "lucide-react";

function PersonalInfoCard({
  t,
  editmode,
  name,
  onNameChange,
  nameError,
  displayName,
  phone,
  onPhoneChange,
  phoneError,
  savedPhone,
  email,
  isEmailVerified,
  onVerifyEmail
}) {
  return (
    <div
      className="op-card bg-base-100 p-4 md:p-5 flex flex-col gap-4"
      data-testid="personal-info-card"
    >
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <User size={18} aria-hidden="true" />
        </div>
        <h2 className="text-sm font-semibold text-base-content">
          {t("personal-information-title")}
        </h2>
      </div>
      <div className="space-y-4">
        <div>
          <label
            htmlFor="profile-input-name"
            className="text-xs font-medium text-base-content/60 mb-1 block"
          >
            {t("name")}
          </label>
          {editmode ? (
            <input
              id="profile-input-name"
              type="text"
              value={name}
              data-testid="input-name"
              className="op-input op-input-bordered op-input-sm w-full"
              onChange={(e) => onNameChange(e.target.value)}
              aria-invalid={Boolean(nameError)}
              aria-describedby={nameError ? "name-error" : undefined}
            />
          ) : (
            <p
              className="text-sm font-medium break-all text-base-content"
              data-testid="display-name"
            >
              {displayName}
            </p>
          )}
          {nameError && (
            <p
              id="name-error"
              role="alert"
              className="text-xs text-error mt-1"
              data-testid="name-error"
            >
              {nameError}
            </p>
          )}
        </div>
        <div>
          <label
            htmlFor="profile-input-phone"
            className="text-xs font-medium text-base-content/60 mb-1 block"
          >
            {t("phone")}
          </label>
          {editmode ? (
            <input
              id="profile-input-phone"
              type="text"
              value={phone || ""}
              data-testid="input-phone"
              className="op-input op-input-bordered op-input-sm w-full"
              onChange={(e) => onPhoneChange(e.target.value)}
              aria-invalid={Boolean(phoneError)}
              aria-describedby={phoneError ? "phone-error" : undefined}
            />
          ) : (
            <p
              className="text-sm font-medium break-all text-base-content"
              data-testid="display-phone"
            >
              {savedPhone}
            </p>
          )}
          {phoneError && (
            <p
              id="phone-error"
              role="alert"
              className="text-xs text-error mt-1"
              data-testid="phone-error"
            >
              {phoneError}
            </p>
          )}
        </div>
        <div>
          <label className="text-xs font-medium text-base-content/60 mb-1 flex items-center gap-1">
            {t("email")}
            {editmode && (
              <Tooltip message={t("email-help")} maxWidth="max-w-[250px]" />
            )}
          </label>
          <div className="flex items-center gap-2 flex-wrap">
            <p
              className="text-sm font-medium break-all text-base-content"
              data-testid="display-email"
            >
              {email}
            </p>
            {isEmailVerified ? (
              <span
                className="op-badge op-badge-success op-badge-sm gap-1 !text-black"
                data-testid="email-verified-badge"
              >
                <CheckCircle2 size={12} aria-hidden="true" />
                {t("verified")}
              </span>
            ) : (
              <>
                <span
                  className="op-badge op-badge-warning op-badge-sm gap-1 !text-black"
                  data-testid="email-unverified-badge"
                >
                  <AlertTriangle size={12} aria-hidden="true" />
                  {t("not-verified")}
                </span>
                <button
                  type="button"
                  onClick={onVerifyEmail}
                  aria-label={`${t("verify")} ${t("email")}`}
                  className="op-btn op-btn-primary op-btn-xs gap-1.5 font-medium shadow-xs hover:shadow-sm"
                  data-testid="verify-email-button"
                >
                  <MailCheck size={13} aria-hidden="true" />
                  {t("verify")}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default PersonalInfoCard;
