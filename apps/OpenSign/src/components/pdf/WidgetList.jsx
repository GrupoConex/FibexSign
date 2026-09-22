import React from "react";
import { isMobile } from "../../constant/Utils";
import { useTranslation } from "react-i18next";
import getWidgetType from "./getWidgetType";

function WidgetList(props) {
  const { t } = useTranslation();
  const getWidgetList = props.updateWidgets();
  const isMobileMode = props.isMobileView !== undefined ? props.isMobileView : isMobile;

  return getWidgetList?.map((item, ind) => {
    return (
      <div className={isMobileMode ? "flex-shrink-0" : "w-full"} key={ind}>
        <div
          data-tut="isSignatureWidget"
          className="select-none cursor-grab active:cursor-grabbing w-full"
          onClick={() => {
            props.addPositionOfSignature &&
              props.addPositionOfSignature("onclick", item);
          }}
          ref={(element) => !isMobileMode && item?.ref && item.ref(element)}
          onMouseMove={(e) => !isMobileMode && props?.handleDivClick && props.handleDivClick(e)}
          onMouseDown={() => !isMobileMode && props?.handleMouseLeave && props.handleMouseLeave()}
          onTouchStart={(e) => !isMobileMode && props?.handleDivClick && props.handleDivClick(e)}
        >
          {item.ref && getWidgetType(item, t(`widgets-name.${item.type}`), isMobileMode)}
        </div>
      </div>
    );
  });
}

export default WidgetList;

