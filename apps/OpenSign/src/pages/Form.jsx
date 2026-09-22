import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { formJson } from "../json/FormJson";
import Parse from "parse";
import SelectFolder from "../components/shared/fields/SelectFolder";
import SignersInput from "../components/shared/fields/SignersInput";
import PageNotFound from "./PageNotFound";
import { SaveFileSize } from "../constant/saveFileSize";
import {
  generatePdfName,
  generateTitleFromFilename,
  getSecureUrl,
  toDataUrl,
  decryptPdf,
  base64ToFile,
  getFileAsArrayBuffer,
  removeTrailingSegment
} from "../constant/Utils";
import { PDFDocument } from "pdf-lib";
import axios from "axios";
import {
  maxFileSize,
  maxDescriptionLength,
  maxNoteLength,
  maxTitleLength
} from "../constant/const";
import ModalUi from "../primitives/ModalUi";
import { Tooltip } from "react-tooltip";
import Loader from "../primitives/Loader";
import { useTranslation } from "react-i18next";
import { useDispatch } from "react-redux";
import { sessionStatus } from "../redux/reducers/userReducer";
import { notify, withSessionValidation } from "../utils";
import {
  clearAcroFields,
  isPdfPasswordProtected
} from "../utils/acroFieldExtractor";
import { appInfo } from "../constant/appinfo";

// `Form` render all type of Form on this basis of their provided in path
function Form() {
  const { id } = useParams();

  const config = formJson[id];
  if (config) {
    return <Forms {...config} />;
  } else {
    return <PageNotFound prefix={"Form"} />;
  }
}

const Forms = (props) => {
  const appName = appInfo.appName;
  const { t } = useTranslation();
  const abortController = new AbortController();
  const inputFileRef = useRef(null);
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const [signers, setSigners] = useState([]);
  const [folder, setFolder] = useState({ ObjectId: "", Name: "" });
  const [formData, setFormData] = useState({
    Name: "",
    Description: "",
    Note: "",
    TimeToCompleteDays: 15,
    SendinOrder: "false",
    SendInOrderStrict: "false",
    password: "",
    file: "",
    remindOnceInEvery: 5,
    autoreminder: false,
    IsEnableOTP: "false",
    IsTourEnabled: "false",
    NotifyOnSignatures: "",
    Bcc: [],
    Cc: [],
    RedirectUrl: "",
    AllowModifications: false
  });
  const [fileupload, setFileUpload] = useState("");
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [fileload, setfileload] = useState(false);
  const [percentage, setpercentage] = useState(0);
  const [isReset, setIsReset] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const [isSubmit, setIsSubmit] = useState(false);
  const [isPassword, setIsPassword] = useState(false);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [isCorrectPass, setIsCorrectPass] = useState(true);
  const [isAdvanceOpt, setIsAdvanceOpt] = useState(false);
  const [bcc, setBcc] = useState([]);
  const [cc, setCc] = useState([]);
  const pensList = ["blue", "red", "black"];
  const [selectedColors, setSelectedColors] = useState(pensList);
  const [isDragging, setIsDragging] = useState(false);

  const formatFileSize = (bytes) => {
    if (!bytes || bytes === 0) return "0 KB";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  const getHeaderMeta = () => {
    switch (props.title) {
      case "Sign Yourself":
        return {
          icon: "fa-light fa-pen-nib",
          badge: t("sign-yourself") || "Firma tu mismo",
          description: t("signyour-self-description")
        };
      case "Request Signatures":
        return {
          icon: "fa-light fa-paper-plane",
          badge: t("request-signatures") || "Solicitar firmas",
          description: t("requestsign-description")
        };
      case "New Template":
        return {
          icon: "fa-light fa-file-invoice",
          badge: t("new-template") || "Nueva plantilla",
          description: t("template-form-description")
        };
      default:
        return {
          icon: "fa-light fa-file-signature",
          badge: t(props?.title),
          description: ""
        };
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileInput({ target: { files: e.dataTransfer.files } });
    }
  };

  const handleRemoveUploadedFile = () => {
    setFileUpload("");
    setSelectedFiles([]);
    removeFile();
  };

  const handleStrInput = (e) => {
    setIsCorrectPass(true);
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };
  const extUserData =
    localStorage.getItem("Extand_Class") &&
    JSON.parse(localStorage.getItem("Extand_Class"))?.[0];
  const sendinorder =
    extUserData?.SendinOrder !== undefined && extUserData?.SendinOrder === false
      ? "false"
      : "true";
  const istourenabled =
    extUserData?.IsTourEnabled !== undefined &&
    extUserData?.IsTourEnabled === false
      ? "false"
      : "true";
  const fileSize =
    maxFileSize;
  useEffect(() => {
    handleReset();
    return () => abortController.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.title]);

  useEffect(() => {
    initializeValues();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const initializeValues = async () => {
    try {
        setFormData((obj) => ({
          ...obj,
          NotifyOnSignatures: true,
          SendinOrder: sendinorder,
          IsTourEnabled: istourenabled,
        }));
    } finally {
      setIsInitializing(false);
    }
  };

  // `removeFile` is used to reset progress, percentage and remove file if exists
  const removeFile = (e) => {
    setfileload(false);
    setpercentage(0);
    if (e && e.target) {
      e.target.value = "";
    }
    if (inputFileRef.current) {
      inputFileRef.current.value = "";
    }
  };
  const handleFileInput = withSessionValidation(async (e) => {
    setpercentage(0);
    try {
      const files = Array.from(e.target.files);
      const filesNameArr = files.map((f) => f.name);
      setSelectedFiles(filesNameArr);
      if (!files.length) {
        notify.warning(t("file-alert-2"));
        return;
      }
      // setFormData((prev) => ({ ...prev, file: files[0] }));
      const totalBytes = Math.round(files.reduce((sum, f) => sum + f.size, 0)); // in bytes
      const fileSizeBytes = fileSize * 1024 * 1024;
      if (totalBytes > fileSizeBytes) {
        notify.error(`${t("file-alert-1")} ${fileSize} MB`);
        setFileUpload("");
        setSelectedFiles([]);
        removeFile(e);
        return;
      }

      const pdfBuffers = [];
      for (const file of files) {
        setFormData((prev) => ({ ...prev, file: file }));
        if (file.type === "application/pdf") {
          try {
            const buffer = await getFileAsArrayBuffer(file);
            await isPdfPasswordProtected(buffer);
            const newBuffer = await clearAcroFields(buffer); // best effort cleanup to prevent stale data
            pdfBuffers.push(newBuffer);
          } catch (err) {
            if (err?.message?.includes("is encrypted")) {
              try {
                setIsDecrypting(true);
                const pdfFile = await decryptPdf(file, "");
                setIsDecrypting(false);
                setfileload(true);
                const res = await getFileAsArrayBuffer(pdfFile);
                const newBuffer = await clearAcroFields(res); // best effort cleanup to prevent stale data
                pdfBuffers.push(newBuffer);
              } catch (err) {
                removeFile(e);
                if (err?.response?.status === 401) {
                  const password = prompt(
                    `PDF "${file.name}" is password-protected. Enter password:`
                  );

                  if (password) {
                    try {
                      const pdfFile = await decryptPdf(file, password);
                      setIsDecrypting(false);
                      setfileload(true);
                      const res = await getFileAsArrayBuffer(pdfFile);
                      const newBuffer = await clearAcroFields(res); // best effort cleanup to prevent stale data
                      pdfBuffers.push(newBuffer);
                    } catch (err) {
                      console.error(
                        "Incorrect password or decryption failed",
                        err
                      );
                      setSelectedFiles(
                        filesNameArr.filter((f) => f !== file.name)
                      );
                      setIsDecrypting(false);
                      setfileload(false);
                      removeFile(e);
                      notify.error(
                        t("incorrect-password-for-file", { file: file.name })
                      );
                      return;
                    }
                  } else {
                    console.error("Password not provided");
                    setSelectedFiles(
                      filesNameArr.filter((f) => f !== file.name)
                    );
                    setIsDecrypting(false);
                    setfileload(false);
                    removeFile(e);
                    return;
                  }
                } else {
                  console.error("File upload error: ", err?.response);
                  setIsDecrypting(false);
                  e.target.value = "";
                  removeFile(e);
                  return;
                }
              }
            } else {
              console.error("File upload error: ", err);
              removeFile(e);
              return;
            }
          }
        } else if (file.type.includes("image/")) {
          const image = await toDataUrl(file);
          const pdfDoc = await PDFDocument.create();
          const embed =
            file.type === "image/png"
              ? await pdfDoc.embedPng(image)
              : await pdfDoc.embedJpg(image);
          const page = pdfDoc.addPage([embed.width, embed.height]);
          page.drawImage(embed, {
            x: 0,
            y: 0,
            width: embed.width,
            height: embed.height
          });
          const bytes = await pdfDoc.save({ useObjectStreams: false });
          pdfBuffers.push(bytes);
        } else if (
          file.type ===
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
          file.name.toLowerCase().endsWith(".docx")
        ) {
          try {
            const baseApi = localStorage.getItem("baseUrl") || "";
            const url = removeTrailingSegment(baseApi) + "/docxtopdf";
            let fd = new FormData();
            fd.append("file", file);
            setfileload(true);
            setpercentage(0);
            const config = {
              headers: {
                "content-type": "multipart/form-data",
                sessiontoken: Parse.User.current().getSessionToken()
              },
              signal: abortController.signal,
              onUploadProgress: (progressEvent) => {
                if (progressEvent.total) {
                  const percentCompleted = Math.round(
                    (progressEvent.loaded * 100) / progressEvent.total
                  );
                  setpercentage(percentCompleted);
                }
              }
            };
            const res = await axios.post(url, fd, config);
            if (res.data?.url) {
              const pdfRes = await axios.get(res.data.url, {
                responseType: "arraybuffer"
              });
              pdfBuffers.push(pdfRes.data);
            }
            setfileload(false);
          } catch (err) {
            setfileload(false);
            removeFile(e);
            console.error("Docx to PDF conversion error: ", err);
            const error =
                  t("docx-error");
            if (err?.code === 209) {
              dispatch(sessionStatus(false));
            } else {
              notify.error(error);
            }
            return;
          }
        }
      }

      if (!pdfBuffers.length) {
        notify.warning(t("file-alert-2"));
        setSelectedFiles([]);
        return;
      }

      setfileload(true);
      const merged = await PDFDocument.create();
      for (const bytes of pdfBuffers) {
        const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
        const pages = await merged.copyPages(doc, doc.getPageIndices());
        pages.forEach((p) => merged.addPage(p));
      }

      const pdfBytes = await merged.save({ useObjectStreams: false });
      const name = generatePdfName(16);
      const pdfName = `${name}.pdf`;
      let uploadedUrl = "";
        const parseFile = new Parse.File(
          pdfName,
          [...pdfBytes],
          "application/pdf"
        );
        const response = await parseFile.save({
          progress: (progressValue, loaded, total) => {
            if (progressValue !== null) {
              const percentCompleted = Math.round((loaded * 100) / total);
              setpercentage(percentCompleted);
            }
          }
        });
        if (response.url()) {
          const fileRes = await getSecureUrl(response.url());
          if (fileRes.url) {
            uploadedUrl = fileRes.url;
          }
        }
      if (uploadedUrl) {
        const tenantId = localStorage.getItem("TenantId");
        const userId = extUserData?.UserId?.objectId;
        SaveFileSize(pdfBytes.byteLength, uploadedUrl, tenantId, userId);
        setFileUpload(uploadedUrl);
        setfileload(false);
        const title = generateTitleFromFilename(filesNameArr?.[0]);
        setFormData((obj) => ({ ...obj, Name: title }));
        removeFile(e);
      } else {
        setfileload(false);
        removeFile(e);
        setSelectedFiles([]);
      }
    } catch (error) {
      console.error("Document save form error: ", error);
      if (error?.code === 209) {
        dispatch(sessionStatus(false));
      } else {
        notify.error(error.message);
      }
      setSelectedFiles([]);
      removeFile(e);
    }
  });
  // `isValidURL` is used to check valid webhook url
  function isValidURL(value) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" || url.protocol === "http:";
    } catch (error) {
      return false;
    }
  }
  const handleSubmit = withSessionValidation(async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (fileupload) {
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
      if (formData.RedirectUrl && !isValidURL(formData?.RedirectUrl)) {
        notify.warning(t("invalid-redirect-url"));
        return;
      }
      setIsSubmit(true);
      try {
        const currentUser = Parse.User.current();
        const object = new Parse.Object(props.Cls);
        object.set("Name", formData?.Name);
        object.set("Description", formData?.Description);
        object.set("Note", formData?.Note);
        if (props.title === "Request Signatures") {
            if (
              extUserData?.TenantId?.RequestBody &&
              extUserData?.TenantId?.RequestSubject
            ) {
              object.set("RequestBody", extUserData?.TenantId?.RequestBody);
              object.set(
                "RequestSubject",
                extUserData?.TenantId?.RequestSubject
              );
              object.set(
                "EmailEditorType",
                extUserData?.TenantId?.EmailEditorType
              );
            }
        }
        if (props.title !== "Sign Yourself") {
          const isChecked = formData.SendinOrder === "false" ? false : true;
          const isTourEnabled =
            formData?.IsTourEnabled === "false" ? false : true;
          const remindOnceInEvery = parseInt(formData.remindOnceInEvery);
          const TimeToCompleteDays = parseInt(formData?.TimeToCompleteDays);
          const AutomaticReminders = formData.autoreminder;
          const reminderCount = TimeToCompleteDays / remindOnceInEvery;
          if (AutomaticReminders && reminderCount > 15) {
            notify.warning(t("only-15-reminder-allowed"));
            return;
          }
          object.set("SendinOrder", isChecked);
          // Strict-order is only meaningful when SendinOrder is true.
          object.set(
            "SendInOrderStrict",
            isChecked && formData.SendInOrderStrict === "true"
          );
          object.set("AutomaticReminders", AutomaticReminders);
          object.set("RemindOnceInEvery", remindOnceInEvery);
          object.set("IsTourEnabled", isTourEnabled);
          object.set("TimeToCompleteDays", TimeToCompleteDays);
          object.set("PenColors", selectedColors);

            object.set("AllowModifications", false);
            object.set("IsEnableOTP", false);
            if (formData.NotifyOnSignatures !== undefined) {
              object.set("NotifyOnSignatures", formData.NotifyOnSignatures);
            }
          if (formData?.RedirectUrl) {
            object.set("RedirectUrl", formData.RedirectUrl);
          }
        }
        object.set("URL", fileupload);
        object.set("CreatedBy", Parse.User.createWithoutData(currentUser.id));
        if (folder && folder.ObjectId) {
          object.set("Folder", {
            __type: "Pointer",
            className: props.Cls,
            objectId: folder.ObjectId
          });
        }
        if (signers && signers.length > 0) {
          object.set("Signers", signers);
        }
        if (bcc && bcc.length > 0) {
          const Bcc = bcc.map((x) => ({
            __type: "Pointer",
            className: "contracts_Contactbook",
            objectId: x.objectId
          }));
          object.set("Bcc", Bcc);
        }
        if (cc && cc.length > 0) {
          const Cc = cc.map((x) => ({
            __type: "Pointer",
            className: "contracts_Contactbook",
            objectId: x.objectId
          }));
          object.set("Cc", Cc);
        }

        const ExtCls = JSON.parse(localStorage.getItem("Extand_Class"));
        object.set("ExtUserPtr", {
          __type: "Pointer",
          className: "contracts_Users",
          objectId: ExtCls[0].objectId
        });
        if (extUserData?.UseNameAsSender) {
          const senderName = extUserData?.Name || "";
          const senderMail = extUserData?.Email || "";
          if (senderName) {
            object.set("SenderName", senderName);
          }
          if (senderMail) {
            object.set("SenderMail", senderMail);
          }
        }
        const res = await object.save();
        if (res) {
          setSigners([]);
          setBcc([]);
          setCc([]);
          setSelectedColors(pensList);
          setFolder({ ObjectId: "", Name: "" });
          const notifySign =
                extUserData?.NotifyOnSignatures !== undefined
                ? extUserData?.NotifyOnSignatures
                : true;
          setFormData({
            Name: "",
            Description: "",
            Note:
              props.title === "Sign Yourself"
                ? "Note to myself"
                : "Please review and sign this document",
            TimeToCompleteDays: 15,
            SendinOrder: sendinorder,
            password: "",
            file: "",
            NotifyOnSignatures: notifySign,
            remindOnceInEvery: 5,
            autoreminder: false,
            IsEnableOTP: "false",
            IsTourEnabled: istourenabled,
            RedirectUrl: "",
            AllowModifications: false,
          });
          setFileUpload("");
          setSelectedFiles([]);
          setpercentage(0);
          navigate(`/${props?.redirectRoute}/${res.id}`);
        }
      } catch (err) {
        console.error("Document save form error: ", err);
        if (err?.code === 209) {
          dispatch(sessionStatus(false));
        } else if (err.message === "only 15 reminder allowed") {
          notify.error(t("only-15-reminder-allowed"));
        } else {
          notify.error(t("something-went-wrong-mssg"));
        }
      } finally {
        setIsSubmit(false);
      }
    } else {
      notify.warning(t("file-alert-3"));
    }
  });

  const handleFolder = (data) => {
    setFolder(data);
  };
  const handleSigners = (data) => {
    if (data && data.length > 0) {
      const updateSigners = data.map((x) => ({
        __type: "Pointer",
        className: "contracts_Contactbook",
        objectId: x
      }));
      setSigners(updateSigners);
    }
  };

  const handleBcc = (data) => {
    if (data && data.length > 0) {
      const trimEmail = data.map((item) => ({
        objectId: item?.value,
        Name: item?.label,
        Email: item?.email
      }));
      setBcc(trimEmail);
    }
  };
  const handleCc = (data) => {
    if (data && data.length > 0) {
      const trimEmail = data.map((item) => ({
        objectId: item?.value,
        Name: item?.label,
        Email: item?.email
      }));
      setCc(trimEmail);
    }
  };

  const handleReset = () => {
    setIsReset(true);
    setSigners([]);
    setBcc([]);
    setCc([]);
    setSelectedColors(pensList);
    setFolder({ ObjectId: "", Name: "" });
    const notifySign =
          extUserData?.NotifyOnSignatures !== undefined
          ? extUserData?.NotifyOnSignatures
          : true;
    let obj = {
      Name: "",
      Description: "",
      Note:
        props.title === "Sign Yourself"
          ? "Note to myself"
          : "Please review and sign this document",
      TimeToCompleteDays: 15,
      SendinOrder: sendinorder,
      password: "",
      file: "",
      remindOnceInEvery: 5,
      autoreminder: false,
      IsEnableOTP: "false",
      IsTourEnabled: istourenabled,
      NotifyOnSignatures: notifySign,
      RedirectUrl: "",
      AllowModifications: false,
    };
    setFormData(obj);
    removeFile();
    setFileUpload("");
    setSelectedFiles([]);
    setTimeout(() => setIsReset(false), 50);
  };
  const handleCancel = () => {
    navigate("/dashboard/35KBoSgoAK");
  };
  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    setIsPassword(false);
    setfileload(true);
    const tenantId = localStorage.getItem("TenantId");
    const userId = extUserData?.UserId?.objectId;
    try {
      const size = formData?.file?.size;
      const name = generatePdfName(16);
      const pdfFile = await decryptPdf(formData?.file, formData?.password);
      setIsDecrypting(false);
        const res = await getFileAsArrayBuffer(pdfFile);
        const newArraybuffer = await clearAcroFields(res); // best effort cleanup to prevent stale data
        const pdfToSave = new Uint8Array(newArraybuffer);
        const parseFile = new Parse.File(
          name,
          [...pdfToSave],
          "application/pdf"
        );
        await parseFile.save({
          progress: (progressValue, loaded, total) => {
            if (progressValue !== null) {
              const percentCompleted = Math.round((loaded * 100) / total);
              setpercentage(percentCompleted);
            }
          }
        });
        // Retrieve the URL of the uploaded file
        if (parseFile.url()) {
          const fileRes = await getSecureUrl(parseFile.url());
          if (fileRes.url) {
            setFileUpload(fileRes.url);
            removeFile();
            const title = generateTitleFromFilename(formData?.file?.name);
            setFormData((obj) => ({ ...obj, password: "", Name: title }));
            SaveFileSize(size, fileRes?.url, tenantId, userId);
            return fileRes.url;
          } else {
            removeFile();
            setFormData((prev) => ({ ...prev, password: "" }));
            setIsDecrypting(false);
            if (inputFileRef.current) {
              inputFileRef.current.value = ""; // Set file input value to empty string
            }
          }
        } else {
          removeFile();
          setFormData((prev) => ({ ...prev, password: "" }));
          setIsDecrypting(false);
          if (inputFileRef.current) {
            inputFileRef.current.value = ""; // Set file input value to empty string
          }
        }
    } catch (err) {
      removeFile();
      if (err?.code === 209) {
        dispatch(sessionStatus(false));
      } else if (err?.response?.status === 401) {
        setIsPassword(true);
        setIsCorrectPass(false);
      } else {
        console.error("File upload error: ", err?.response);
        setFormData((prev) => ({ ...prev, password: "" }));
        setIsDecrypting(false);
        if (inputFileRef.current) {
          inputFileRef.current.value = ""; // Set file input value to empty string
        }
      }
    }
  };
  const handeCloseModal = () => {
    setIsPassword(false);
    setFormData((prev) => ({ ...prev, file: "", password: "" }));
    setIsDecrypting(false);
    setfileload(false);
    if (inputFileRef.current) {
      inputFileRef.current.value = ""; // Set file input value to empty string
    }
  };

  // `handleNotifySignChange` is trigger when user change radio of notify on signatures
  const handleNotifySignChange = (value) => {
    setFormData((obj) => ({ ...obj, NotifyOnSignatures: value }));
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
    if (!formData.remindOnceInEvery || formData.remindOnceInEvery === 0) {
      return e.target.setCustomValidity(t("input-required"));
    } else {
      return e.target.setCustomValidity(t("reminder-error"));
    }
  };
  const headerMeta = getHeaderMeta();

  return (
    <div className="w-full flex-1 flex flex-col">
      {isSubmit || isInitializing ? (
        <div className="flex flex-col justify-center items-center h-[70vh]">
          <Loader />
        </div>
      ) : (
        <>
          <ModalUi
            isOpen={isPassword}
            handleClose={() => handeCloseModal()}
            title={t("enter-pdf-password")}
          >
            <form onSubmit={handlePasswordSubmit}>
              <div className="px-6 pt-3 pb-2">
                <label className="mb-2 text-xs text-base-content">
                  {t("password")}
                </label>
                <input
                  type="text"
                  name="password"
                  value={formData.password}
                  onChange={(e) => handleStrInput(e)}
                  className="w-full op-input op-input-bordered op-input-sm focus:outline-none hover:border-base-content text-xs rounded-lg"
                  placeholder={t("enter-pdf-password")}
                  onInvalid={(e) =>
                    e.target.setCustomValidity(t("input-required"))
                  }
                  onInput={(e) => e.target.setCustomValidity("")}
                  required
                />
                <p
                  className={`${
                    !isCorrectPass
                      ? "text-red-600"
                      : "text-transparent pointer-events-none"
                  } ml-2 text-[11px] `}
                >
                  {t("correct-password")}
                </p>
              </div>
              <div className="px-6 mb-3">
                <button type="submit" className="op-btn op-btn-primary op-btn-sm rounded-lg">
                  {t("submit")}
                </button>
              </div>
            </form>
          </ModalUi>

          {/* CONTENEDOR DE FORMULARIO: op-card automático para light/dark y responsivo a altura completa */}
          <div className="op-card w-full p-4 md:p-6 flex-1 flex flex-col">
            <form onSubmit={handleSubmit} className="flex flex-col flex-1 justify-between">
              {/* Header del Formulario */}
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3.5 mb-4 border-b border-base-200">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center flex-shrink-0 text-lg">
                    <i className={headerMeta.icon}></i>
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h1 className="text-base md:text-lg font-bold text-base-content tracking-tight">
                        {t(props?.title)}
                      </h1>
                      <span className="text-[10px] font-semibold uppercase tracking-wider bg-primary/10 text-primary px-2 py-0.5 rounded-md">
                        {headerMeta.badge}
                      </span>
                    </div>
                    <p className="text-xs text-base-content/70 mt-0.5">
                      {headerMeta.description}
                    </p>
                  </div>
                </div>
              </div>

              {/* Grid 2 Columnas Compacto y Equilibrado */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch flex-1">
                
                {/* COLUMNA IZQUIERDA (6 de 12 cols) */}
                <div className="lg:col-span-6 flex flex-col gap-3.5 h-full">
                  {/* Bloque de Carga de Archivo */}
                  <div className="flex flex-col gap-1.5 flex-1">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-semibold text-base-content flex items-center gap-1.5">
                        <i className="fa-light fa-file-arrow-up text-blue-500"></i>
                        <span>{t("report-heading.File") || "Archivo del documento"}</span>
                        <span className="text-red-500">*</span>
                      </label>
                      {fileupload && (
                        <span className="text-[11px] text-green-600 dark:text-green-400 font-medium bg-green-500/10 px-2 py-0.5 rounded-full flex items-center gap-1">
                          <i className="fa-solid fa-circle-check text-[9px]"></i>
                          <span>{t("ready", "Listo")}</span>
                        </span>
                      )}
                    </div>

                    {fileupload.length > 0 ? (
                      /* Archivo Cargado */
                      <div className="rounded-xl border border-slate-200 dark:border-[#243046] bg-slate-50 dark:bg-slate-900/30 p-3 flex flex-col gap-2.5">
                        <div className="flex items-center gap-2.5">
                          <div className="w-10 h-10 rounded-lg bg-red-50 dark:bg-red-500/10 text-red-500 flex items-center justify-center flex-shrink-0 text-lg">
                            <i className="fa-light fa-file-pdf"></i>
                          </div>
                          <div className="min-w-0 flex-1">
                            <p
                              className="text-xs font-semibold text-slate-800 dark:text-base-content truncate"
                              title={selectedFiles.join(", ") || formData.file?.name}
                            >
                              {selectedFiles.join(", ") || formData.file?.name || formData.Name || "Documento"}
                            </p>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                              {formData.file?.size ? formatFileSize(formData.file.size) : "PDF"}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center justify-between pt-2 border-t border-slate-200 dark:border-[#243046]">
                          <button
                            type="button"
                            onClick={() => inputFileRef.current?.click()}
                            className="text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
                          >
                            <i className="fa-light fa-arrows-rotate text-[11px]"></i>
                            <span>{t("replace-file", "Cambiar archivo")}</span>
                          </button>
                          <button
                            type="button"
                            onClick={handleRemoveUploadedFile}
                            className="text-[11px] font-medium text-red-500 hover:text-red-400 flex items-center gap-1"
                          >
                            <i className="fa-light fa-trash-can text-[11px]"></i>
                            <span>{t("remove", "Eliminar")}</span>
                          </button>
                        </div>
                      </div>
                    ) : (
                      /* Drag & Drop Zone Compacta y Elegante */
                      <div
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        onDrop={handleDrop}
                        onClick={() => inputFileRef.current?.click()}
                        className={`relative border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-all duration-200 flex flex-col items-center justify-center min-h-[160px] lg:flex-1 group ${
                          isDragging
                            ? "border-blue-500 bg-blue-50/50 dark:bg-blue-500/10 scale-[1.01]"
                            : "border-slate-200 dark:border-[#243046] hover:border-blue-500/60 bg-slate-50/50 hover:bg-blue-50/20 dark:bg-slate-900/20 dark:hover:bg-slate-900/40"
                        }`}
                      >
                        <input
                          type="file"
                          multiple
                          ref={inputFileRef}
                          className="hidden"
                          onChange={(e) => handleFileInput(e)}
                          accept="application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/png,image/jpeg"
                          required={!fileupload}
                        />

                        {fileload || isDecrypting ? (
                          <div
                            className="w-full flex flex-col items-center gap-2 py-3"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="w-8 h-8 rounded-full border-2 border-blue-500/30 border-t-blue-500 animate-spin"></div>
                            <span className="text-xs font-medium text-slate-700 dark:text-base-content">
                              {isDecrypting
                                ? t("decrypting-pdf")
                                : `${t("uploading", "Cargando archivo")} (${percentage}%)`}
                            </span>
                            <div className="w-full max-w-[200px] h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-blue-500 transition-all duration-300"
                                style={{ width: `${percentage}%` }}
                              ></div>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="w-9 h-9 rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400 flex items-center justify-center mb-1.5 group-hover:scale-110 transition-transform">
                              <i className="fa-light fa-cloud-arrow-up text-lg"></i>
                            </div>
                            <p className="text-xs font-semibold text-slate-800 dark:text-base-content mb-0.5">
                              {t("drag-and-drop-here", "Arrastra y suelta tu archivo aquí")}
                            </p>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-2">
                              {t("or-browse-from-computer", "o haz clic para buscar en tu equipo")}
                            </p>
                            <div className="flex items-center gap-1 mb-1.5">
                              <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-transparent">
                                PDF
                              </span>
                              <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-transparent">
                                DOCX
                              </span>
                              <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-transparent">
                                PNG
                              </span>
                              <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-transparent">
                                JPG
                              </span>
                            </div>
                            <span className="text-[10px] text-slate-500 dark:text-slate-400">
                              {t("max-file-size", "Tamaño máx.")}: {fileSize} MB
                            </span>
                          </>
                        )}
                      </div>
                    )}
                  </div>

                  {/* En Solicitar firmas: Ubicación en Drive en columna izquierda */}
                  {props.title === "Request Signatures" && (
                    <div className="flex flex-col">
                      <SelectFolder
                        onSuccess={handleFolder}
                        folderCls={props.Cls}
                        isReset={isReset}
                      />
                    </div>
                  )}

                  {/* En Nueva plantilla: Flujo "Enviar en orden" en columna izquierda */}
                  {props.title === "New Template" && (
                    <div className="flex flex-col gap-2.5 p-3 rounded-xl bg-slate-50/70 dark:bg-slate-900/30 border border-slate-200 dark:border-[#243046]">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <i className="fa-light fa-list-ol text-blue-600 dark:text-blue-400 text-xs"></i>
                          <span className="text-xs font-semibold text-slate-800 dark:text-base-content">
                            {t("send-in-order")}
                          </span>
                          <a
                            data-tooltip-id="sendInOrder-tooltip"
                            className="cursor-pointer text-blue-600 dark:text-blue-400 opacity-80 hover:opacity-100"
                          >
                            <i className="fa-light fa-circle-question text-xs"></i>
                          </a>
                          <Tooltip id="sendInOrder-tooltip" className="z-[999]">
                            <div className="max-w-[280px] text-xs">
                              <p className="font-bold mb-1">{t("send-in-order")}</p>
                              <p>{t("send-in-order-help.p1")}</p>
                            </div>
                          </Tooltip>
                        </div>

                        <div className="flex items-center bg-slate-100 dark:bg-slate-900/60 p-0.5 rounded-lg border border-slate-200 dark:border-[#243046]">
                          <button
                            type="button"
                            onClick={() =>
                              setFormData({ ...formData, SendinOrder: "true" })
                            }
                            className={`px-3 py-1 rounded-md text-xs font-semibold transition-all ${
                              formData.SendinOrder === "true"
                                ? "bg-blue-600 text-white shadow-sm"
                                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                            }`}
                          >
                            {t("yes")}
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setFormData({
                                ...formData,
                                SendinOrder: "false",
                                SendInOrderStrict: "false"
                              })
                            }
                            className={`px-3 py-1 rounded-md text-xs font-semibold transition-all ${
                              formData.SendinOrder === "false"
                                ? "bg-blue-600 text-white shadow-sm"
                                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                            }`}
                          >
                            {t("no")}
                          </button>
                        </div>
                      </div>

                      {formData.SendinOrder === "true" && (
                        <div className="flex items-center gap-2 pt-2 border-t border-slate-200 dark:border-[#243046]">
                          <input
                            type="checkbox"
                            id="strictOrderCheckTpl"
                            className="op-checkbox op-checkbox-xs border-slate-300 dark:border-slate-500 checked:bg-blue-600 checked:border-blue-600"
                            name="SendInOrderStrict"
                            checked={formData.SendInOrderStrict === "true"}
                            onChange={(e) =>
                              setFormData({
                                ...formData,
                                SendInOrderStrict: e.target.checked
                                  ? "true"
                                  : "false"
                              })
                            }
                          />
                          <label
                            htmlFor="strictOrderCheckTpl"
                            className="text-xs text-slate-700 dark:text-slate-300 cursor-pointer"
                            title={t("strict-order-help")}
                          >
                            {t("strict-order")}
                          </label>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* COLUMNA DERECHA (6 de 12 cols) */}
                <div className="lg:col-span-6 flex flex-col gap-3.5">
                  {/* Título del Documento */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-base-content mb-1">
                      {props.title === "New Template"
                        ? t("template-title")
                        : t("document-title")}
                      <span className="text-red-500 text-xs ml-0.5">*</span>
                    </label>
                    <input
                      name="Name"
                      className="op-input op-input-sm focus:outline-none border border-slate-200 dark:border-[#243046] focus:border-blue-500 w-full text-xs rounded-lg bg-white dark:bg-[#101828] text-slate-800 dark:text-base-content placeholder:text-slate-400"
                      value={formData.Name}
                      placeholder={t("enter-document-title", "Ingrese el título del documento")}
                      onChange={(e) => handleStrInput(e)}
                      onInvalid={(e) =>
                        e.target.setCustomValidity(t("input-required"))
                      }
                      onInput={(e) => e.target.setCustomValidity("")}
                      required
                    />
                  </div>

                  {/* Descripción (si es plantilla) */}
                  {props.title === "New Template" && (
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-base-content mb-1">
                        {t("description")}
                      </label>
                      <input
                        name="Description"
                        className="op-input op-input-sm focus:outline-none border border-slate-200 dark:border-[#243046] focus:border-blue-500 w-full text-xs rounded-lg bg-white dark:bg-[#101828] text-slate-800 dark:text-base-content placeholder:text-slate-400"
                        value={formData.Description}
                        placeholder={t("enter-description", "Ingrese una descripción")}
                        onChange={(e) => handleStrInput(e)}
                      />
                    </div>
                  )}

                  {/* Firmantes (si aplica) */}
                  {props.signers && (
                    <div>
                      <SignersInput
                        label={t("signers", "Firmantes")}
                        onChange={handleSigners}
                        isReset={isReset}
                        zindex={50}
                        isAddYourSelfCheckbox
                        required
                      />
                    </div>
                  )}

                  {/* Nota */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-base-content mb-1">
                      {t("report-heading.Note")}
                      <span className="text-red-500 text-xs ml-0.5">*</span>
                    </label>
                    <textarea
                      name="Note"
                      rows={2}
                      className="op-textarea op-textarea-sm focus:outline-none border border-slate-200 dark:border-[#243046] focus:border-blue-500 w-full text-xs rounded-lg bg-white dark:bg-[#101828] text-slate-800 dark:text-base-content leading-relaxed placeholder:text-slate-400"
                      value={formData.Note}
                      onChange={(e) => handleStrInput(e)}
                      onInvalid={(e) =>
                        e.target.setCustomValidity(t("input-required"))
                      }
                      onInput={(e) => e.target.setCustomValidity("")}
                      required
                    />
                  </div>

                  {/* En "Firma tu mismo": Ubicación en Drive */}
                  {props.title === "Sign Yourself" && (
                    <div className="flex flex-col">
                      <SelectFolder
                        onSuccess={handleFolder}
                        folderCls={props.Cls}
                        isReset={isReset}
                      />
                    </div>
                  )}

                  {/* En "Solicitar firmas": Enviar en orden */}
                  {props.title === "Request Signatures" && (
                    <div className="flex flex-col gap-2.5 p-3 rounded-xl bg-slate-50/70 dark:bg-slate-900/30 border border-slate-200 dark:border-[#243046]">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <i className="fa-light fa-list-ol text-blue-600 dark:text-blue-400 text-xs"></i>
                          <span className="text-xs font-semibold text-slate-800 dark:text-base-content">
                            {t("send-in-order")}
                          </span>
                          <a
                            data-tooltip-id="sendInOrder-tooltip"
                            className="cursor-pointer text-blue-600 dark:text-blue-400 opacity-80 hover:opacity-100"
                          >
                            <i className="fa-light fa-circle-question text-xs"></i>
                          </a>
                          <Tooltip id="sendInOrder-tooltip" className="z-[999]">
                            <div className="max-w-[280px] text-xs">
                              <p className="font-bold mb-1">{t("send-in-order")}</p>
                              <p>{t("send-in-order-help.p1")}</p>
                            </div>
                          </Tooltip>
                        </div>

                        <div className="flex items-center bg-slate-100 dark:bg-slate-900/60 p-0.5 rounded-lg border border-slate-200 dark:border-[#243046]">
                          <button
                            type="button"
                            onClick={() =>
                              setFormData({ ...formData, SendinOrder: "true" })
                            }
                            className={`px-3 py-1 rounded-md text-xs font-semibold transition-all ${
                              formData.SendinOrder === "true"
                                ? "bg-blue-600 text-white shadow-sm"
                                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                            }`}
                          >
                            {t("yes")}
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setFormData({
                                ...formData,
                                SendinOrder: "false",
                                SendInOrderStrict: "false"
                              })
                            }
                            className={`px-3 py-1 rounded-md text-xs font-semibold transition-all ${
                              formData.SendinOrder === "false"
                                ? "bg-blue-600 text-white shadow-sm"
                                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                            }`}
                          >
                            {t("no")}
                          </button>
                        </div>
                      </div>

                      {formData.SendinOrder === "true" && (
                        <div className="flex items-center gap-2 pt-2 border-t border-slate-200 dark:border-[#243046]">
                          <input
                            type="checkbox"
                            id="strictOrderCheck"
                            className="op-checkbox op-checkbox-xs border-slate-300 dark:border-slate-500 checked:bg-blue-600 checked:border-blue-600"
                            name="SendInOrderStrict"
                            checked={formData.SendInOrderStrict === "true"}
                            onChange={(e) =>
                              setFormData({
                                ...formData,
                                SendInOrderStrict: e.target.checked
                                  ? "true"
                                  : "false"
                              })
                            }
                          />
                          <label
                            htmlFor="strictOrderCheck"
                            className="text-xs text-slate-700 dark:text-slate-300 cursor-pointer"
                            title={t("strict-order-help")}
                          >
                            {t("strict-order")}
                          </label>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Opciones avanzadas A ANCHO COMPLETO (no deforma ni desequilibra el formulario) */}
              {props.title !== "Sign Yourself" && (
                <div className="flex flex-col pt-3 mt-3 border-t border-slate-200 dark:border-[#243046]">
                  <button
                    type="button"
                    onClick={() => setIsAdvanceOpt(!isAdvanceOpt)}
                    className="flex items-center justify-between py-1 px-0.5 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors group w-full"
                  >
                    <span className="flex items-center gap-1.5">
                      <i className="fa-light fa-sliders text-xs"></i>
                      <span>
                        {isAdvanceOpt
                          ? t("hide-advanced-options")
                          : t("advanced-options")}
                      </span>
                    </span>
                    <i
                      className={`fa-light fa-chevron-down text-[10px] transition-transform duration-200 ${
                        isAdvanceOpt ? "rotate-180" : ""
                      }`}
                    ></i>
                  </button>

                  {isAdvanceOpt && (
                    <div className="pt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Columna Izquierda de Opciones Avanzadas */}
                      <div className="flex flex-col gap-3">
                        {/* Tiempo para completar */}
                        <div>
                          <label className="block text-xs font-medium text-slate-700 dark:text-base-content mb-1">
                            {t("time-to-complete")} (días)
                            <span className="text-red-500 text-xs ml-0.5">*</span>
                          </label>
                          <input
                            type="number"
                            name="TimeToCompleteDays"
                            className="op-input op-input-sm focus:outline-none border border-slate-200 dark:border-[#243046] focus:border-blue-500 w-full text-xs rounded-lg bg-white dark:bg-[#101828] text-slate-800 dark:text-base-content placeholder:text-slate-400"
                            value={formData.TimeToCompleteDays}
                            onChange={(e) => handleStrInput(e)}
                            onInvalid={(e) =>
                              e.target.setCustomValidity(t("input-required"))
                            }
                            onInput={(e) => e.target.setCustomValidity("")}
                            min={1}
                            required
                          />
                        </div>

                        {/* Recordatorio automático */}
                        {formData?.autoreminder === true && (
                          <div>
                            <label className="block text-xs font-medium text-slate-700 dark:text-base-content mb-1">
                              {t("remind-once")}
                              <span className="text-red-500 text-xs ml-0.5">*</span>
                            </label>
                            <input
                              type="number"
                              value={formData.remindOnceInEvery}
                              name="remindOnceInEvery"
                              className="op-input op-input-sm focus:outline-none border border-slate-200 dark:border-[#243046] focus:border-blue-500 w-full text-xs rounded-lg bg-white dark:bg-[#101828] text-slate-800 dark:text-base-content placeholder:text-slate-400"
                              onChange={handleStrInput}
                              onInvalid={(e) => reminderCustomWarning(e)}
                              onInput={(e) => e.target.setCustomValidity("")}
                              min={1}
                              max={formData?.TimeToCompleteDays}
                              required
                            />
                          </div>
                        )}

                        {/* Tour y Notificaciones */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                          <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-50 dark:bg-slate-900/30 border border-slate-200 dark:border-[#243046]">
                            <span className="text-xs font-medium text-slate-700 dark:text-base-content">
                              {t("enable-tour")}
                            </span>
                            <input
                              type="checkbox"
                              className="op-toggle op-toggle-xs checked:bg-blue-600 border-slate-300 dark:border-slate-600 bg-slate-200 dark:bg-slate-700"
                              checked={formData.IsTourEnabled === "true"}
                              onChange={(e) =>
                                setFormData({
                                  ...formData,
                                  IsTourEnabled: e.target.checked
                                    ? "true"
                                    : "false"
                                })
                              }
                            />
                          </div>

                          <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-50 dark:bg-slate-900/30 border border-slate-200 dark:border-[#243046]">
                            <span className="text-xs font-medium text-slate-700 dark:text-base-content">
                              {t("notify-on-signatures")}
                            </span>
                            <input
                              type="checkbox"
                              className="op-toggle op-toggle-xs checked:bg-blue-600 border-slate-300 dark:border-slate-600 bg-slate-200 dark:bg-slate-700"
                              checked={formData.NotifyOnSignatures === true}
                              onChange={(e) =>
                                handleNotifySignChange(e.target.checked)
                              }
                            />
                          </div>
                        </div>

                        {/* Colores de bolígrafo permitidos */}
                        <div>
                          <label className="block text-xs font-medium text-slate-700 dark:text-base-content mb-1.5">
                            {t("pen-colors") || "Colores de firma permitidos"}
                          </label>
                          <div className="flex flex-wrap gap-1.5">
                            {pensList.map((color) => {
                              const isSelected = selectedColors.includes(color);
                              const colorDot =
                                color === "blue"
                                  ? "bg-blue-600"
                                  : color === "red"
                                  ? "bg-red-600"
                                  : "bg-slate-900 dark:bg-slate-200";
                              return (
                                <button
                                  key={color}
                                  type="button"
                                  onClick={() => handleColorsChange(color)}
                                  className={`px-2.5 py-1 rounded-md text-xs font-medium flex items-center gap-1.5 border transition-all ${
                                    isSelected
                                      ? "border-blue-600 bg-blue-50 text-blue-600 dark:border-blue-500 dark:bg-blue-500/15 dark:text-blue-400 font-semibold shadow-sm"
                                      : "border-slate-200 dark:border-[#243046] text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 bg-slate-50 dark:bg-slate-800/20"
                                  }`}
                                >
                                  <span
                                    className={`w-2 h-2 rounded-full ${colorDot}`}
                                  ></span>
                                  <span className="capitalize">{color}</span>
                                  {isSelected && (
                                    <i className="fa-solid fa-check text-[9px]"></i>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>

                      {/* Columna Derecha de Opciones Avanzadas */}
                      <div className="flex flex-col gap-3">
                        {/* Copia Oculta (BCC) y Con Copia (CC) */}
                        {props.bcc && (
                          <SignersInput
                            label={t("Bcc")}
                            initialData={bcc}
                            onChange={handleBcc}
                            isReset={isReset}
                            zindex={50}
                            helpText={t("bcc-help")}
                            isCaptureAllData
                            isAddYourSelfCheckbox
                          />
                        )}
                        {props.cc && (
                          <SignersInput
                            label={t("Cc")}
                            initialData={cc}
                            onChange={handleCc}
                            isReset={isReset}
                            zindex={50}
                            helpText={t("cc-help")}
                            isCaptureAllData
                            isAddYourSelfCheckbox
                          />
                        )}

                        {/* URL de Redirección */}
                        <div>
                          <label className="block text-xs font-medium text-slate-700 dark:text-base-content mb-1">
                            {t("redirect-url")}
                          </label>
                          <input
                            name="RedirectUrl"
                            className="op-input op-input-sm focus:outline-none border border-slate-200 dark:border-[#243046] focus:border-blue-500 w-full text-xs rounded-lg bg-white dark:bg-[#101828] text-slate-800 dark:text-base-content placeholder:text-slate-400"
                            value={formData.RedirectUrl}
                            placeholder="https://ejemplo.com/completado"
                            onChange={(e) => handleStrInput(e)}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}


              {/* Barra Inferior de Acciones */}
              <div className="flex items-center justify-end gap-2.5 pt-4 mt-auto border-t border-slate-200 dark:border-[#243046]">
                <button
                  type="button"
                  className="op-btn op-btn-ghost op-btn-sm text-xs font-medium rounded-lg text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800/40"
                  onClick={() => handleCancel()}
                >
                  {t("cancel")}
                </button>
                <button
                  type="submit"
                  disabled={isSubmit || !fileupload}
                  className={`op-btn op-btn-sm text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-1.5 border-none shadow-sm ${
                    isSubmit || !fileupload
                      ? "opacity-50 cursor-not-allowed"
                      : ""
                  }`}
                >
                  <span>{t("next")}</span>
                  <i className="fa-light fa-arrow-right text-xs"></i>
                </button>
              </div>
            </form>
          </div>
        </>
      )}
    </div>
  );
};
export default Form;
