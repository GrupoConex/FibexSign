import { useState, useRef, useEffect } from "react";
import "../../styles/opensigndrive.css";
import ModalUi from "../../primitives/ModalUi";
import RecipientList from "./RecipientList";
import WidgetList from "./WidgetList";
import {
  isMobile,
  radioButtonWidget,
  textInputWidget,
  cellsWidget,
  textWidget,
  widgets,
  drawWidget
} from "../../constant/Utils";
import { useTranslation } from "react-i18next";
import { useWidgetDrag } from "../../hook/useWidgetDrag";

function WidgetComponent(props) {
  const { t } = useTranslation();
  const signRef = useRef(null);
  const userInformation = localStorage.getItem("UserInformation");
  const [isSignersModal, setIsSignersModal] = useState(false);
  // Define all draggable widget configurations
  const draggableItems = [
    { id: 1, text: "signature" },
    { id: 2, text: "stamp" },
    { id: 3, text: "initials" },
    { id: 4, text: textInputWidget },
    { id: 6, text: "name" },
    { id: 7, text: "job title" },
    { id: 8, text: "company" },
    { id: 9, text: "email" },
    { id: 10, text: "date" },
    { id: 11, text: textWidget },
    { id: 12, text: cellsWidget },
    { id: 13, text: "checkbox" },
    { id: 14, text: "dropdown" },
    { id: 15, text: radioButtonWidget },
    { id: 16, text: "image" },
    { id: 17, text: drawWidget },
  ];

  // Create all drag refs in one go
  const widgetRefs = draggableItems.map((item) =>
    useWidgetDrag({ type: "BOX", ...item })
  );

  // Map your widgets with the generated dragRefs
  const [widgetList, setWidgetList] = useState([]);
  const handleModal = () => {
    setIsSignersModal(!isSignersModal);
  };
  useEffect(() => {
    const updated = widgets.map((obj, index) => ({
      ...obj,
      ref: widgetRefs[index]?.dragRef || null
    }));
    setWidgetList(updated);
    // eslint-disable-next-line
  }, []);

  // allow only (signature, stamp, initials, text, name, job title, company, email, cells) widget when isAllowModification true and user have session token
  const modifiedWidgets = widgetList.filter(
    (data) =>
      ![
        "dropdown",
        radioButtonWidget,
        textInputWidget,
        "date",
        "image",
        "checkbox",
        drawWidget
      ].includes(data.type)
  );
  // allow only (signature, stamp, initials, text, cells) widget when isAllowModification true and user does not have session token
  const unlogedInUserWidgets = widgetList.filter(
    (data) =>
      ![
        "dropdown",
        radioButtonWidget,
        textInputWidget,
        "date",
        "image",
        "checkbox",
        "name",
        "email",
        "job title",
        "company",
        drawWidget
      ].includes(data.type)
  );
  const selfSignWidgets = widgetList.filter(
    (data) =>
      ![
        "dropdown",
        radioButtonWidget,
        textInputWidget,
        drawWidget,
      ].includes(data.type)
  );
  //if user select prefill role then allow only date,image,text,checkbox,radio,dropdownAdd commentMore actions
  //dropdown widget should only be show in template flow
  const prefillAllowWidgets = widgetList.filter((data) =>
    (props.isPrefillDropdown ? ["dropdown"] : [])
      .concat([
        radioButtonWidget,
        textWidget,
        "date",
        "image",
        "checkbox",
        drawWidget
      ])
      .includes(data.type)
  );
  //function to show widget on the base of conditionAdd commentMore actions
  const handleWidgetType = () => {
    if (props.isSignYourself) {
      return selfSignWidgets;
    } else if (props?.roleName === "prefill") {
      return prefillAllowWidgets;
    } else if (props.isAlllowModify) {
      if (userInformation) {
        return modifiedWidgets;
      } else {
        return unlogedInUserWidgets;
      }
    } else if (props?.roleName !== "prefill") {
      return widgetList.filter(
        (data) => ![textWidget, drawWidget].includes(data.type)
      );
    }
  };
  const handleSelectRecipient = () => {
    if (props?.roleName === "prefill") {
      return "Prefill by owner";
    } else if (
      props.signersdata[props.isSelectListId]?.Email ||
      props.signersdata[props.isSelectListId]?.Role
    ) {
      const userData =
        props.signersdata[props.isSelectListId]?.Name ||
        props.signersdata[props.isSelectListId]?.Role;
      const name =
        userData?.length > 20 ? `${userData.slice(0, 20)}...` : userData;
      return name;
    }
  };
  const handleBlockColor = () => {
    const widgetBoxColor = props?.signerPos?.find(
      (x) => x?.Id === props?.uniqueId
    )?.blockColor;
    return widgetBoxColor;
  };
  const [isScreenMobile, setIsScreenMobile] = useState(
    typeof window !== "undefined" ? window.innerWidth < 768 : isMobile
  );

  useEffect(() => {
    const handleResize = () => {
      setIsScreenMobile(window.innerWidth < 768);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return (
    <>
      {isScreenMobile ? (
        !props.isMailSend && (
          <div id="navbar" className="liquid-glass-dock fixed z-[99] bottom-0 left-0 right-0 w-full pt-2 pb-2 shadow-2xl">
            {props.isSigners && (
              <div className="px-3 pb-2 flex items-center gap-2">
                <div
                  className="flex-1 flex items-center gap-2.5 px-3 py-1.5 rounded-xl border border-base-content/10 bg-base-100/60 cursor-pointer shadow-sm"
                  onClick={() => handleModal()}
                  data-tut="recipientArea"
                >
                  <span
                    className="w-3 h-3 rounded-full flex-shrink-0 shadow-sm"
                    style={{
                      backgroundColor:
                        props.roleName === "prefill"
                          ? "#38bdf8"
                          : handleBlockColor() || "#3b82f6"
                    }}
                  ></span>
                  <span className="text-xs font-semibold text-base-content truncate">
                    {handleSelectRecipient() || t("select-recipient")}
                  </span>
                  <i className="fa-light fa-chevron-down text-[10px] ml-auto text-base-content/50"></i>
                </div>

                <div className="flex-shrink-0">
                  {props.handleAddSigner ? (
                    <button
                      data-tut="reactourAddbtn"
                      onClick={() => props.handleAddSigner()}
                      className="liquid-tool-btn border border-base-content/10 bg-base-100/60 shadow-sm"
                      title={t("add-recipient")}
                    >
                      <i className="fa-light fa-plus text-sm"></i>
                    </button>
                  ) : (
                    props.setIsAddSigner && (
                      <button
                        data-tut="addRecipient"
                        onClick={() => props.setIsAddSigner(true)}
                        className="liquid-tool-btn border border-base-content/10 bg-base-100/60 shadow-sm"
                        title={t("add-recipient")}
                      >
                        <i className="fa-light fa-plus text-sm"></i>
                      </button>
                    )
                  )}
                </div>
              </div>
            )}

            <div data-tut="addWidgets" className="px-3 pb-1">
              <div className="flex items-center gap-2.5 overflow-x-auto hide-scrollbar scroll-smooth py-1">
                <WidgetList
                  updateWidgets={handleWidgetType}
                  handleDivClick={props.handleDivClick}
                  handleMouseLeave={props.handleMouseLeave}
                  signRef={signRef}
                  isMobileView={true}
                  addPositionOfSignature={props.addPositionOfSignature}
                />
              </div>
            </div>
          </div>
        )
      ) : (
        <div
          data-tut={props.dataTut}
          className={`${
            props.isMailSend ? "opacity-50 pointer-events-none" : ""
          } hidden md:flex flex-col h-[calc(100vh-64px)] liquid-glass-panel sticky top-0 select-none`}
        >
          {/* Header del Panel de Widgets con Liquid Glass */}
          <div className="px-3.5 py-2.5 flex items-center justify-between border-b border-base-content/10 bg-base-100/40 flex-shrink-0">
            <div className="flex items-center gap-2">

              <div className="w-6 h-6 rounded-lg bg-primary/10 text-primary flex items-center justify-center text-xs">
                <i className="fa-light fa-shapes"></i>
              </div>
              <span className="text-xs font-bold uppercase tracking-wider text-base-content/90">
                {t("widgets")}
              </span>
            </div>
            {props?.isSignYourself && (
              <button
                type="button"
                onClick={() => props.setIsTour && props.setIsTour(true)}
                className="w-6 h-6 rounded-full flex items-center justify-center text-base-content/50 hover:text-primary hover:bg-primary/10 transition-colors"
                title="Ayuda / Tour"
              >
                <i className="fa-light fa-circle-question text-xs"></i>
              </button>
            )}
          </div>

          {/* Grilla 2 Columnas de Widgets Cuadrados compactos */}
          <div
            className="p-3 grid grid-cols-2 gap-2.5 content-start overflow-y-auto autoSignScroll flex-1"
            data-tut="addWidgets"
            role="list"
            aria-label="Add widgets"
          >
            <WidgetList
              updateWidgets={handleWidgetType}
              handleDivClick={props.handleDivClick}
              handleMouseLeave={props.handleMouseLeave}
              signRef={signRef}
              isMobileView={false}
              addPositionOfSignature={props.addPositionOfSignature}
            />
          </div>
        </div>
      )}
      {isSignersModal && (
        <ModalUi
          title={props.title ? props.title : t("recipients")}
          isOpen={isSignersModal}
          handleClose={handleModal}
        >
          {props.signersdata.length > 0 || props.prefillSigner.length > 0 ? (
            <div className="max-h-[600px] overflow-auto pb-1">
              <RecipientList
                signerPos={props.signerPos}
                signersdata={props.signersdata}
                isSelectListId={props.isSelectListId}
                setIsSelectId={props.setIsSelectId}
                setUniqueId={props.setUniqueId}
                setRoleName={props.setRoleName}
                handleDeleteUser={props.handleDeleteUser}
                handleRoleChange={props.handleRoleChange}
                handleOnBlur={props.handleOnBlur}
                handleModal={handleModal}
                sendInOrder={props.sendInOrder}
                setSignersData={props.setSignersData}
                setBlockColor={props.setBlockColor}
                uniqueId={props.uniqueId}
                setSignerPos={props.setSignerPos}
                prefillSigner={props.prefillSigner}
              />
            </div>
          ) : (
            <div className=" p-[20px] text-[15px] font-medium text-center">
              {t("please-add")} {props.title ? props.title : t("recipients")}
            </div>
          )}
        </ModalUi>
      )}
    </>
  );
}

export default WidgetComponent;
