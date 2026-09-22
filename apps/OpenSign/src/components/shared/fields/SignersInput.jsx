import React, { useState, useEffect } from "react";
import AsyncSelect from "react-select/async";
import AddContact from "../../../primitives/AddContact";
import Tooltip from "../../../primitives/Tooltip";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { findContact } from "../../../constant/Utils";
function arrayMove(array, from, to) {
  array = array.slice();
  array.splice(to < 0 ? array.length + to : to, 0, array.splice(from, 1)[0]);
  return array;
}

const AddSignerModal = ({ isOpen, children }) => {
  if (!isOpen) {
    return null;
  }

  return createPortal(
    <div className="op-modal op-modal-open">
      <div className="op-modal-box p-0 min-w-[90%] md:min-w-[500px] max-h-90 overflow-y-auto hide-scrollbar text-sm">
        {children}
      </div>
    </div>,
    document.body
  );
};

/**
 * react-sortable-hoc is depcreated not usable from react 18.x.x
 *  need to replace it with @dnd-kit
 * code changes required
 */

const SignersInput = (props) => {
  const { t } = useTranslation();
  const [state, setState] = useState(undefined);
  const [selected, setSelected] = useState([]);
  const [isModal, setIsModel] = useState(false);
  const [modalIsOpen, setModalIsOpen] = useState(false);

  useEffect(() => {
    // to provide initial data for selected list items in Bcc for edit template
    if (props?.initialData && props?.initialData?.length > 0) {
      const trimEmail = props?.initialData.map((item) => ({
        value: item?.objectId,
        label: item?.Name,
        email: item?.Email
      }));
      setSelected(trimEmail);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const onChange = (selectedOptions) => {
    if (selectedOptions && selectedOptions?.length > 0) {
      const trimEmail = selectedOptions.map((item) => ({
        ...item,
        label: item?.label?.split("<")?.shift()
      }));
      setSelected(trimEmail);
    } else {
      setSelected(selectedOptions);
    }
  };

  const onSortEnd = ({ oldIndex, newIndex }) => {
    const newValue = arrayMove(selected, oldIndex, newIndex);
    setSelected(newValue);
  };

  useEffect(() => {
    if (props.isReset && props.isReset === true) {
      setSelected([]);
    }
  }, [props.isReset]);

  useEffect(() => {
    if (selected && selected.length) {
      let newData = [];
      selected.forEach((x) => {
        if (props?.isCaptureAllData) {
          newData.push(x);
        } else {
          newData.push(x.value);
        }
      });
      if (props.onChange) {
        props.onChange(newData);
      }
    }

    // eslint-disable-next-line
  }, [selected]);

  const handleModalCloseClick = () => {
    setIsModel(false);
    setModalIsOpen(false);
  };

  const openModal = () => {
    setModalIsOpen(true);
  };

  // `handleNewDetails` is used to set just save from quick form to selected option in dropdown
  const handleNewDetails = (data) => {
    const user = {
      value: data["objectId"],
      label: data["Name"],
      email: data?.Email
    };
    setState([...state, user]);
    if (selected.length > 0) {
      setSelected([...selected, user]);
    } else {
      setSelected([user]);
    }
  };
  const loadOptions = async (inputValue) => {
    try {
      const contactRes = await findContact(
        inputValue,
      );
      if (contactRes) {
        const res = JSON.parse(JSON.stringify(contactRes));
        //compareArrays is a function where compare between two array (total signersList and document signers list)
        //and filter signers from total signer's list which already present in document's signers list
        const compareArrays = (res, signerObj) => {
          return res.filter(
            (item1) =>
              !signerObj.find((item2) => item2.objectId === item1.objectId)
          );
        };

        //get update signer's List if signersdata is present
        const updateSignersList =
          props?.signersData && compareArrays(res, props?.signersData);

        const result = updateSignersList ? updateSignersList : res;
        setState(result);
        return await result.map((item) => ({
          label: item.Name + "<" + item.Email + ">",
          value: item.objectId,
          email: item.Email,
          isChecked: true
        }));
      }
    } catch (error) {
      console.log("err", error);
    }
  };
  return (
    <div className="text-xs">
      <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-base-content mb-1">
        <span>{props.label ? props.label : t("signers", "Firmantes")}</span>
        {props.required && <span className="text-red-500 text-xs">*</span>}
        <span className="inline-flex items-center text-xs text-blue-500">
          <Tooltip
            id={`${props.label ? props.label : "signers"}-tooltip`}
            message={props.helpText ? props.helpText : t("signers-help", "Seleccione o agregue los firmantes del documento")}
          />
        </span>
      </label>
      <div className="flex items-center gap-2">
        <div
          className={`flex-1 min-w-0 z-[${props?.zindex ? props.zindex : 40}]`}
        >
          <AsyncSelect
            onSortEnd={onSortEnd}
            distance={4}
            isMulti
            cacheOptions
            defaultOptions
            placeholder={props.placeholder || t("select-signers-placeholder", "Seleccionar firmantes...")}
            options={state || []}
            value={selected}
            onChange={onChange}
            closeMenuOnSelect={false}
            required={props.required}
            loadingMessage={() => t("loading", "Cargando...")}
            noOptionsMessage={() => t("contact-not-found", "Contacto no encontrado")}
            loadOptions={loadOptions}
            unstyled
            classNames={{
              control: ({ isFocused }) =>
                `op-input flex items-center min-h-[36px] w-full px-2.5 py-1 text-xs rounded-lg border transition-all ${
                  isFocused
                    ? "border-blue-500 ring-1 ring-blue-500/20"
                    : "hover:border-blue-500/50"
                }`,
              valueContainer: () => "flex flex-wrap items-center gap-1.5 flex-1 min-w-0 py-0.5",
              input: () => "text-xs text-base-content m-0 p-0",
              placeholder: () => "text-xs text-base-content/40 select-none",
              singleValue: () => "text-xs text-base-content",
              multiValue: () =>
                "inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-500/15 text-blue-400 border border-blue-500/30 text-[11px] font-medium",
              multiValueLabel: () => "truncate max-w-[180px]",
              multiValueRemove: () =>
                "text-blue-400 hover:text-red-400 hover:bg-red-500/20 rounded p-0.5 transition-colors cursor-pointer",
              indicatorsContainer: () => "flex items-center gap-1 text-base-content/50 hover:text-base-content",
              dropdownIndicator: () => "p-0.5 cursor-pointer text-base-content/50",
              clearIndicator: () => "p-0.5 cursor-pointer hover:text-red-400 transition-colors",
              menu: () =>
                "mt-1.5 shadow-xl rounded-xl bg-base-100 text-base-content border border-[#243046] overflow-hidden z-[9999]",
              menuList: () => "p-1.5 max-h-60 overflow-y-auto",
              option: ({ isFocused, isSelected }) =>
                `px-3 py-2 text-xs rounded-lg cursor-pointer transition-colors ${
                  isSelected
                    ? "bg-blue-600 text-white font-medium"
                    : isFocused
                    ? "bg-blue-500/15 text-blue-400"
                    : "text-base-content hover:bg-base-200"
                }`,
              noOptionsMessage: () => "p-3 text-xs text-base-content/50 text-center"
            }}
          />
        </div>
        <button
          type="button"
          onClick={() => {
            setIsModel(true);
            openModal();
          }}
          className="cursor-pointer op-btn op-btn-sm bg-blue-600 hover:bg-blue-700 text-white border-none min-w-[36px] h-[36px] flex justify-center items-center rounded-lg transition-all flex-shrink-0 shadow-sm"
          title={t("add-contact", "Agregar contacto")}
        >
          <i className="fa-light fa-plus text-sm"></i>
        </button>
        <AddSignerModal isOpen={modalIsOpen}>
          <h3 className="text-base-content font-bold text-lg pt-[15px] px-[20px]">
            {t("add-contact")}
          </h3>
          <button
            onClick={handleModalCloseClick}
            className="op-btn op-btn-sm op-btn-circle op-btn-ghost text-base-content absolute right-2 top-2"
          >
            ✕
          </button>
          {isModal && (
            <AddContact
              isDisableTitle
              isAddYourSelfCheckbox={props?.isAddYourSelfCheckbox}
              details={handleNewDetails}
              closePopup={handleModalCloseClick}
            />
          )}
        </AddSignerModal>
      </div>
    </div>
  );
};

export default SignersInput;
