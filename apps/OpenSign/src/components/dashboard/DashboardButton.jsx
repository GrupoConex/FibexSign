import React from "react";
import { useNavigate } from "react-router";
import { openInNewTab } from "../../constant/Utils";
import { useTranslation } from "react-i18next";
import Icon from "../../primitives/Icon";

const DashboardButton = (props) => {
  const navigate = useNavigate();
  const { t } = useTranslation();

  function openReport() {
    if (props.Data && props.Data.Redirect_type) {
      const Redirect_type = props.Data.Redirect_type;
      const id = props.Data.Redirect_id;
      if (Redirect_type === "Form") {
        navigate(`/form/${id}`);
      } else if (Redirect_type === "Report") {
        navigate(`/report/${id}`);
      } else if (Redirect_type === "Url") {
        openInNewTab(id);
      }
    }
  }
  const isSignYourself = props.Label === "Sign yourself";

  return (
    <div
      onClick={() => openReport()}
      className={`${
        props.Data && props.Data.Redirect_type
          ? "cursor-pointer"
          : "cursor-default"
      } w-full p-4 md:p-5 op-card rounded-box transition-all duration-200 group border border-slate-700/60 dark:border-slate-800/80 hover:border-blue-500/60 dark:hover:border-blue-500/60 bg-base-200/80 hover:bg-base-200`}
    >
      <div className="flex flex-row items-center justify-between text-base-content">
        <div className="flex flex-row items-center gap-4">
          <span
            className={`w-[52px] h-[52px] rounded-xl flex items-center justify-center shrink-0 transition-transform duration-200 group-hover:scale-105 ${
              isSignYourself
                ? "bg-blue-500/15 text-blue-500 dark:text-blue-400"
                : "bg-indigo-500/15 text-indigo-500 dark:text-indigo-400"
            }`}
          >
            <Icon
              name={isSignYourself ? "pen-tool" : "send"}
              size={24}
              className="text-current"
            />
          </span>
          <div>
            <div className="text-base md:text-lg font-semibold text-base-content group-hover:text-blue-500 dark:group-hover:text-blue-400 transition-colors duration-200">
              {t(`sidebar.${props.Label}`)}
            </div>
            {props.Label === "Sign yourself" && (
              <div className="text-gray-500 dark:text-gray-400 text-xs md:text-sm mt-0.5">
                {t("signyour-self-button")}
              </div>
            )}
            {props.Label === "Request signatures" && (
              <div className="text-gray-500 dark:text-gray-400 text-xs md:text-sm mt-0.5">
                {t("requestsign-button")}
              </div>
            )}
          </div>
        </div>
        <div className="hidden sm:flex items-center text-gray-400 dark:text-gray-500 group-hover:text-blue-500 dark:group-hover:text-blue-400 group-hover:translate-x-1 transition-all duration-200 pr-2">
          <Icon name="chevron-right" size={18} />
        </div>
      </div>
    </div>
  );
};

export default DashboardButton;
