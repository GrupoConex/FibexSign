import { Briefcase } from "lucide-react";

function ProfessionalInfoCard({
  t,
  editmode,
  company,
  onCompanyChange,
  displayCompany,
  jobTitle,
  onJobTitleChange,
  displayJobTitle,
  userRole,
  roleBadgeClass
}) {
  return (
    <div
      className="op-card bg-base-100 p-4 md:p-5 flex flex-col gap-4"
      data-testid="professional-info-card"
    >
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <Briefcase size={18} aria-hidden="true" />
        </div>
        <h2 className="text-sm font-semibold text-base-content">
          {t("professional-information-title")}
        </h2>
      </div>
      <div className="space-y-4">
        <div>
          <label
            htmlFor="profile-input-company"
            className="text-xs font-medium text-base-content/60 mb-1 block"
          >
            {t("company")}
          </label>
          {editmode ? (
            <input
              id="profile-input-company"
              type="text"
              value={company || ""}
              data-testid="input-company"
              className="op-input op-input-bordered op-input-sm w-full"
              onChange={(e) => onCompanyChange(e.target.value)}
            />
          ) : (
            <p
              className="text-sm font-medium break-all text-base-content"
              data-testid="display-company"
            >
              {displayCompany}
            </p>
          )}
        </div>
        <div>
          <label
            htmlFor="profile-input-job-title"
            className="text-xs font-medium text-base-content/60 mb-1 block"
          >
            {t("job-title")}
          </label>
          {editmode ? (
            <input
              id="profile-input-job-title"
              type="text"
              value={jobTitle || ""}
              data-testid="input-job-title"
              className="op-input op-input-bordered op-input-sm w-full"
              onChange={(e) => onJobTitleChange(e.target.value)}
            />
          ) : (
            <p
              className="text-sm font-medium break-all text-base-content"
              data-testid="display-job-title"
            >
              {displayJobTitle}
            </p>
          )}
        </div>
        {userRole && (
          <div>
            <label className="text-xs font-medium text-base-content/60 mb-1 block">
              {t("role")}
            </label>
            <span
              className={`op-badge op-badge-sm ${roleBadgeClass}`}
              data-testid="role-badge"
            >
              {userRole}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export default ProfessionalInfoCard;
