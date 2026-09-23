import { Globe } from "lucide-react";
import SelectLanguage from "../pdf/SelectLanguage";

function PreferencesCard({ t, updateExtUser }) {
  return (
    <div
      className="op-card bg-base-100 p-4 md:p-5 flex flex-col gap-4"
      data-testid="preferences-card"
    >
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <Globe size={18} aria-hidden="true" />
        </div>
        <h2 className="text-sm font-semibold text-base-content">
          {t("Preferences")}
        </h2>
      </div>
      <div className="space-y-4">
        <div>
          <label className="text-xs font-medium text-base-content/60 mb-1 block">
            {t("language")}
          </label>
          <SelectLanguage isProfile={true} updateExtUser={updateExtUser} />
        </div>
      </div>
    </div>
  );
}

export default PreferencesCard;
