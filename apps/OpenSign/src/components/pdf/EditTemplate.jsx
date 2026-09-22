import {
  useState,
  useRef,
} from "react";
import {
  base64ToArrayBuffer,
  convertBase64ToFile,
  generatePdfName,
  getFileName
} from "../../constant/Utils";
import {
  maxDescriptionLength,
  maxNoteLength,
  maxTitleLength
} from "../../constant/const";
import { useTranslation } from "react-i18next";
import { Tooltip } from "react-tooltip";
import SignersInput from "../shared/fields/SignersInput";
import { PDFDocument } from "pdf-lib";
import ModalUi from "../../primitives/ModalUi";
import { SaveFileSize } from "../../constant/saveFileSize";
import { notify } from "../../utils";

const EditTemplate = ({
  title,
  handleClose,
  pdfbase64,
  template,
  onSuccess,
  setPdfArrayBuffer,
  setPdfBase64Url,
  isAddYourSelfCheckbox,
}) => {
  const appName = "FibexSign";
  const { t } = useTranslation();
  const inputFileRef = useRef(null);
  const [formData, setFormData] = useState({
    Name: template?.Name || "",
    Note: template?.Note || "",
    Description: template?.Description || "",
    SendinOrder: template?.SendinOrder ? `${template?.SendinOrder}` : "false",
    SendInOrderStrict:
      template?.SendInOrderStrict === true ? "true" : "false",
    AutomaticReminders: template?.AutomaticReminders || false,
    RemindOnceInEvery: template?.RemindOnceInEvery || 5,
    IsEnableOTP: template?.IsEnableOTP ? `${template?.IsEnableOTP}` : "false",
    IsTourEnabled: template?.IsTourEnabled
      ? `${template?.IsTourEnabled}`
      : "false",
    NotifyOnSignatures:
      template?.NotifyOnSignatures !== undefined
        ? template?.NotifyOnSignatures
        : false,
    Bcc: template?.Bcc,
    Cc: template?.Cc,
    RedirectUrl: template?.RedirectUrl || "",
    AllowModifications: template?.AllowModifications || false,
    TimeToCompleteDays: template?.TimeToCompleteDays || 15,
  });
  const pensList = ["blue", "red", "black"];
  const [selectedColors, setSelectedColors] = useState(
    template?.PenColors || pensList
  );
  const [isUpdate, setIsUpdate] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isAdvanceOpt, setIsAdvanceOpt] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadPdf, setUploadPdf] = useState({
    name: "",
    base64: "",
    url: "",
    fileName: "",
    fileSize: 0
  });

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };
  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    handleFile(file);
  };

  const handleFile = (file) => {
    if (file && file.type === "application/pdf") {
      handleReplaceFileValdition(file);
    } else {
      notify.warning(t("only-pdf-allowed", "Solo se permiten archivos PDF"));
      if (inputFileRef.current) inputFileRef.current.value = "";
    }
  };

  // `isValidURL` is used to check valid webhook url
  function isValidURL(value) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" || url.protocol === "http:";
    } catch (error) {
      return false;
    }
  }

  const handleStrInput = (e) => {
    setIsUpdate(true);
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };
  const getPdfMetadataHash = async (pdfBytes) => {
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const pages = pdfDoc.getPages();
    const metaString = pages
      .map((page, index) => {
        const { width, height } = page.getSize();
        return `${index + 1}:${Math.round(width)}x${Math.round(height)}`;
      })
      .join("|");
    const encoder = new TextEncoder();
    const data = encoder.encode(metaString);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  };

  const handleFileInput = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    handleReplaceFileValdition(file);
  };
  const handleReplaceFileValdition = async (file) => {
    try {
      const basePdfBytes = base64ToArrayBuffer(pdfbase64);
      const expectedHash = await getPdfMetadataHash(basePdfBytes);
      const fileReader = new FileReader();
      fileReader.onload = async (event) => {
        const uploadedPdfBytes = event.target.result;
        const uploadedHash = await getPdfMetadataHash(uploadedPdfBytes);

        if (expectedHash === uploadedHash) {
          const arrayBuffer = uploadedPdfBytes;
          const uint8Array = new Uint8Array(arrayBuffer);
          const binaryString = Array.from(uint8Array)
            .map((b) => String.fromCharCode(b))
            .join("");
          const base64 = btoa(binaryString);
          const pdfName = generatePdfName(16);
          setIsUpdate(true);
          setUploadPdf((prev) => ({
            ...prev,
            name: pdfName,
            base64: base64,
            fileName: file.name,
            fileSize: file.size
          }));
          notify.success(t("file-replaced-successfully", "Archivo PDF verificado y listo para actualizar"));
        } else {
          notify.error(t("pdf-mismatch", "❌ El PDF no coincide en número de páginas o dimensiones con el original"));
          if (inputFileRef.current) inputFileRef.current.value = "";
        }
      };

      fileReader.readAsArrayBuffer(file);
    } catch (err) {
      notify.error("Error: " + err.message);
      if (inputFileRef.current) inputFileRef.current.value = "";
    }
  };
  // Define a function to handle form submission
  const handleSubmit = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (formData.RedirectUrl && !isValidURL(formData?.RedirectUrl)) {
      notify.warning(t("invalid-redirect-url"));
      return;
    }
    if (formData?.Name?.length > maxTitleLength) {
      notify.warning(t("title-length-alert"));
      return;
    }
    if (formData?.Note?.length > maxNoteLength) {
      notify.warning(t("note-length-alert"));
      return;
    }
    if (formData?.Description?.length > maxDescriptionLength) {
      notify.warning(t("description-length-alert"));
      return;
    }
    let pdfUrl;
    if (uploadPdf?.base64) {
      pdfUrl = await convertBase64ToFile(
        uploadPdf.name,
        uploadPdf.base64,
      );
      setUploadPdf((prev) => ({ ...prev, url: pdfUrl }));
      const pdfBuffer = base64ToArrayBuffer(uploadPdf.base64);
      setPdfArrayBuffer && setPdfArrayBuffer(pdfBuffer);
      setPdfBase64Url && setPdfBase64Url(uploadPdf.base64);
      const tenantId =
        localStorage.getItem("TenantId") ||
        template?.ExtUserPtr?.TenantId?.objectId;
      const buffer = atob(uploadPdf.base64);
      const userId = template?.ExtUserPtr?.UserId?.objectId;
      SaveFileSize(buffer.length, pdfUrl, tenantId, userId);
    }
    const isChecked = formData.SendinOrder === "true" ? true : false;
    const isStrictOrder =
      isChecked && formData.SendInOrderStrict === "true";
    const isTourEnabled = formData?.IsTourEnabled === "false" ? false : true;
    const AutoReminder = formData?.AutomaticReminders || false;
    const IsEnableOTP = formData.IsEnableOTP === "true" ? true : false;
    const allowModify = formData?.AllowModifications || false;
    let reminderDate = {};
    const remindOnceInEvery = formData?.RemindOnceInEvery;
    const TimeToCompleteDays = parseInt(formData?.TimeToCompleteDays);
    const reminderCount = TimeToCompleteDays / remindOnceInEvery;
    if (AutoReminder && reminderCount > 15) {
      notify.warning(t("only-15-reminder-allowed"));
      return;
    }
    if (AutoReminder) {
      const RemindOnceInEvery = parseInt(formData?.RemindOnceInEvery);
      const ReminderDate = new Date(template?.createdAt);
      ReminderDate.setDate(ReminderDate.getDate() + RemindOnceInEvery);
      reminderDate = { NextReminderDate: ReminderDate };
    }
    const data = {
      ...formData,
      ...(pdfUrl ? { URL: pdfUrl } : {}),
      SendinOrder: isChecked,
      SendInOrderStrict: isStrictOrder,
      IsEnableOTP: IsEnableOTP,
      IsTourEnabled: isTourEnabled,
      AllowModifications: allowModify,
      PenColors: selectedColors,
      ...reminderDate
    };
    onSuccess(data);
  };

  // `handleNotifySignChange` is trigger when user change radio of notify on signatures
  const handleNotifySignChange = (value) => {
    setIsUpdate(true);
    setFormData((obj) => ({ ...obj, NotifyOnSignatures: value }));
  };
  const handleBcc = (data) => {
    if (data && data.length > 0) {
      const trimEmail = data.map((item) => ({
        objectId: item?.value,
        Name: item?.label,
        Email: item?.email
      }));
      setIsUpdate(true);
      setFormData((prev) => ({ ...prev, Bcc: trimEmail }));
    }
  };

  const handleCc = (data) => {
    if (data && data.length > 0) {
      const trimEmail = data.map((item) => ({
        objectId: item?.value,
        Name: item?.label,
        Email: item?.email
      }));
      setIsUpdate(true);
      setFormData((prev) => ({ ...prev, Cc: trimEmail }));
    }
  };

  const handleEditTemplateClose = () => {
    if (isUpdate) {
      setShowConfirm(true);
    } else {
      handleClose();
    }
  };
  const discardChanges = () => {
    setShowConfirm(false);
    handleClose();
  };

  const handleColorsChange = (color) => {
    setSelectedColors((prev) => {
      // If user tries to uncheck the last remaining color → block it
      if (prev.length === 1 && prev.includes(color)) {
        return prev;
      }

      // Normal toggle behavior
      return prev.includes(color)
        ? prev.filter((c) => c !== color) // remove
        : [...prev, color]; // add
    });
  };

  const reminderCustomWarning = (e) => {
    if (!formData.RemindOnceInEvery || formData.RemindOnceInEvery === 0) {
      return e.target.setCustomValidity(t("input-required"));
    } else {
      return e.target.setCustomValidity(t("reminder-error"));
    }
  };

  const handleRemoveReplacementFile = (e) => {
    e?.stopPropagation?.();
    setUploadPdf({
      name: "",
      base64: "",
      url: "",
      fileName: "",
      fileSize: 0
    });
    if (inputFileRef.current) inputFileRef.current.value = "";
    setIsUpdate(true);
  };

  const formatFileSize = (bytes) => {
    if (!bytes || bytes === 0) return "0 KB";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  const currentFileName = template?.URL
    ? getFileName(template.URL)
    : template?.Name || "documento.pdf";

  return (
    <ModalUi
      isOpen
      showHeader={false}
      reduceWidth="w-11/12 max-w-2xl md:max-w-3xl !max-h-[92vh] flex flex-col p-0 overflow-hidden rounded-2xl border border-slate-200 opensigndark:border-[#243046] shadow-2xl bg-white opensigndark:!bg-[#101828] text-slate-800 opensigndark:text-slate-100"
      handleClose={handleEditTemplateClose}
    >
      {/* Modal de confirmación para descartar cambios */}
      <ModalUi
        isOpen={showConfirm}
        showHeader={false}
        showClose={false}
        reduceWidth="w-11/12 max-w-md p-0 overflow-hidden rounded-2xl border border-slate-200 opensigndark:border-[#243046] bg-white opensigndark:!bg-[#101828] text-slate-800 opensigndark:text-slate-100 shadow-2xl"
      >
        <div className="p-6 flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-500 flex items-center justify-center text-xl flex-shrink-0">
              <i className="fa-light fa-triangle-exclamation"></i>
            </div>
            <div>
              <h4 className="text-base font-bold text-slate-800 opensigndark:text-white">
                {t("unsaved-changes-title", "¿Descartar cambios?")}
              </h4>
              <p className="text-xs text-slate-500 opensigndark:text-slate-400 mt-0.5">
                {t("unsaved-changes-discard-them?", "Tienes cambios sin guardar. ¿Deseas descartarlos y salir?")}
              </p>
            </div>
          </div>
          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-200 opensigndark:border-[#243046]">
            <button
              type="button"
              className="op-btn op-btn-ghost op-btn-sm text-xs rounded-lg text-slate-600 opensigndark:text-slate-400 hover:text-slate-900 opensigndark:hover:text-white"
              onClick={() => setShowConfirm(false)}
            >
              {t("continue-editing", "Continuar editando")}
            </button>
            <button
              type="button"
              className="op-btn op-btn-error op-btn-sm text-xs rounded-lg text-white"
              onClick={discardChanges}
            >
              {t("yes-discard", "Sí, descartar")}
            </button>
          </div>
        </div>
      </ModalUi>

      {/* Header del Modal */}
      <div className="px-6 py-4 border-b border-slate-200 opensigndark:border-[#243046] flex items-center justify-between bg-slate-50 opensigndark:!bg-[#162032] flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-blue-500/10 text-blue-600 opensigndark:text-blue-400 flex items-center justify-center text-lg flex-shrink-0">
            <i className="fa-light fa-pen-to-square"></i>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-slate-900 opensigndark:text-white tracking-tight">
                {title}
              </h2>
              {isUpdate ? (
                <span className="text-[10px] font-semibold bg-amber-500/10 text-amber-600 opensigndark:text-amber-400 px-2 py-0.5 rounded-full flex items-center gap-1 border border-amber-500/20">
                  <i className="fa-solid fa-circle text-[6px] animate-pulse"></i>
                  <span>{t("unsaved", "Sin guardar")}</span>
                </span>
              ) : (
                <span className="text-[10px] font-semibold bg-blue-500/10 text-blue-600 opensigndark:text-blue-400 px-2 py-0.5 rounded-full">
                  {t("edit-mode", "Edición")}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 opensigndark:text-slate-400 mt-0.5">
              {t("edit-document-description", "Actualiza los datos del documento o reemplaza el PDF original")}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleEditTemplateClose}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-600 opensigndark:hover:text-white hover:bg-slate-200/60 opensigndark:hover:bg-slate-800/80 transition-colors"
          title={t("close", "Cerrar")}
        >
          <i className="fa-light fa-xmark text-lg"></i>
        </button>
      </div>

      {/* Formulario y Contenido */}
      <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0 bg-white opensigndark:!bg-[#101828]">
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* 1. Bloque de Reemplazo de Archivo */}
          <div className="p-4 rounded-xl border border-slate-200 opensigndark:border-[#243046] bg-slate-50 opensigndark:!bg-[#162032] flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-800 opensigndark:text-slate-200 flex items-center gap-2">
                <i className="fa-light fa-file-pdf text-red-500 text-sm"></i>
                <span>{t("report-heading.File") || "Archivo del documento"}</span>
              </label>
              {uploadPdf?.name ? (
                <span className="text-[11px] text-green-600 opensigndark:text-green-400 font-medium bg-green-500/10 px-2.5 py-0.5 rounded-full flex items-center gap-1 border border-green-500/20">
                  <i className="fa-solid fa-circle-check text-[9px]"></i>
                  <span>{t("replacement-ready", "Reemplazo listo")}</span>
                </span>
              ) : (
                <span className="text-[11px] text-slate-600 opensigndark:text-slate-300 bg-slate-200/70 opensigndark:bg-[#101828] border border-slate-300/50 opensigndark:border-[#243046] px-2.5 py-0.5 rounded-md">
                  {t("original-active", "Archivo actual activo")}
                </span>
              )}
            </div>

            {uploadPdf?.name ? (
              /* Archivo de reemplazo seleccionado */
              <div className="rounded-xl border border-green-500/30 bg-green-50/50 opensigndark:bg-green-500/10 p-3.5 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-lg bg-green-500/10 text-green-600 opensigndark:text-green-400 flex items-center justify-center flex-shrink-0 text-lg">
                    <i className="fa-light fa-file-arrow-up"></i>
                  </div>
                  <div className="min-w-0">
                    <p
                      className="text-xs font-semibold text-slate-800 opensigndark:text-white truncate"
                      title={uploadPdf.fileName || uploadPdf.name}
                    >
                      {uploadPdf.fileName || `${uploadPdf.name}.pdf`}
                    </p>
                    <p className="text-[11px] text-slate-500 opensigndark:text-slate-400 mt-0.5">
                      {uploadPdf.fileSize ? formatFileSize(uploadPdf.fileSize) : "PDF"} • {t("verified-match", "Dimensiones y páginas compatibles")}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => inputFileRef.current?.click()}
                    className="text-xs font-semibold text-blue-600 opensigndark:text-blue-400 hover:underline px-2 py-1"
                  >
                    {t("replace-file", "Cambiar")}
                  </button>
                  <button
                    type="button"
                    onClick={handleRemoveReplacementFile}
                    className="text-xs font-medium text-red-500 hover:text-red-600 opensigndark:hover:text-red-400 p-1.5 rounded-md hover:bg-red-50 opensigndark:hover:bg-red-500/10 transition-colors"
                    title={t("revert", "Revertir")}
                  >
                    <i className="fa-light fa-trash-can text-sm"></i>
                  </button>
                </div>
              </div>
            ) : (
              /* Drag & Drop Zone */
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => inputFileRef?.current?.click()}
                className={`border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-all duration-200 flex flex-col items-center justify-center group ${
                  isDragging
                    ? "border-blue-500 bg-blue-50/50 opensigndark:bg-blue-500/10 scale-[1.005]"
                    : "border-slate-300 opensigndark:border-[#243046] hover:border-blue-500/70 bg-white opensigndark:!bg-[#101828] hover:bg-blue-50/30 opensigndark:hover:bg-[#131d31]"
                }`}
              >
                <div className="w-10 h-10 rounded-xl bg-blue-50 opensigndark:bg-blue-500/10 text-blue-600 opensigndark:text-blue-400 flex items-center justify-center mb-1.5 group-hover:scale-110 transition-transform">
                  <i className="fa-light fa-cloud-arrow-up text-lg"></i>
                </div>
                <p className="text-xs font-semibold text-slate-800 opensigndark:text-white mb-0.5">
                  {t("drag-or-click-to-replace", "Arrastra o haz clic para reemplazar el archivo existente")}
                </p>
                <p className="text-[11px] text-slate-500 opensigndark:text-slate-400">
                  {t("pdf-replace-hint", "Solo PDF con el mismo número de páginas y dimensiones")}
                </p>
                {currentFileName && (
                  <div className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-medium bg-slate-100 opensigndark:bg-[#162032] border border-slate-200 opensigndark:border-[#243046] text-slate-600 opensigndark:text-slate-300 max-w-[90%] truncate">
                    <i className="fa-light fa-file text-slate-400 opensigndark:text-slate-400"></i>
                    <span className="truncate">{currentFileName}</span>
                  </div>
                )}
              </div>
            )}

            <input
              ref={inputFileRef}
              type="file"
              className="hidden"
              accept="application/pdf"
              onChange={(e) => handleFileInput(e)}
            />
          </div>

          {/* 2. Información del Documento */}
          <div className="space-y-3.5">
            {/* Título */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 opensigndark:text-slate-200 mb-1">
                {t("Title")}
                <span className="text-red-500 text-xs ml-0.5">*</span>
              </label>
              <input
                type="text"
                name="Name"
                value={formData.Name}
                onChange={handleStrInput}
                placeholder={t("enter-document-title", "Ingrese el título del documento")}
                className="op-input op-input-sm focus:outline-none border border-slate-200 opensigndark:border-[#243046] focus:border-blue-500 w-full text-xs rounded-lg bg-white opensigndark:!bg-[#101828] text-slate-800 opensigndark:text-white placeholder:text-slate-400 opensigndark:placeholder:text-slate-500"
                onInvalid={(e) => e.target.setCustomValidity(t("input-required"))}
                onInput={(e) => e.target.setCustomValidity("")}
                required
              />
            </div>

            {/* Grid 2 Columnas: Nota y Descripción */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              <div>
                <label htmlFor="Note" className="block text-xs font-semibold text-slate-700 opensigndark:text-slate-200 mb-1">
                  {t("report-heading.Note")}
                </label>
                <input
                  type="text"
                  name="Note"
                  id="Note"
                  value={formData.Note}
                  onChange={handleStrInput}
                  placeholder={t("enter-note", "Mensaje o nota para los firmantes")}
                  className="op-input op-input-sm focus:outline-none border border-slate-200 opensigndark:border-[#243046] focus:border-blue-500 w-full text-xs rounded-lg bg-white opensigndark:!bg-[#101828] text-slate-800 opensigndark:text-white placeholder:text-slate-400 opensigndark:placeholder:text-slate-500"
                />
              </div>

              <div>
                <label htmlFor="Description" className="block text-xs font-semibold text-slate-700 opensigndark:text-slate-200 mb-1">
                  {t("description")}
                </label>
                <input
                  type="text"
                  name="Description"
                  id="Description"
                  value={formData.Description}
                  onChange={handleStrInput}
                  placeholder={t("enter-description", "Descripción opcional del documento")}
                  className="op-input op-input-sm focus:outline-none border border-slate-200 opensigndark:border-[#243046] focus:border-blue-500 w-full text-xs rounded-lg bg-white opensigndark:!bg-[#101828] text-slate-800 opensigndark:text-white placeholder:text-slate-400 opensigndark:placeholder:text-slate-500"
                />
              </div>
            </div>
          </div>

          {/* 3. Enviar en orden */}
          <div className="flex flex-col gap-2.5 p-3.5 rounded-xl bg-slate-50 opensigndark:!bg-[#162032] border border-slate-200 opensigndark:border-[#243046]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <i className="fa-light fa-list-ol text-blue-600 opensigndark:text-blue-400 text-xs"></i>
                <span className="text-xs font-semibold text-slate-800 opensigndark:text-slate-200">
                  {t("send-in-order")}
                </span>
                <a
                  data-tooltip-id="sendInOrder-edit-tooltip"
                  className="cursor-pointer text-blue-600 opensigndark:text-blue-400 opacity-80 hover:opacity-100"
                >
                  <i className="fa-light fa-circle-question text-xs"></i>
                </a>
                <Tooltip id="sendInOrder-edit-tooltip" className="z-[999]">
                  <div className="max-w-[280px] text-xs">
                    <p className="font-bold mb-1">{t("send-in-order")}</p>
                    <p>{t("send-in-order-help.p1")}</p>
                  </div>
                </Tooltip>
              </div>

              <div className="flex items-center bg-slate-200/70 opensigndark:bg-[#101828] p-0.5 rounded-lg border border-slate-300/60 opensigndark:border-[#243046]">
                <button
                  type="button"
                  onClick={() => {
                    setIsUpdate(true);
                    setFormData({ ...formData, SendinOrder: "true" });
                  }}
                  className={`px-3 py-1 rounded-md text-xs font-semibold transition-all ${
                    formData.SendinOrder === "true"
                      ? "bg-blue-600 text-white shadow-sm"
                      : "text-slate-600 opensigndark:text-slate-400 hover:text-slate-900 opensigndark:hover:text-white"
                  }`}
                >
                  {t("yes")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsUpdate(true);
                    setFormData({
                      ...formData,
                      SendinOrder: "false",
                      SendInOrderStrict: "false"
                    });
                  }}
                  className={`px-3 py-1 rounded-md text-xs font-semibold transition-all ${
                    formData.SendinOrder === "false"
                      ? "bg-blue-600 text-white shadow-sm"
                      : "text-slate-600 opensigndark:text-slate-400 hover:text-slate-900 opensigndark:hover:text-white"
                  }`}
                >
                  {t("no")}
                </button>
              </div>
            </div>

            {formData.SendinOrder === "true" && (
              <div className="flex items-center gap-2 pt-2 border-t border-slate-200 opensigndark:border-[#243046]">
                <input
                  type="checkbox"
                  id="strictOrderCheckEdit"
                  className="op-checkbox op-checkbox-xs border-slate-300 opensigndark:border-slate-500 checked:bg-blue-600 checked:border-blue-600"
                  name="SendInOrderStrict"
                  checked={formData.SendInOrderStrict === "true"}
                  onChange={(e) => {
                    setIsUpdate(true);
                    setFormData({
                      ...formData,
                      SendInOrderStrict: e.target.checked ? "true" : "false"
                    });
                  }}
                />
                <label
                  htmlFor="strictOrderCheckEdit"
                  className="text-xs text-slate-700 opensigndark:text-slate-300 cursor-pointer"
                  title={t("strict-order-help")}
                >
                  {t("strict-order")}
                </label>
              </div>
            )}
          </div>

          {/* 4. Opciones Avanzadas (Colapsable) */}
          <div className="flex flex-col pt-3 border-t border-slate-200 opensigndark:border-[#243046]">
            <button
              type="button"
              onClick={() => setIsAdvanceOpt(!isAdvanceOpt)}
              className="flex items-center justify-between py-1.5 px-1 text-xs font-semibold text-blue-600 opensigndark:text-blue-400 hover:text-blue-700 opensigndark:hover:text-blue-300 transition-colors group w-full"
            >
              <span className="flex items-center gap-2">
                <i className="fa-light fa-sliders text-xs"></i>
                <span>
                  {isAdvanceOpt
                    ? t("hide-advanced-options", "Ocultar opciones avanzadas")
                    : t("advanced-options", "Opciones avanzadas")}
                </span>
              </span>
              <i
                className={`fa-light fa-chevron-down text-[10px] transition-transform duration-200 ${
                  isAdvanceOpt ? "rotate-180" : ""
                }`}
              ></i>
            </button>

            {isAdvanceOpt && (
              <div className="pt-3.5 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Columna Izquierda de Opciones Avanzadas */}
                  <div className="flex flex-col gap-3.5">
                    {/* Tiempo para completar */}
                    <div>
                      <label className="block text-xs font-medium text-slate-700 opensigndark:text-slate-200 mb-1">
                        {t("time-to-complete")} ({t("days", "días")})
                        <span className="text-red-500 text-xs ml-0.5">*</span>
                      </label>
                      <input
                        type="number"
                        name="TimeToCompleteDays"
                        className="op-input op-input-sm focus:outline-none border border-slate-200 opensigndark:border-[#243046] focus:border-blue-500 w-full text-xs rounded-lg bg-white opensigndark:!bg-[#101828] text-slate-800 opensigndark:text-white placeholder:text-slate-400 opensigndark:placeholder:text-slate-500"
                        value={formData.TimeToCompleteDays}
                        onChange={handleStrInput}
                        onInvalid={(e) =>
                          e.target.setCustomValidity(t("input-required"))
                        }
                        onInput={(e) => e.target.setCustomValidity("")}
                        min={1}
                        required
                      />
                    </div>

                    {/* Recordatorios automáticos */}
                    <div className="p-3 rounded-xl bg-slate-50 opensigndark:!bg-[#162032] border border-slate-200 opensigndark:border-[#243046] flex flex-col gap-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-slate-700 opensigndark:text-slate-200">
                          {t("automatic-reminders", "Recordatorios automáticos")}
                        </span>
                        <input
                          type="checkbox"
                          className="op-toggle op-toggle-xs checked:bg-blue-600 border-slate-300 opensigndark:border-slate-600 bg-slate-200 opensigndark:bg-slate-700"
                          checked={formData.AutomaticReminders === true}
                          onChange={(e) => {
                            setIsUpdate(true);
                            setFormData({
                              ...formData,
                              AutomaticReminders: e.target.checked
                            });
                          }}
                        />
                      </div>
                      {formData.AutomaticReminders && (
                        <div className="pt-2 border-t border-slate-200 opensigndark:border-[#243046]">
                          <label className="block text-xs font-medium text-slate-700 opensigndark:text-slate-200 mb-1">
                            {t("remind-once", "Recordar cada (días)")}
                          </label>
                          <input
                            type="number"
                            name="RemindOnceInEvery"
                            value={formData.RemindOnceInEvery}
                            onChange={handleStrInput}
                            onInvalid={reminderCustomWarning}
                            onInput={(e) => e.target.setCustomValidity("")}
                            min={1}
                            max={formData?.TimeToCompleteDays}
                            className="op-input op-input-sm focus:outline-none border border-slate-200 opensigndark:border-[#243046] focus:border-blue-500 w-full text-xs rounded-lg bg-white opensigndark:!bg-[#101828] text-slate-800 opensigndark:text-white"
                          />
                        </div>
                      )}
                    </div>

                    {/* Tour y Notificaciones */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-50 opensigndark:!bg-[#162032] border border-slate-200 opensigndark:border-[#243046]">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-medium text-slate-700 opensigndark:text-slate-200">
                            {t("enable-tour")}
                          </span>
                          <a data-tooltip-id="istourenabled-tooltip" className="cursor-pointer text-blue-500">
                            <i className="fa-light fa-circle-question text-[11px]"></i>
                          </a>
                          <Tooltip id="istourenabled-tooltip" className="z-50">
                            <div className="max-w-[240px] text-xs">
                              <p className="font-bold">{t("enable-tour")}</p>
                              <p>{t("istourenabled-help.p1")}</p>
                            </div>
                          </Tooltip>
                        </div>
                        <input
                          type="checkbox"
                          className="op-toggle op-toggle-xs checked:bg-blue-600 border-slate-300 opensigndark:border-slate-600 bg-slate-200 opensigndark:bg-slate-700"
                          checked={formData.IsTourEnabled === "true"}
                          onChange={(e) => {
                            setIsUpdate(true);
                            setFormData({
                              ...formData,
                              IsTourEnabled: e.target.checked ? "true" : "false"
                            });
                          }}
                        />
                      </div>

                      <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-50 opensigndark:!bg-[#162032] border border-slate-200 opensigndark:border-[#243046]">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-medium text-slate-700 opensigndark:text-slate-200">
                            {t("notify-on-signatures")}
                          </span>
                          <a data-tooltip-id="nos-tooltip" className="cursor-pointer text-blue-500">
                            <i className="fa-light fa-circle-question text-[11px]"></i>
                          </a>
                          <Tooltip id="nos-tooltip" className="z-[999]">
                            <div className="max-w-[240px] text-xs">
                              <p className="font-bold">{t("notify-on-signatures")}</p>
                              <p>{t("notify-on-signatures-help.p1")}</p>
                            </div>
                          </Tooltip>
                        </div>
                        <input
                          type="checkbox"
                          className="op-toggle op-toggle-xs checked:bg-blue-600 border-slate-300 opensigndark:border-slate-600 bg-slate-200 opensigndark:bg-slate-700"
                          checked={formData.NotifyOnSignatures === true}
                          onChange={(e) => handleNotifySignChange(e.target.checked)}
                        />
                      </div>
                    </div>

                    {/* Colores de bolígrafo permitidos */}
                    <div>
                      <label className="block text-xs font-medium text-slate-700 opensigndark:text-slate-200 mb-1.5">
                        {t("pen-colors") || "Colores de firma permitidos"}
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {pensList.map((color) => {
                          const isSelected = selectedColors.includes(color);
                          const colorDot =
                            color === "blue"
                              ? "bg-blue-600"
                              : color === "red"
                              ? "bg-red-600"
                              : "bg-slate-900 opensigndark:bg-slate-200";
                          return (
                            <button
                              key={color}
                              type="button"
                              onClick={() => {
                                setIsUpdate(true);
                                handleColorsChange(color);
                              }}
                              className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 border transition-all ${
                                isSelected
                                  ? "border-blue-600 bg-blue-50 text-blue-600 opensigndark:border-blue-500 opensigndark:bg-blue-500/20 opensigndark:text-blue-300 font-semibold shadow-sm"
                                  : "border-slate-200 opensigndark:border-[#243046] text-slate-600 opensigndark:text-slate-400 hover:text-slate-900 opensigndark:hover:text-white bg-slate-50 opensigndark:bg-[#101828]"
                              }`}
                            >
                              <span className={`w-2.5 h-2.5 rounded-full ${colorDot}`}></span>
                              <span className="capitalize">{color}</span>
                              {isSelected && (
                                <i className="fa-solid fa-check text-[10px]"></i>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Columna Derecha de Opciones Avanzadas */}
                  <div className="flex flex-col gap-3.5">
                    {/* Bcc y Cc */}
                    <div className="text-xs">
                      <SignersInput
                        label={t("Bcc")}
                        initialData={template?.Bcc}
                        onChange={handleBcc}
                        zindex={50}
                        helpText={t("bcc-help")}
                        isCaptureAllData
                        isAddYourSelfCheckbox={isAddYourSelfCheckbox}
                      />
                    </div>
                    <div className="text-xs">
                      <SignersInput
                        label={t("Cc")}
                        initialData={template?.Cc}
                        onChange={handleCc}
                        zindex={50}
                        helpText={t("cc-help")}
                        isCaptureAllData
                        isAddYourSelfCheckbox={isAddYourSelfCheckbox}
                      />
                    </div>

                    {/* URL de Redirección */}
                    <div>
                      <label className="block text-xs font-medium text-slate-700 opensigndark:text-slate-200 mb-1">
                        {t("redirect-url")}
                      </label>
                      <input
                        name="RedirectUrl"
                        className="op-input op-input-sm focus:outline-none border border-slate-200 opensigndark:border-[#243046] focus:border-blue-500 w-full text-xs rounded-lg bg-white opensigndark:!bg-[#101828] text-slate-800 opensigndark:text-white placeholder:text-slate-400 opensigndark:placeholder:text-slate-500"
                        value={formData.RedirectUrl}
                        placeholder="https://ejemplo.com/completado"
                        onChange={handleStrInput}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer fijo con acciones */}
        <div className="px-6 py-3.5 border-t border-slate-200 opensigndark:border-[#243046] bg-slate-50 opensigndark:!bg-[#162032] flex items-center justify-end gap-2.5 flex-shrink-0">
          <button
            type="button"
            onClick={handleEditTemplateClose}
            className="op-btn op-btn-ghost op-btn-sm text-xs font-medium rounded-lg text-slate-600 opensigndark:text-slate-400 hover:text-slate-900 opensigndark:hover:text-white"
          >
            {t("cancel")}
          </button>
          <button
            type="submit"
            className="op-btn bg-blue-600 hover:bg-blue-700 text-white op-btn-sm text-xs font-semibold rounded-lg px-5 flex items-center gap-1.5 border-none shadow-sm"
          >
            <i className="fa-light fa-floppy-disk text-xs"></i>
            <span>{t("submit")}</span>
          </button>
        </div>
      </form>
    </ModalUi>
  );
};

export default EditTemplate;
