import { useState } from "react";
import RecipientList from "./RecipientList";
// import { Tooltip } from "react-tooltip";
import { useTranslation } from "react-i18next";

function SignerListPlace(props) {
  const { t } = useTranslation();

  const handleAddRecipient = () => {
    props?.setIsAddSigner(true);
    props.setIsTour && props.setIsTour(false);
  };

  return (
    <div className="mb-2">
      <div className="px-3.5 py-2.5 flex items-center justify-between border-b border-base-content/10 bg-base-100/40">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-primary/10 text-primary flex items-center justify-center text-xs">
            <i className="fa-light fa-users"></i>
          </div>
          <span className="text-xs font-bold uppercase tracking-wider text-base-content/90">
            {props.title ? props.title : t("recipients")}
          </span>
        </div>
        {props.setIsTour && (
          <button
            type="button"
            onClick={() => props.setIsTour(true)}
            className="w-6 h-6 rounded-full flex items-center justify-center text-base-content/50 hover:text-primary hover:bg-primary/10 transition-colors"
            title="Ayuda"
          >
            <i className="fa-light fa-circle-question text-xs"></i>
          </button>
        )}
      </div>

      <div className="overflow-auto hide-scrollbar max-h-[180px] p-2">
        <RecipientList {...props} />
      </div>

      <div className="px-2 pb-1">
        {props.handleAddSigner ? (
          <div
            role="button"
            data-tut="reactourAddbtn"
            disabled={props?.isMailSend ? true : false}
            className="flex items-center justify-center gap-2 py-2 px-3 rounded-xl border border-primary/30 bg-primary/10 hover:bg-primary/20 text-primary text-xs font-semibold transition-all shadow-sm cursor-pointer active:scale-98"
            onClick={() => props.handleAddSigner()}
          >
            <i className="fa-light fa-plus text-xs"></i> {t("add-role")}
          </div>
        ) : (
          <div
            role="button"
            data-tut="addRecipient"
            className="flex items-center justify-center gap-2 py-2 px-3 rounded-xl border border-primary/30 bg-primary/10 hover:bg-primary/20 text-primary text-xs font-semibold transition-all shadow-sm cursor-pointer active:scale-98"
            disabled={props?.isMailSend ? true : false}
            onClick={handleAddRecipient}
          >
            <i className="fa-light fa-plus text-xs"></i> {t("add-recipients")}
          </div>
        )}
      </div>
    </div>
  );

}

export default SignerListPlace;