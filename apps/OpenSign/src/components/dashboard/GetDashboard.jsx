import { useState, useEffect, Suspense } from "react";
import { lazyWithRetry } from "../../utils";
import { useTranslation } from "react-i18next";
const DashboardButton = lazyWithRetry(() => import("./DashboardButton"));
const DashboardCard = lazyWithRetry(() => import("./DashboardCard"));
const DashboardReport = lazyWithRetry(() => import("./DashboardReport"));
const buttonList = [
  {
    label: "Sign yourself",
    redirectId: "sHAnZphf69",
    redirectType: "Form",
    icon: "fa-light fa-pen-nib"
  },
  {
    label: "Request signatures",
    redirectId: "8mZzFxbG1z",
    redirectType: "Form",
    icon: "fa-light fa-paper-plane"
  }
];
const GetDashboard = (props) => {
  const { t } = useTranslation();

  const Button = ({ label, redirectId, redirectType, icon }) => (
    <DashboardButton
      Icon={icon}
      Label={label}
      Data={{ Redirect_type: redirectType, Redirect_id: redirectId }}
    />
  );
  const renderSwitchWithTour = (col) => {
    switch (col.widget.type) {
      case "Card":
        return (
          <div
            className="dashboard-stat-card bg-[#1d4ed8] text-white op-card rounded-box w-full h-[125px] px-6 py-4 border border-blue-400/30 hover:border-blue-300/60 transition-all duration-200 relative group cursor-pointer flex flex-col justify-center"
            data-tut={col.widget.data.tourSection}
          >
            <Suspense
              fallback={
                <div className="h-full w-full flex justify-center items-center">
                  {t("loading")}
                </div>
              }
            >
              <DashboardCard
                Icon={col.widget.icon}
                Label={col.widget.label}
                Format={col.widget.format && col.widget.format}
                Data={col.widget.data}
                FilterData={col.widget.filter}
              />
            </Suspense>
          </div>
        );
      case "report": {
        return (
          <div data-tut={col.widget.data.tourSection}>
            <Suspense fallback={<div>please wait</div>}>
              <div className="mb-3 md:mb-0">
                <DashboardReport
                  Record={col.widget}
                />
              </div>
            </Suspense>
          </div>
        );
      }
      default:
        return <></>;
    }
  };
  const renderSwitch = (col) => {
    switch (col.widget.type) {
      case "Card":
        return (
          <div
            className="dashboard-stat-card bg-[#1d4ed8] text-white op-card rounded-box w-full h-[125px] px-6 py-4 border border-blue-400/30 hover:border-blue-300/60 transition-all duration-200 relative group cursor-pointer flex flex-col justify-center"
          >
            <Suspense fallback={<div>please wait</div>}>
              <DashboardCard
                Icon={col.widget.icon}
                Label={col.widget.label}
                Format={col.widget.format && col.widget.format}
                Data={col.widget.data}
                FilterData={col.widget.filter}
              />
            </Suspense>
          </div>
        );
      case "report": {
        return (
          <Suspense fallback={<div>please wait</div>}>
            <div className="mb-3 md:mb-0">
              <DashboardReport
                Record={col.widget}
              />
            </div>
          </Suspense>
        );
      }
      default:
        return <></>;
    }
  };

  const cardColumns =
    props?.dashboard?.columns?.filter((col) => col.widget.type === "Card") || [];
  const reportColumns =
    props?.dashboard?.columns?.filter((col) => col.widget.type !== "Card") || [];

  return (
    <div className="flex flex-col gap-4">
      {/* 1. Tarjetas Azules de Estadísticas (PRIMERO) */}
      {cardColumns.length > 0 && (
        <div className="grid grid-cols-12 w-full gap-4">
          {cardColumns.map((col, i) =>
            col.widget.data && col.widget.data.tourSection ? (
              <div key={i} className={col?.colsize}>
                {renderSwitchWithTour(col)}
              </div>
            ) : (
              <div key={i} className={col?.colsize}>
                {renderSwitch(col)}
              </div>
            )
          )}
        </div>
      )}

      {/* 2. Botones de Acciones Rápidas ("Firma tu mismo" / "Solicitar firmas") */}
      <div data-tut={"tourbutton"} className="flex flex-col md:flex-row gap-4">
        {buttonList.map((btn) => (
          <Button
            key={btn.label}
            label={btn.label}
            redirectType={btn.redirectType}
            redirectId={btn.redirectId}
            icon={btn.icon}
          />
        ))}
      </div>

      {/* 3. Reportes y Listas Recientes */}
      {reportColumns.length > 0 && (
        <div className="grid grid-cols-12 w-full gap-4">
          {reportColumns.map((col, i) =>
            col.widget.data && col.widget.data.tourSection ? (
              <div key={i} className={col?.colsize}>
                {renderSwitchWithTour(col)}
              </div>
            ) : (
              <div key={i} className={col?.colsize}>
                {renderSwitch(col)}
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
};

export default GetDashboard;
