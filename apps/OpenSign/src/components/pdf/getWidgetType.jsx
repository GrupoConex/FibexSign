import React from "react";
import "../../styles/opensigndrive.css";

// `getWidgetType` is used to load ui of widget in side list
const getWidgetType = (item, widgetName, isMobileView = false) => {
  if (isMobileView) {
    return (
      <div
        title={widgetName}
        className="liquid-glass-widget-btn-mobile group"
        role="button"
        tabIndex={0}
      >
        <div className="liquid-glass-widget-icon-box">
          <i className={item.icon}></i>
        </div>
        <span className="liquid-glass-widget-label capitalize">
          {widgetName}
        </span>
      </div>
    );
  }

  return (
    <div
      title={widgetName}
      className="liquid-glass-widget-btn group"
      role="button"
      tabIndex={0}
    >
      {/* Sutil grip indicator en la esquina para indicar drag */}
      <span className="absolute top-2 right-2 text-[9px] opacity-25 group-hover:opacity-60 transition-opacity">
        <i className="fa-light fa-grip-vertical"></i>
      </span>

      {/* Símbolo / Icono cuadrado central */}
      <div className="liquid-glass-widget-icon-box">
        <i className={item.icon}></i>
      </div>

      {/* Nombre del widget */}
      <span className="liquid-glass-widget-label capitalize">
        {widgetName}
      </span>
    </div>
  );
};

export default getWidgetType;

