import { Lock, KeyRound, Trash2 } from "lucide-react";

function SecurityCard({ t, onChangePassword, onDeleteAccount }) {
  return (
    <div
      className="op-card bg-base-100 p-4 md:p-5 flex flex-col gap-4"
      data-testid="security-card"
    >
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <Lock size={18} aria-hidden="true" />
        </div>
        <h2 className="text-sm font-semibold text-base-content">
          {t("security-account-title")}
        </h2>
      </div>
      <div className="space-y-4">
        <button
          type="button"
          onClick={onChangePassword}
          className="op-btn op-btn-secondary op-btn-sm gap-2 w-full md:w-auto"
          data-testid="change-password-button"
        >
          <KeyRound size={14} aria-hidden="true" />
          {t("change-password")}
        </button>
        <div
          className="border border-error/40 bg-error/5 rounded-box p-3 flex flex-col md:flex-row md:items-center md:justify-between gap-2"
          data-testid="danger-zone"
        >
          <div>
            <p className="text-sm font-semibold text-error opensigncss:!text-[#b42318]">
              {t("danger-zone-title")}
            </p>
            <p className="text-xs text-base-content/60">
              {t("delete-account-que")}
            </p>
          </div>
          <button
            type="button"
            onClick={onDeleteAccount}
            className="op-btn op-btn-error op-btn-outline op-btn-sm gap-2 opensigncss:!text-[#b42318] opensigncss:!border-[#b42318]"
            data-testid="delete-account-button"
          >
            <Trash2 size={14} aria-hidden="true" />
            {t("delete-account")}
          </button>
        </div>
      </div>
    </div>
  );
}

export default SecurityCard;
