import React from "react";
import { useTranslation } from "react-i18next";

function PrevNext({ pageNumber, allPages, changePage }) {
  const { t } = useTranslation();
  //for go to previous page
  function previousPage() {
    changePage(-1);
  }
  //for go to next page
  function nextPage() {
    changePage(1);
  }

  return (
    <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-xl border border-base-content/10 bg-base-100/50 shadow-sm">
      <button
        type="button"
        className="w-6 h-6 rounded-lg flex items-center justify-center text-base-content/70 hover:text-primary hover:bg-primary/10 transition-colors disabled:opacity-25 disabled:cursor-not-allowed"
        disabled={pageNumber <= 1}
        onClick={previousPage}
        title="Página anterior"
      >
        <i className="fa-light fa-chevron-up text-xs" aria-hidden="true"></i>
      </button>
      <span className="text-xs text-base-content font-bold px-1.5 tracking-tight">
        {pageNumber || (allPages ? 1 : "--")} <span className="font-normal text-base-content/60">{t("of")}</span> {allPages || "--"}
      </span>
      <button
        type="button"
        className="w-6 h-6 rounded-lg flex items-center justify-center text-base-content/70 hover:text-primary hover:bg-primary/10 transition-colors disabled:opacity-25 disabled:cursor-not-allowed"
        disabled={pageNumber >= allPages}
        onClick={nextPage}
        title="Página siguiente"
      >
        <i className="fa-light fa-chevron-down text-xs" aria-hidden="true"></i>
      </button>
    </div>
  );

}

export default PrevNext;
