import { useEffect, useRef } from "react";
import ModalUi from "../../primitives/ModalUi";

const ToggleStatusModal = ({ item, onConfirm, onClose, t }) => {
  const cancelBtnRef = useRef(null);

  useEffect(() => {
    cancelBtnRef.current?.focus();
  }, []);

  const handleKeyDown = (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
    }
  };

  return (
    <ModalUi isOpen title={t("user-status")} handleClose={onClose}>
      <div className="m-[20px]" onKeyDown={handleKeyDown}>
        <div className="text-lg font-normal text-base-content">
          {t("are-you-sure")}{" "}
          {item?.IsDisabled ? t("activate") : t("deactivate")}{" "}
          {t("this-user")}?
        </div>
        <hr className="border-t border-base-200 mt-4" />
        <div className="flex items-center mt-3 gap-2 text-white">
          <button
            type="button"
            onClick={() => onConfirm(item)}
            className="op-btn op-btn-primary"
          >
            {t("yes")}
          </button>
          <button
            type="button"
            ref={cancelBtnRef}
            onClick={onClose}
            className="op-btn op-btn-secondary"
          >
            {t("no")}
          </button>
        </div>
      </div>
    </ModalUi>
  );
};

export default ToggleStatusModal;
