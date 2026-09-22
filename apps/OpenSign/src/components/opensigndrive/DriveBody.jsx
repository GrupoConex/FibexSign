import React, { memo, useState, useEffect, useRef } from "react";
import "../../styles/opensigndrive.css";
import axios from "axios";
import { ContextMenu } from "radix-ui";
import { useNavigate } from "react-router";
import { HoverCard } from "radix-ui";
import ModalUi from "../../primitives/ModalUi";
import FolderModal from "../shared/fields/FolderModal";
import { useTranslation } from "react-i18next";
import { handleDownloadPdf, isMobile } from "../../constant/Utils";
import Parse from "parse";
import { notify, withSessionValidation } from "../../utils";

function DriveBody(props) {
  const { t } = useTranslation();
  const [rename, setRename] = useState("");
  const [renameValue, setRenameValue] = useState("");
  const inputRef = useRef(null);
  const [isOpenMoveModal, setIsOpenMoveModal] = useState(false);
  const [selectDoc, setSelectDoc] = useState();
  const [isDeleteDoc, setIsDeleteDoc] = useState({});
  const contextMenu = [
    { type: "Download", icon: "fa-light fa-arrow-down" },
    { type: "Rename", icon: "fa-light fa-font" },
    { type: "Move", icon: "fa-light fa-file-export" },
    { type: "Delete", icon: "fa-light fa-trash" }
  ];
  const navigate = useNavigate();

  //to focus input box on press rename to change doc name
  useEffect(() => {
    if (rename && inputRef.current) {
      setTimeout(() => {
        inputRef.current.focus();
      }, 10);
    }
  }, [rename]);

  //function to handle folder component
  const handleOnclikFolder = (data) => {
    const folderData = {
      name: data.Name,
      objectId: data.objectId
    };
    props.setFolderName((prev) => [...prev, folderData]);
    props.setIsLoading({
      isLoad: true,
      message: t("loading-mssg")
    });
    props.setDocId(data.objectId);
    props.setPdfData([]);
    props.setSkip(0);
  };
  //function for change doc name and update doc name in  _document class
  const handledRenameDoc = withSessionValidation(async (data) => {
    setRename("");
    const trimmedValue = renameValue.trim();
    if (trimmedValue.length > 0) {
      const updateName = { Name: renameValue };
      const docId = data.objectId;
      const docData = props.pdfData;
      const updatedData = docData.map((item) => {
        if (item.objectId === docId) {
          // If the item's ID matches the target ID, update the name
          return { ...item, Name: renameValue };
        }
        // If the item's ID doesn't match, keep it unchanged
        return item;
      });
      props.setPdfData(updatedData);
      props.sortingData(null, null, updatedData);
      try {
        await axios.put(
          `${localStorage.getItem("baseUrl")}classes/contracts_Document/${docId}`,
          updateName,
          {
            headers: {
              "Content-Type": "application/json",
              "X-Parse-Application-Id": localStorage.getItem("parseAppId"),
              "X-Parse-Session-Token": localStorage.getItem("accesstoken")
            }
          }
        );
      } catch (err) {
        console.error("Error in rename doc", err);
        props.setIsAlert({
          isShow: true,
          alertMessage: t("something-went-wrong-mssg")
        });
      }
    }
  });

  //function for navigate user to microapp-signature component
  const checkPdfStatus = async (data) => {
    const signerExist = data?.Signers;
    const isDecline = data?.IsDeclined;
    const isPlaceholder = data?.Placeholders;
    const signedUrl = data?.SignedUrl;
    const isSignYourself = data?.IsSignyourself;
    //checking if document has completed and request signature flow
    if (data?.IsCompleted && signerExist?.length > 0) {
      navigate(`/recipientSignPdf/${data.objectId}`);
    }
    //checking if document has completed and signyour-self flow
    else if ((!signerExist && !isPlaceholder) || isSignYourself) {
      navigate(`/signaturePdf/${data.objectId}`);
    }
    //checking if document has declined by someone
    else if (isDecline) {
      navigate(`/recipientSignPdf/${data.objectId}`);
      //checking draft type document
    } else if (
      signerExist?.length > 0 &&
      isPlaceholder?.length > 0 &&
      !signedUrl
    ) {
      navigate(`/placeHolderSign/${data.objectId}`);
    }
    //Inprogress document
    else if (isPlaceholder?.length > 0 && signedUrl) {
      navigate(`/recipientSignPdf/${data.objectId}`);
    } //placeholder draft document
    else if (
      (signerExist?.length > 0 &&
        (!isPlaceholder || isPlaceholder?.length === 0)) ||
      ((!signerExist || signerExist?.length === 0) && isPlaceholder?.length > 0)
    ) {
      navigate(`/placeHolderSign/${data.objectId}`);
    }
  };

  const handleMenuItemClick = async (selectType, data, deleteType) => {
    switch (selectType) {
      case "Download": {
        await handleDownloadPdf([data]);
        break;
      }
      case "Rename": {
        setRenameValue(data.Name);
        setRename(data.objectId);
        break;
      }
      case "Delete": {
        setIsDeleteDoc({ status: true, deleteType });
        setSelectDoc(data);
        break;
      }
      case "Move": {
        handleMoveDocument(data);
        break;
      }
      default:
        null;
    }
  };
  //function for delete document
  const handleDeleteDocument = withSessionValidation(async (docData) => {
    setIsDeleteDoc({});
    const docId = docData.objectId;
    const data = { IsArchive: true };

    await axios
      .put(
        `${localStorage.getItem("baseUrl")}classes/contracts_Document/${docId}`,
        data,
        {
          headers: {
            "Content-Type": "application/json",
            "X-Parse-Application-Id": localStorage.getItem("parseAppId"),
            "X-Parse-Session-Token": localStorage.getItem("accesstoken")
          }
        }
      )
      .then((result) => {
        const res = result.data;
        if (res) {
          const updatedData = props.pdfData.filter((x) => x.objectId !== docId);
          props.setPdfData(updatedData);
        }
      })
      .catch((err) => {
        console.error("Err in delete doc", err);
        props.setIsAlert({
          isShow: true,
          alertMessage: t("something-went-wrong-mssg")
        });
      });
  });
  const handleMoveDocument = async (docData) => {
    setIsOpenMoveModal(true);
    setSelectDoc(docData);
  };
  //function for move document from one folder to another folder
  const handleMoveFolder = withSessionValidation(async (selectFolderData) => {
    const selecFolderId = selectDoc?.Folder?.objectId;
    const moveFolderId = selectFolderData?.ObjectId;
    let updateDocId = selectDoc?.objectId;
    let updateData;
    const checkExist = moveFolderId
      ? selecFolderId === moveFolderId
        ? true
        : false
      : selecFolderId
        ? false
        : true;
    if (!checkExist) {
      if (moveFolderId) {
        updateData = {
          Folder: {
            __type: "Pointer",
            className: "contracts_Document",
            objectId: moveFolderId
          }
        };
      } else {
        updateData = { Folder: { __op: "Delete" } };
      }

      await axios
        .put(
          `${localStorage.getItem("baseUrl")}classes/contracts_Document/${updateDocId}`,
          updateData,
          {
            headers: {
              "Content-Type": "application/json",
              "X-Parse-Application-Id": localStorage.getItem("parseAppId"),
              "X-Parse-Session-Token": localStorage.getItem("accesstoken")
            }
          }
        )
        .then((Listdata) => {
          const res = Listdata.data;
          if (res) {
            const updatedData = props.pdfData.filter(
              (x) => x.objectId !== updateDocId
            );
            props.setPdfData(updatedData);
          }
        })
        .catch((err) => {
          console.error("err in move folder", err);
        });

      setIsOpenMoveModal(false);
    } else {
      notify.warning(t("folder-already-exist!"));
      setIsOpenMoveModal(false);
    }
  });
  const handleEnterPress = (e, data) => {
    if (e.key === "Enter") {
      handledRenameDoc(data);
    }
  };

  const checkFolderEmpty = async (docData) => {
    let isEmptyFolder = true;
    const query = new Parse.Query("contracts_Document");
    query.equalTo("Folder", {
      __type: "Pointer",
      className: "contracts_Document",
      objectId: docData.objectId
    });
    query.notEqualTo("IsArchive", true);
    const res = await query.find();
    const jsonRes = JSON.parse(JSON.stringify(res));
    if (jsonRes && jsonRes.length > 0) {
      isEmptyFolder = false;
      return isEmptyFolder;
    } else {
      return isEmptyFolder;
    }
  };
  const handleDeleteFolder = async (docData) => {
    setIsDeleteDoc({});
    const isEmptyFolder = await checkFolderEmpty(docData);
    if (isEmptyFolder) {
      const docId = docData?.objectId;
      try {
        const updateQuery = new Parse.Query("contracts_Document");
        const updateObj = await updateQuery.get(docId);
        updateObj.set("IsArchive", true);
        const res = await updateObj.save();
        if (res) {
          const updatedData = props.pdfData.filter((x) => x.objectId !== docId);
          props.setPdfData(updatedData);
        }
      } catch (err) {
        console.error("Err in delete folder", err);
        props.setIsAlert({
          isShow: true,
          alertMessage: t("something-went-wrong-mssg")
        });
      }
    } else {
      notify.warning(t("delete-folder-alert-1"));
    }
  };

  const getStatusBadgeConfig = (status) => {
    switch (status) {
      case "Completed":
        return {
          badgeClass:
            "op-badge-success bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
          icon: "fa-light fa-check-circle"
        };
      case "Declined":
        return {
          badgeClass:
            "op-badge-error bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20",
          icon: "fa-light fa-circle-xmark"
        };
      case "Expired":
        return {
          badgeClass:
            "op-badge-ghost bg-slate-500/10 text-slate-500 dark:text-slate-400 border-slate-500/20",
          icon: "fa-light fa-hourglass-end"
        };
      case "Draft":
        return {
          badgeClass:
            "op-badge-info bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20",
          icon: "fa-light fa-file-lines"
        };
      case "In Progress":
      default:
        return {
          badgeClass:
            "op-badge-warning bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
          icon: "fa-light fa-paper-plane"
        };
    }
  };

  //component to handle type of document and render according to type
  const handleFolderData = (data, ind, listType) => {
    let createddate, status, isDecline, signerExist, isComplete;
    if (data.Type !== "Folder") {
      const expireDate = data.ExpiryDate && data.ExpiryDate.iso;
      const createdDate = data.createdAt && data.createdAt;
      createddate = new Date(createdDate).toLocaleDateString();
      isComplete = data.IsCompleted && data.IsCompleted ? true : false;
      isDecline = data.IsDeclined && data.IsDeclined;
      signerExist = data.Signers && data.Signers;
      const signedUrl = data.SignedUrl;

      const expireUpdateDate = new Date(expireDate).getTime();
      const currDate = new Date().getTime();
      let isExpire = false;
      if (currDate > expireUpdateDate) {
        isExpire = true;
      }

      if (isComplete) {
        status = "Completed";
      } else if (isDecline) {
        status = "Declined";
      } else if (!signedUrl) {
        status = "Draft";
      } else if (isExpire) {
        status = "Expired";
      } else {
        status = "In Progress";
      }
    }

    const { badgeClass, icon: statusIcon } = getStatusBadgeConfig(status);

    const signersName = () => {
      const getSignersName =
        signerExist?.length > 0 && signerExist?.map((data) => data?.Name || "");
      const signerName =
        getSignersName?.length > 0 ? getSignersName?.join(", ") : "";

      return (
        <span className="text-[11px] font-medium text-base-content/80 break-words">
          {signerName && signerName}
        </span>
      );
    };

    return listType === "table" ? (
      data.Type === "Folder" ? (
        <tr
          key={ind}
          onClick={() => handleOnclikFolder(data)}
          className="hover:bg-base-200/50 transition-colors cursor-pointer border-b border-base-200/60"
        >
          <td className="py-2.5 px-4 font-medium">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-500 flex items-center justify-center text-sm flex-shrink-0">
                <i className="fa-solid fa-folder"></i>
              </div>
              <span className="text-xs font-semibold text-base-content">
                {data.Name}
              </span>
            </div>
          </td>
          <td className="py-2.5 px-4 text-xs text-base-content/40">—</td>
          <td className="py-2.5 px-4">
            <span className="op-badge op-badge-ghost op-badge-xs py-1.5 px-2 text-[10px] font-medium">
              {t("folder") || "Carpeta"}
            </span>
          </td>
          <td className="py-2.5 px-4 text-xs text-base-content/40">—</td>
          <td className="py-2.5 px-4 text-right">
            <div className="text-base-content/40 pr-2">
              <i className="fa-light fa-chevron-right text-xs"></i>
            </div>
          </td>
        </tr>
      ) : (
        <tr
          key={ind}
          onClick={() => checkPdfStatus(data)}
          className="hover:bg-base-200/50 transition-colors cursor-pointer border-b border-base-200/60"
        >
          <td className="py-2.5 px-4 font-medium">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center text-sm flex-shrink-0">
                <i className="fa-solid fa-file-lines"></i>
              </div>
              <span className="text-xs font-semibold text-base-content line-clamp-1">
                {data.Name}
              </span>
            </div>
          </td>
          <td className="py-2.5 px-4 text-xs text-base-content/70">
            {createddate}
          </td>
          <td className="py-2.5 px-4">
            <span className="op-badge op-badge-ghost op-badge-xs py-1.5 px-2 text-[10px] font-bold uppercase tracking-wider">
              PDF
            </span>
          </td>
          <td className="py-2.5 px-4">
            <span
              className={`op-badge op-badge-xs py-2 px-2.5 text-[10px] font-medium border ${badgeClass}`}
            >
              <i className={`${statusIcon} text-[9px] mr-1`}></i>
              {t(`drive-document-status.${status}`)}
            </span>
          </td>
          <td className="py-2.5 px-4 text-right">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleMenuItemClick("Download", data);
              }}
              className="op-btn op-btn-ghost op-btn-xs op-btn-square text-base-content/70 hover:text-primary rounded-md"
              title={t("download") || "Descargar"}
            >
              <i className="fa-light fa-download text-xs"></i>
            </button>
          </td>
        </tr>
      )
    ) : listType === "list" && data.Type === "Folder" ? (
      <ContextMenu.Root key={ind}>
        <ContextMenu.Trigger asChild>
          <div
            data-tut={props.dataTutSeventh}
            onClick={() => {
              if (!rename) {
                handleOnclikFolder(data);
              }
            }}
            className="group relative flex flex-col justify-between p-3.5 pt-3 rounded-2xl liquid-folder-card cursor-pointer h-[185px] w-full select-none-cls transition-all duration-300"
          >
            {/* Pestaña física superior de la carpeta */}
            <div className="folder-tab-badge"></div>

            {/* Cabecera sutil para emparejar con el archivo */}
            <div className="flex items-center justify-end w-full h-5">
              <div className="opacity-0 group-hover:opacity-100 transition-opacity text-base-content/40 hover:text-base-content px-1">
                <i className="fa-light fa-ellipsis text-xs"></i>
              </div>
            </div>

            {/* Centro: Ilustración realista de Carpeta Apple multicapa */}
            <div className="flex flex-col items-center justify-center my-auto">
              <div className="relative w-16 h-12 flex items-center justify-center group-hover:scale-105 transition-transform duration-300">
                {/* Tapa trasera */}
                <div className="absolute top-0 w-14 h-10 rounded-lg bg-gradient-to-br from-amber-400 to-amber-600 shadow-sm opacity-90"></div>
                {/* Tab posterior */}
                <div className="absolute -top-1.5 left-1 w-6 h-3 rounded-t-md bg-amber-400 opacity-90"></div>
                {/* Solapa frontal con efecto traslúcido */}
                <div className="absolute bottom-0 w-16 h-10 rounded-xl bg-gradient-to-b from-amber-400/90 via-amber-500/80 to-amber-600/90 backdrop-blur-md shadow-md group-hover:-rotate-2 group-hover:translate-y-0.5 transition-all duration-300 flex items-center justify-center">
                  <i className="fa-solid fa-folder text-amber-100/60 text-base"></i>
                </div>
              </div>
            </div>

            {/* Pie: Nombre de carpeta truncado con elipsis + Badge */}
            <div className="w-full text-center">
              {rename === data.objectId ? (
                <input
                  onFocus={(e) => e.target.select()}
                  autoFocus={true}
                  type="text"
                  onBlur={() => handledRenameDoc(data)}
                  onKeyDown={(e) => handleEnterPress(e, data)}
                  ref={inputRef}
                  defaultValue={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  className="op-input op-input-bordered op-input-xs w-full text-xs rounded-lg text-center font-medium focus:outline-none"
                />
              ) : (
                <h4
                  className="text-xs font-semibold text-base-content truncate w-full block group-hover:text-amber-500 transition-colors leading-tight"
                  title={data.Name}
                >
                  {data.Name}
                </h4>
              )}
              <div className="mt-1.5 pt-1.5 border-t border-base-content/10 flex items-center justify-center">
                <span className="text-[10px] font-medium text-base-content/70 bg-base-200/80 px-2 py-0.5 rounded-full">
                  {t("folder") || "Carpeta"}
                </span>
              </div>
            </div>
          </div>
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content
            className="ContextMenuContent"
            sideOffset={5}
            align="end"
          >
            <ContextMenu.Item
              onClick={() => handleMenuItemClick("Rename", data)}
              className="ContextMenuItem"
            >
              <i className="fa-light fa-font mr-[8px]"></i>
              <span>{t(`context-menu.Rename`)}</span>
            </ContextMenu.Item>
            <ContextMenu.Item
              onClick={() => handleMenuItemClick("Delete", data, data.Type)}
              className="ContextMenuItem text-error"
            >
              <i className="fa-light fa-trash mr-[8px]"></i>
              <span>{t(`context-menu.Delete`)}</span>
            </ContextMenu.Item>
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>
    ) : (
      <HoverCard.Root
        key={ind}
        open={rename || isMobile ? false : undefined}
        openDelay={300}
        closeDelay={100}
      >
        <HoverCard.Trigger asChild>
          <div>
            <ContextMenu.Root>
              <ContextMenu.Trigger asChild>
                <div
                  data-tut={props.dataTutSixth}
                  onClick={() => {
                    if (!rename) {
                      checkPdfStatus(data);
                    }
                  }}
                  className="group relative flex flex-col justify-between p-3.5 pt-3 rounded-2xl liquid-file-card liquid-glass-card cursor-pointer h-[185px] w-full select-none-cls transition-all duration-300"
                >
                  {/* Cabecera del archivo: Badge de Estado arriba centrado */}
                  <div className="flex items-center justify-center w-full h-5">
                    <div
                      className={`op-badge op-badge-xs py-1 px-3 gap-1.5 font-medium shadow-sm backdrop-blur-md max-w-full ${badgeClass}`}
                      title={t(`drive-document-status.${status}`)}
                    >
                      <i className={`${statusIcon} text-[9px] flex-shrink-0`}></i>
                      <span className="text-[10px] truncate font-semibold">
                        {t(`drive-document-status.${status}`)}
                      </span>
                    </div>
                  </div>

                  {/* Centro: Ícono PDF vítreo centrado al medio (sin deformación) */}
                  <div className="flex flex-col items-center justify-center my-auto">
                    <div className="w-14 h-14 rounded-2xl bg-red-500/10 text-red-500 flex items-center justify-center text-2xl group-hover:scale-105 transition-transform duration-300 flex-shrink-0">
                      <i className="fa-solid fa-file-pdf"></i>
                    </div>
                  </div>

                  {/* Pie: Nombre de archivo truncado con elipsis + Metadata con Tag PDF */}
                  <div className="w-full text-center">
                    {rename === data.objectId ? (
                      <input
                        onFocus={(e) => e.target.select()}
                        autoFocus={true}
                        type="text"
                        onBlur={() => handledRenameDoc(data)}
                        onKeyDown={(e) => handleEnterPress(e, data, data.Type)}
                        ref={inputRef}
                        defaultValue={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        className="op-input op-input-bordered op-input-xs w-full text-xs rounded-lg font-medium focus:outline-none text-center"
                      />
                    ) : (
                      <h4
                        className="text-xs font-semibold text-base-content truncate w-full block group-hover:text-primary transition-colors leading-tight"
                        title={data.Name}
                      >
                        {data.Name}
                      </h4>
                    )}
                    <div className="flex items-center justify-between text-[10px] text-base-content/60 mt-1.5 pt-1.5 border-t border-base-content/10 font-medium">
                      <span className="truncate pr-1">{createddate}</span>
                      <span className="text-[9px] font-bold tracking-wider px-1.5 py-0.5 rounded bg-base-200/80 text-base-content/70 flex-shrink-0">
                        PDF
                      </span>
                    </div>
                  </div>
                </div>
              </ContextMenu.Trigger>
              <ContextMenu.Portal>
                <ContextMenu.Content
                  className="ContextMenuContent"
                  sideOffset={5}
                  align="end"
                >
                  {contextMenu.map((menu, indMenu) => {
                    return (
                      <ContextMenu.Item
                        key={indMenu}
                        onClick={() => handleMenuItemClick(menu.type, data)}
                        className={`ContextMenuItem ${
                          menu.type === "Delete" ? "text-error" : ""
                        }`}
                      >
                        <i className={`${menu.icon} mr-[8px]`}></i>
                        <span>{t(`context-menu.${menu.type}`)}</span>
                      </ContextMenu.Item>
                    );
                  })}
                </ContextMenu.Content>
              </ContextMenu.Portal>
            </ContextMenu.Root>
          </div>
        </HoverCard.Trigger>
        <HoverCard.Portal>
          <HoverCard.Content
            className="HoverCardContent text-left p-3.5 rounded-xl text-base-content shadow-xl border border-base-200"
            sideOffset={5}
          >
            <div className="text-xs font-bold text-base-content mb-2 line-clamp-2">
              {data.Name}
            </div>
            <div className="space-y-1.5 text-[11px] text-base-content/80">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-base-content/50">
                  {t("report-heading.Status")}:
                </span>
                <span className="font-medium text-base-content">
                  {t(`drive-document-status.${status}`)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-semibold text-base-content/50">
                  {t("report-heading.created-date")}:
                </span>
                <span>{createddate}</span>
              </div>
              {signerExist && signerExist?.length > 0 && (
                <div className="pt-1.5 border-t border-base-200">
                  <span className="font-semibold text-base-content/50 block mb-0.5">
                    {t("report-heading.Signers")}:
                  </span>
                  {signersName()}
                </div>
              )}
            </div>
            <HoverCard.Arrow className="HoverCardArrow" />
          </HoverCard.Content>
        </HoverCard.Portal>
      </HoverCard.Root>
    );
  };

  //component to handle type of document and render according to type
  return (
    <>
      {props.isList ? (
        <div className="overflow-x-auto w-full mt-1 rounded-xl border border-base-200/80">
          <table className="table op-table op-table-sm w-full">
            <thead className="bg-base-200/50 text-base-content/70 text-[11px] uppercase tracking-wider font-bold">
              <tr>
                <th className="py-3 px-4">{t("report-heading.Name")}</th>
                <th className="py-3 px-4">{t("report-heading.created-date")}</th>
                <th className="py-3 px-4">{t("report-heading.Type")}</th>
                <th className="py-3 px-4">{t("report-heading.Status")}</th>
                <th className="py-3 px-4 text-right">{t("action")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-base-200/60 text-xs">
              {props?.pdfData?.map((data, ind) => (
                <React.Fragment key={ind}>
                  {handleFolderData(data, ind, "table")}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid grid-cols-1 min-[340px]:grid-cols-2 min-[560px]:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-[repeat(auto-fill,minmax(165px,1fr))] gap-3 sm:gap-4 mt-3 pb-8">
          {props?.pdfData?.map((data, ind) => (
            <React.Fragment key={ind}>
              {handleFolderData(data, ind, "list")}
            </React.Fragment>
          ))}
        </div>
      )}

      {isOpenMoveModal && (
        <FolderModal
          onSuccess={handleMoveFolder}
          isOpenModal={isOpenMoveModal}
          folderCls={"contracts_Document"}
          setIsOpenMoveModal={setIsOpenMoveModal}
          setPdfData={props.setPdfData}
        />
      )}
      <ModalUi
        isOpen={isDeleteDoc.status}
        title={t("delete-document")}
        handleClose={() => setIsDeleteDoc({})}
      >
        <div className="p-5 text-base-content">
          <p className="text-sm mb-4">
            {isDeleteDoc.deleteType
              ? t("delete-folder-alert")
              : t("delete-document-alert")}
          </p>

          <div className="flex justify-end gap-2">
            <button
              onClick={() => setIsDeleteDoc({})}
              type="button"
              className="op-btn op-btn-ghost op-btn-sm rounded-lg"
            >
              {t("no")}
            </button>
            <button
              onClick={() => {
                if (isDeleteDoc.deleteType) {
                  handleDeleteFolder(selectDoc);
                } else {
                  handleDeleteDocument(selectDoc);
                }
              }}
              type="button"
              className="op-btn op-btn-error op-btn-sm rounded-lg"
            >
              {t("yes")}
            </button>
          </div>
        </div>
      </ModalUi>
    </>
  );
}

export default memo(DriveBody);
