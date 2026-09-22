import { useRef, useState } from "react";
import "../../styles/opensigndrive.css";
import { useTranslation } from "react-i18next";
import { useDraggable } from "../../hook/useDraggable";
import {
  base64ToArrayBuffer,
  decryptPdf,
  deletePdfPage,
  getFileAsArrayBuffer,
  handleRemoveWidgets,
  reorderPdfPages
} from "../../constant/Utils";
import ModalUi from "../../primitives/ModalUi";
import { PDFDocument } from "pdf-lib";
import { maxFileSize } from "../../constant/const";
import PageReorderModal from "./PageReorderModal";
import {
  clearAcroFields,
  isPdfPasswordProtected
} from "../../utils/acroFieldExtractor";
import { notify } from "../../utils";

function PdfTools(props) {
  const { t } = useTranslation();
  const mergePdfInputRef = useRef(null);
  const [isDeletePage, setIsDeletePage] = useState(false);
  const [isReorderModal, setIsReorderModal] = useState(false);
  const [showMobileTools, setShowMobileTools] = useState(false);
  const { dragProps, resetPosition } = useDraggable();

  const handleDetelePage = async () => {
    props.setIsUploadPdf && props.setIsUploadPdf(true);
    try {
      const pdfupdatedData = await deletePdfPage(
        props.pdfArrayBuffer,
        props.pageNumber
      );
      if (pdfupdatedData?.totalPages === 1) {
        notify.warning(t("delete-alert"));
      } else {
        props.setPdfBase64Url(pdfupdatedData.base64);
        props.setPdfArrayBuffer(pdfupdatedData.arrayBuffer);
        setIsDeletePage(false);
        handleRemoveWidgets(
          props.setSignerPos,
          props.signerPos,
          props.pageNumber
        );
        props.setAllPages(pdfupdatedData.remainingPages || 1);
        if (props.allPages === props.pageNumber) {
          props.setPageNumber(props.pageNumber - 1);
        } else if (props.allPages > 2) {
          props.setPageNumber(props.pageNumber);
        }
      }
    } catch (e) {
      console.error("Delete pdf page error", e);
    }
  };

  // `removeFile` is used to  remove file if exists
  const removeFile = (e) => {
    if (e) {
      e.target.value = "";
    }
  };

  const handleFileUpload = async (e) => {
    props.setIsTour && props.setIsTour(false);
    const file = e.target.files[0];
    if (!file) {
      notify.warning(t("please-select-pdf"));
      return;
    }
    if (!file.type.includes("pdf")) {
      notify.warning(t("only-pdf-allowed"));
      return;
    }
    const fileSize =
      maxFileSize;
    const pdfsize = file?.size;
    const fileSizeBytes = fileSize * 1024 * 1024;
    if (pdfsize > fileSizeBytes) {
      notify.error(`${t("file-alert-1")} ${fileSize} MB`);
      removeFile(e);
      return;
    }
    try {
      let uploadedPdfBytes = await getFileAsArrayBuffer(file);
      try {
        await isPdfPasswordProtected(uploadedPdfBytes);
        uploadedPdfBytes = await clearAcroFields(uploadedPdfBytes); // best effort cleanup to prevent stale data
      } catch (error) {
        if (error?.message?.includes("is encrypted")) {
          try {
            const pdfFile = await decryptPdf(file, "");
            const pdfArrayBuffer = await getFileAsArrayBuffer(pdfFile);
            uploadedPdfBytes = await clearAcroFields(pdfArrayBuffer);
          } catch (err) {
            if (err?.response?.status === 401) {
              const password = prompt(
                `PDF "${file.name}" is password-protected. Enter password:`
              );
              if (password) {
                try {
                  const pdfFile = await decryptPdf(file, password);
                  const pdfArrayBuffer = await getFileAsArrayBuffer(pdfFile);
                  uploadedPdfBytes = await clearAcroFields(pdfArrayBuffer);
                  // Upload the file to Parse Server
                } catch (err) {
                  console.error("Incorrect password or decryption failed", err);
                  notify.error(t("incorrect-password-or-decryption-failed"));
                  return;
                }
              } else {
                notify.warning(t("provide-password"));
                return;
              }
            } else {
              console.error("Decryption error ", error);
              notify.error(t("error-uploading-pdf"));
              return;
            }
          }
        } else {
          console.error("File upload error ", error);
          notify.error(t("error-uploading-pdf"));
          return;
        }
      }
      const uploadedPdfDoc = await PDFDocument.load(uploadedPdfBytes, {
        ignoreEncryption: true
      });
      const basePdfDoc = await PDFDocument.load(props.pdfArrayBuffer);

      // Copy pages from the uploaded PDF to the base PDF
      const uploadedPdfPages = await basePdfDoc.copyPages(
        uploadedPdfDoc,
        uploadedPdfDoc.getPageIndices()
      );
      uploadedPdfPages.forEach((page) => basePdfDoc.addPage(page));
      // Save the updated PDF
      const pdfBase64 = await basePdfDoc.saveAsBase64({
        useObjectStreams: false
      });
      const pdfBuffer = base64ToArrayBuffer(pdfBase64);
      const pdfsize = pdfBuffer?.byteLength;
      const fileSizeBytes = fileSize * 1024 * 1024;
      if (pdfsize > fileSizeBytes) {
        notify.error(`${t("file-alert-1")} ${fileSize} MB`);
        removeFile(e);
        return;
      }
      props.setPdfArrayBuffer(pdfBuffer);
      props.setPdfBase64Url(pdfBase64);
      props.setIsUploadPdf && props.setIsUploadPdf(true);
      mergePdfInputRef.current.value = "";
    } catch (error) {
      mergePdfInputRef.current.value = "";
      console.error("Error merging PDF:", error);
    }
  };

  const handleReorderSave = async (order) => {
    try {
      const pdfupdatedData = await reorderPdfPages(props.pdfArrayBuffer, order);
      if (pdfupdatedData) {
        props.setPdfArrayBuffer(pdfupdatedData.arrayBuffer);
        props.setPdfBase64Url(pdfupdatedData.base64);
        props.setAllPages(pdfupdatedData.totalPages);
        props.setPageNumber(1);
      }
    } catch (e) {
      console.error("Reorder PDF pages error", e);
    }
    setIsReorderModal(false);
  };

  const handleDeletePage = () => {
    setIsDeletePage(true);
    props.setIsTour && props.setIsTour(false);
  };

  const handleReorderPages = () => {
    setIsReorderModal(true);
    props.setIsTour && props.setIsTour(false);
  };

  const handleZoomIn = () => {
    props.clickOnZoomIn();
    props.setIsTour && props.setIsTour(false);
  };
  const handleZoomOut = () => {
    props.clickOnZoomOut();
    props.setIsTour && props.setIsTour(false);
  };
  const handleRotate = () => {
    props.handleRotationFun(90);
    props.setIsTour && props.setIsTour(false);
  };
  const handleAntiRotate = () => {
    props.handleRotationFun(-90);
    props.setIsTour && props.setIsTour(false);
  };

  return (
    <>
      {/* Barra de Herramientas Flotante Desktop con Arrastre Libre */}
      <div
        data-tut="pdftools"
        {...dragProps}
        className="hidden md:flex flex-col items-center liquid-glass-tools-bar self-start mt-6 mr-3 z-30 sticky top-16 shadow-xl"
        title="Barra de herramientas (Arrastra para mover por la pantalla)"
      >
        {/* Handle de arrastre visual */}
        <div
          className="w-full flex items-center justify-center py-1 cursor-grab active:cursor-grabbing text-base-content/30 hover:text-base-content/70 transition-colors"
          title="Arrastrar barra (Doble clic para restablecer)"
          onDoubleClick={resetPosition}
        >
          <i className="fa-light fa-grip-dots-vertical text-xs"></i>
        </div>

        {!props.isDisableEditTools && (
          <>
            <button
              type="button"
              className="liquid-tool-btn"
              onClick={() => mergePdfInputRef.current.click()}
              title={t("add-pages")}
            >
              <input
                type="file"
                className="hidden"
                accept="application/pdf"
                ref={mergePdfInputRef}
                onChange={handleFileUpload}
              />
              <i className="fa-light fa-plus text-base"></i>
            </button>

            <button
              type="button"
              className="liquid-tool-btn hover:!text-red-500 hover:!bg-red-500/10"
              onClick={handleDeletePage}
              title={t("delete-page")}
            >
              <i className="fa-light fa-trash text-base"></i>
            </button>

            <button
              type="button"
              className="liquid-tool-btn"
              onClick={handleReorderPages}
              title={t("reorder-pages")}
            >
              <i className="fa-light fa-list-ol text-base"></i>
            </button>

            <div className="liquid-tools-divider"></div>
          </>
        )}

        <button
          type="button"
          className="liquid-tool-btn"
          onClick={handleZoomIn}
          title={t("zoom-in")}
        >
          <i className="fa-light fa-magnifying-glass-plus text-base"></i>
        </button>

        <button
          type="button"
          className="liquid-tool-btn"
          onClick={handleZoomOut}
          title={t("zoom-out")}
        >
          <i className="fa-light fa-magnifying-glass-minus text-base"></i>
        </button>

        {!props.isDisableEditTools && (
          <>
            <div className="liquid-tools-divider"></div>

            <button
              type="button"
              className="liquid-tool-btn"
              onClick={handleRotate}
              title={t("rotate-right")}
            >
              <i className="fa-light fa-rotate-right text-base"></i>
            </button>

            <button
              type="button"
              className="liquid-tool-btn"
              title={t("rotate-left")}
              onClick={handleAntiRotate}
            >
              <i className="fa-light fa-rotate-left text-base"></i>
            </button>
          </>
        )}
      </div>

      {/* Vista Móvil: Botón flotante para abrir las herramientas (oculto por defecto) */}
      <div className="md:hidden">
        {showMobileTools && (
          <div className="fixed bottom-24 left-3 z-40 liquid-glass-tools-bar flex flex-col gap-1.5 p-2 shadow-2xl animate-in fade-in slide-in-from-bottom-2 duration-200">
            <button
              type="button"
              className="liquid-tool-btn !w-9 !h-9"
              onClick={handleZoomIn}
              title={t("zoom-in")}
            >
              <i className="fa-light fa-magnifying-glass-plus text-sm"></i>
            </button>
            <button
              type="button"
              className="liquid-tool-btn !w-9 !h-9"
              onClick={handleZoomOut}
              title={t("zoom-out")}
            >
              <i className="fa-light fa-magnifying-glass-minus text-sm"></i>
            </button>
            {!props.isDisableEditTools && (
              <>
                <div className="liquid-tools-divider !w-4"></div>
                <button
                  type="button"
                  className="liquid-tool-btn !w-9 !h-9"
                  onClick={handleRotate}
                  title={t("rotate-right")}
                >
                  <i className="fa-light fa-rotate-right text-sm"></i>
                </button>
                <button
                  type="button"
                  className="liquid-tool-btn !w-9 !h-9"
                  onClick={handleReorderPages}
                  title={t("reorder-pages")}
                >
                  <i className="fa-light fa-list-ol text-sm"></i>
                </button>
              </>
            )}
          </div>
        )}

        {/* Botón flotante activador en móvil */}
        <button
          type="button"
          onClick={() => setShowMobileTools(!showMobileTools)}
          className={`fixed bottom-20 left-3 z-40 w-9 h-9 rounded-full liquid-glass-panel flex items-center justify-center shadow-lg border border-base-content/15 transition-all active:scale-95 ${
            showMobileTools ? "bg-primary text-white" : "text-primary hover:bg-primary/10"
          }`}
          title="Herramientas del documento"
        >
          <i className={showMobileTools ? "fa-light fa-xmark text-sm" : "fa-light fa-sliders text-xs"}></i>
        </button>
      </div>



      <ModalUi
        isOpen={isDeletePage}
        title={t("delete-page")}
        handleClose={() => setIsDeletePage(false)}
      >
        <div className="h-[100%] p-[20px]">
          <p className="font-medium text-base-content">{t("delete-alert-2")}</p>
          <p className="pt-3 text-base-content">{t("delete-note")}</p>
          <div className="h-[1px] bg-[#9f9f9f] w-full my-[15px]"></div>
          <button
            onClick={() => handleDetelePage()}
            type="button"
            className="op-btn op-btn-primary"
          >
            {t("yes")}
          </button>
          <button
            onClick={() => setIsDeletePage(false)}
            type="button"
            className="op-btn op-btn-ghost text-base-content ml-1"
          >
            {t("no")}
          </button>
        </div>
      </ModalUi>
      <PageReorderModal
        isOpen={isReorderModal}
        handleClose={() => setIsReorderModal(false)}
        totalPages={props.allPages}
        onSave={handleReorderSave}
      />
    </>
  );
}

export default PdfTools;
