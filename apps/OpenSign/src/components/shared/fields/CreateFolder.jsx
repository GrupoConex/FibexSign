import React, { useState } from "react";
import Parse from "parse";
import Loader from "../../../primitives/Loader";
import { useTranslation } from "react-i18next";
import { notify, withSessionValidation } from "../../../utils";

const CreateFolder = ({ parentFolderId, onSuccess, folderCls, onBack }) => {
  const folderPtr = {
    __type: "Pointer",
    className: folderCls,
    objectId: parentFolderId
  };
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [isLoader, setIsLoader] = useState(false);
  const handleCreateFolder = withSessionValidation(async (event) => {
    event.preventDefault();
    handleLoader(true);
    if (name) {
      const currentUser = Parse.User.current();
      const exsitQuery = new Parse.Query(folderCls);
      exsitQuery.equalTo("Name", name);
      exsitQuery.equalTo("Type", "Folder");
      exsitQuery.notEqualTo("IsArchive", true);
      if (parentFolderId) {
        exsitQuery.equalTo("Folder", folderPtr);
      }
      const templExist = await exsitQuery.first();
      if (templExist) {
        notify.error(t("folder-already-exist"));
      } else {
        const template = new Parse.Object(folderCls);
        template.set("Name", name);
        template.set("Type", "Folder");
        if (parentFolderId) {
          template.set("Folder", folderPtr);
        }
        template.set("CreatedBy", Parse.User.createWithoutData(currentUser.id));
        const ExtCls = JSON.parse(localStorage.getItem("Extand_Class"));
        template.set("ExtUserPtr", {
          __type: "Pointer",
          className: "contracts_Users",
          objectId: ExtCls[0].objectId
        });
        const res = await template.save();
        if (res) {
          handleLoader(false);
          notify.success(t("folder-created-successfully"));
          onSuccess && onSuccess(res?.toJSON());
        }
      }
    } else {
      handleLoader(false);
      notify.info(t("fill-folder-name"));
    }
  });
  const handleLoader = (status) => setIsLoader(status);

  return (
    <div>
      <div id="createFolder" className="relative">
        {isLoader && (
          <div className="absolute h-full w-full flex justify-center items-center">
            <Loader />
          </div>
        )}
        <h1 className="text-base font-semibold mt-[0.4rem]">
          {t("create-folder")}
        </h1>
        <div className="text-xs mt-2">
          <label className="block">
            {t("name")}
            <span className="text-red-500 text-[13px]">*</span>
          </label>
          <input
            className="op-input op-input-bordered op-input-sm focus:outline-none hover:border-base-content w-full text-xs"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onInvalid={(e) => e.target.setCustomValidity(t("input-required"))}
            onInput={(e) => e.target.setCustomValidity("")}
            required
          />
        </div>
        <div className="flex justify-between items-center py-[1rem] ">
          <button
            onClick={handleCreateFolder}
            disabled={isLoader}
            className="op-btn op-btn-primary op-btn-sm"
          >
            <i className="fa-light fa-plus"></i>
            <span>{t("create")}</span>
          </button>
          {onBack && (
            <div
              className="op-btn op-btn-seconday op-btn-sm"
              title={t("back")}
              onClick={() => onBack()}
            >
              <i className="fa-light fa-arrow-left" aria-hidden="true"></i>
              <span className="text-xs">{t("back")}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CreateFolder;
