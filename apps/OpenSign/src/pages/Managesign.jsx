import { useState, useRef, useEffect } from "react";
import SignatureCanvas from "react-signature-canvas";
import { PenTool, Edit3, Stamp, Upload, RotateCcw, Check } from "lucide-react";
import {
  generateTitleFromFilename,
  getSecureUrl,
  toDataUrl
} from "../constant/Utils";
import Parse from "parse";
import { SaveFileSize } from "../constant/saveFileSize";
import Loader from "../primitives/Loader";
import { useTranslation } from "react-i18next";
import { notify, sanitizeFileName, withSessionValidation } from "../utils";

const SWATCH_CLASS = {
  blue: "bg-blue-600",
  red: "bg-red-600",
  black: "bg-black"
};

const ALLOWED_STAMP_MIME_TYPES = ["image/png", "image/jpeg"];
const MAX_STAMP_FILE_SIZE_MB = 5;
const MAX_STAMP_FILE_SIZE_BYTES = MAX_STAMP_FILE_SIZE_MB * 1024 * 1024;

const SignatureStatusBadge = ({ isConfigured, t }) => (
  <span
    role="status"
    aria-live="polite"
    className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-md whitespace-nowrap ${
      isConfigured
        ? "bg-green-500/10 text-green-600"
        : "bg-base-200 text-base-content/60"
    }`}
  >
    {isConfigured ? t("signature-configured") : t("signature-not-defined")}
  </span>
);

const ColorSwatches = ({ colors, selectedColor, onSelect }) => (
  <div className="flex flex-row gap-1.5">
    {colors.map((color) => {
      const selected = selectedColor === color;
      return (
        <button
          key={color}
          type="button"
          aria-label={color}
          aria-pressed={selected}
          onClick={() => onSelect(color)}
          className={`w-6 h-6 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-base-100 ${
            SWATCH_CLASS[color] ?? ""
          } ${
            selected ? "ring-2 ring-offset-2 ring-primary ring-offset-base-100" : ""
          }`}
        />
      );
    })}
  </div>
);

const ManageSign = () => {
  const { t } = useTranslation();
  const [penColor, setPenColor] = useState("blue");
  const [initialPen, setInitialPen] = useState("blue");
  const [image, setImage] = useState();
  const [signName, setSignName] = useState("");
  const [signature, setSignature] = useState("");
  const [isvalue, setIsValue] = useState(false);
  const allColor = ["blue", "red", "black"];
  const [isLoader, setIsLoader] = useState(true);
  const [Initials, setInitials] = useState("");
  const [isInitials, setIsInitials] = useState(false);
  const [id, setId] = useState("");
  const [imgInitials, setImgInitials] = useState("");
  const [stamp, setStamp] = useState();
  const [isStampDragging, setIsStampDragging] = useState(false);
  const canvasRef = useRef(null);
  const imageRef = useRef(null);
  const initailsRef = useRef(null);
  const imgInitialsRef = useRef(null);
  const stampRef = useRef(null);
  useEffect(() => {
    fetchUserSign();
    // eslint-disable-next-line
  }, []);
  const fetchUserSign = async () => {
    const User = Parse.User.current();
    if (User) {
      try {
        const signRes = await Parse.Cloud.run("getdefaultsignature", {
          userId: User.id
        });
        if (signRes) {
          const res = signRes.toJSON();
          setId(res.objectId);
          if (res?.SignatureName) {
            const sanitizename = generateTitleFromFilename(res?.SignatureName);
            const replaceSpace = sanitizeFileName(sanitizename);
            setSignName(replaceSpace);
          }
          setImage(res?.ImageURL);
          if (res && res.Initials) {
            setIsInitials(true);
            setImgInitials(res?.Initials);
          }
          if (res && res?.Stamp) {
            setStamp(res?.Stamp);
          }
        } else {
          if (User?.get("name")) {
            const sanitizename = generateTitleFromFilename(User?.get("name"));
            const replaceSpace = sanitizeFileName(sanitizename);
            setSignName(replaceSpace);
          }
        }
        setIsLoader(false);
      } catch (err) {
        console.log("Err", err);
        notify.error(`${err.message}`);
        setIsLoader(false);
      }
    }
  };
  const handleSignatureChange = () => {
    if (imageRef.current) {
      imageRef.current.value = "";
    }
    setImage("");
    setSignature(canvasRef.current.toDataURL());
    setIsValue(true);
  };
  const handleClear = () => {
    if (canvasRef.current) {
      canvasRef.current.clear();
    }
    if (imageRef.current) {
      imageRef.current.value = "";
    }
    setImage("");
    setSignature("");
    setIsValue(false);
  };

  const handleClearInitials = () => {
    if (initailsRef.current) {
      initailsRef.current.clear();
    }
    if (imgInitialsRef.current) {
      imgInitialsRef.current.value = "";
    }
    setImgInitials("");
    setInitials("");
    if (image) {
      setIsValue(true);
    }
    setIsInitials(false);
  };

  const onImageChange = async (event) => {
    if (canvasRef.current) {
      canvasRef.current.clear();
    }
    setSignature("");
    if (event.target.files && event.target.files[0]) {
      const file = event.target.files[0];
      const base64Img = await toDataUrl(file);
      setImage(base64Img);
      setIsValue(true);
    } else {
      setImage("");
      setIsValue(false);
    }
  };
  const handleSubmit = withSessionValidation(async (e) => {
    e.preventDefault();
    if (!isvalue) {
      notify.warning(t("upload-signature/Image"));
      return;
    }
    const isUrl = image?.includes("https") || image?.includes("http");
    setIsLoader(true);
    const sanitizename = generateTitleFromFilename(signName);
    const replaceSpace = sanitizeFileName(sanitizename);
    let file;
    if (signature) {
      file = base64StringtoFile(signature, `${replaceSpace}_sign`);
    } else {
      if (image && !isUrl) {
        file = base64StringtoFile(image, `${replaceSpace}__sign`);
      }
    }
    let imgUrl;
    if (file && !isUrl) {
      imgUrl = await uploadFile(file);
    } else {
      imgUrl = image;
    }
    const isInitialsUrl =
      imgInitials?.includes("https") || imgInitials?.includes("http");

    let initialFile;
    if (Initials) {
      initialFile = base64StringtoFile(Initials, `${replaceSpace}_sign`);
    } else {
      if (imgInitials && !isInitialsUrl) {
        initialFile = base64StringtoFile(imgInitials, `${replaceSpace}__sign`);
      }
    }
    let initialsUrl;
    if (initialFile && !isInitialsUrl) {
      initialsUrl = await uploadFile(initialFile);
    } else {
      initialsUrl = imgInitials;
    }
    const isStampUrl = stamp?.includes("https") || stamp?.includes("http");

    let stampFile;
    if (stamp && !isStampUrl) {
      stampFile = base64StringtoFile(stamp, `${replaceSpace}_stamp`);
    }
    let stampUrl;
    if (stampFile && !isStampUrl) {
      stampUrl = await uploadFile(stampFile);
    } else {
      stampUrl = stamp;
    }
    if (imgUrl) {
      await saveEntry({
        name: signName,
        url: imgUrl,
        initialsUrl: initialsUrl,
        stampUrl: stampUrl
      });
    }
  });
  function base64StringtoFile(base64String, filename) {
    let arr = base64String.split(","),
      mime = arr[0].match(/:(.*?);/)[1],
      bstr = atob(arr[1]),
      n = bstr.length,
      u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    const ext = mime.split("/").pop();
    const name = `${filename}.${ext}`;
    return new File([u8arr], name, { type: mime });
  }

  const uploadFile = async (file) => {
    try {
      const parseFile = new Parse.File(file.name, file);
      const response = await parseFile.save();
      if (response?.url()) {
        const fileRes = await getSecureUrl(response?.url());
        if (fileRes?.url) {
          const tenantId = localStorage.getItem("TenantId");
          const userId = Parse?.User?.current()?.id;
          SaveFileSize(file.size, fileRes?.url, tenantId, userId);
          return fileRes?.url;
        } else {
          notify.error(t("something-went-wrong-mssg"));
          setIsLoader(false);
          return false;
        }
      } else {
        notify.error(t("something-went-wrong-mssg"));
        setIsLoader(false);
        return false;
      }
    } catch (err) {
      console.log("sign upload err", err);
      setIsLoader(false);
      notify.error(`${err.message}`);
    }
  };

  const saveEntry = async (obj) => {
    try {
      const User = Parse?.User?.current()?.id;
      const res = await Parse.Cloud.run("managesign", {
        signature: obj.url,
        userId: User,
        initials: obj.initialsUrl,
        id: id,
        title: obj.name,
        stamp: obj?.stampUrl
      });
      notify.success(t("signature-saved-alert"));
      return res;
    } catch (err) {
      console.log(err);
      notify.error(`${err.message}`);
    } finally {
      setIsLoader(false);
    }
  };

  const handleUploadBtn = () => {
    imageRef.current.click();
  };
  const handleInitialsChange = () => {
    setInitials(initailsRef.current.toDataURL());
    if (image || signature) {
      setIsValue(true);
    }
  };
  const handleUploadInitials = () => {
    imgInitialsRef.current.click();
  };
  const onImgInitialsChange = async (event) => {
    if (initailsRef.current) {
      initailsRef.current.clear();
    }
    setInitials("");
    if (event.target.files && event.target.files[0]) {
      const file = event.target.files[0];
      const base64Img = await toDataUrl(file);
      setImgInitials(base64Img);
      if (image || signature) {
        setIsValue(true);
      }
    } else {
      setImgInitials("");
      setIsValue(false);
    }
  };
  const handleClearStamp = () => {
    if (stampRef.current) {
      stampRef.current.value = "";
    }
    setStamp("");
    if (image) {
      setIsValue(true);
    }
  };
  const processStampFile = async (file) => {
    const isAllowedType = ALLOWED_STAMP_MIME_TYPES.includes(file.type);
    const isAllowedSize = file.size <= MAX_STAMP_FILE_SIZE_BYTES;
    if (!isAllowedType || !isAllowedSize) {
      notify.warning(
        t("stamp-invalid-file", { maxSizeMB: MAX_STAMP_FILE_SIZE_MB })
      );
      return;
    }
    const base64Img = await toDataUrl(file);
    setStamp(base64Img);
    setIsValue(true);
  };
  const onStampChange = async (event) => {
    if (event.target.files && event.target.files[0]) {
      await processStampFile(event.target.files[0]);
    } else {
      setStamp("");
    }
  };
  const handleStampDragOver = (event) => {
    event.preventDefault();
    event.stopPropagation();
    setIsStampDragging(true);
  };
  const handleStampDragLeave = (event) => {
    event.preventDefault();
    event.stopPropagation();
    setIsStampDragging(false);
  };
  const handleStampDrop = async (event) => {
    event.preventDefault();
    event.stopPropagation();
    setIsStampDragging(false);
    if (event.dataTransfer?.files?.length > 0) {
      await processStampFile(event.dataTransfer.files[0]);
    }
  };
  const isSignatureConfigured = Boolean(image || signature);
  const isInitialsConfigured = Boolean(imgInitials || Initials);
  const isStampConfigured = Boolean(stamp);
  return (
    <div className="relative h-full bg-base-100 text-base-content flex rounded-box overflow-auto">
      {isLoader && (
        <div className="absolute bg-black bg-opacity-30 z-50 w-full h-full flex justify-center items-center">
          <Loader />
        </div>
      )}
      <div className="relative w-full">
        <div className="mx-[5px] my-[20px] md:m-[20px]">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
              <PenTool size={18} />
            </div>
            <div>
              <div className="text-[20px] font-semibold">
                {t("my-signature")}
              </div>
              <p className="text-sm text-base-content/60">
                {t("managesign-subtitle")}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-5">
            <div className="op-card p-4 md:p-5 flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
                    <PenTool size={16} />
                  </div>
                  <span className="font-medium select-none truncate">
                    {t("signature")}
                  </span>
                </div>
                <SignatureStatusBadge isConfigured={isSignatureConfigured} t={t} />
              </div>
              <input
                type="file"
                onChange={onImageChange}
                className="filetype"
                accept="image/*"
                ref={imageRef}
                data-testid="signature-file-input"
                hidden
              />
              {image ? (
                <div className="relative border border-base-200 rounded-box overflow-hidden bg-white w-full aspect-[5/2]">
                  <img
                    alt="signature"
                    src={image}
                    className="w-full h-full object-contain"
                  />
                </div>
              ) : (
                <SignatureCanvas
                  ref={canvasRef}
                  penColor={penColor}
                  canvasProps={{
                    className:
                      "border border-base-200 rounded-box bg-white w-full aspect-[5/2]",
                    role: "img",
                    "aria-label": `${t("signature")} - ${
                      isSignatureConfigured
                        ? t("signature-configured")
                        : t("signature-not-defined")
                    }`
                  }}
                  onEnd={() => handleSignatureChange()}
                  dotSize={1}
                />
              )}
              <div className="flex flex-row items-center justify-between gap-2">
                {!image ? (
                  <ColorSwatches
                    colors={allColor}
                    selectedColor={penColor}
                    onSelect={setPenColor}
                  />
                ) : (
                  <span />
                )}
                <div className="flex flex-row gap-1.5">
                  <button
                    type="button"
                    className="op-btn op-btn-ghost op-btn-sm gap-1.5"
                    onClick={() => handleUploadBtn()}
                  >
                    <Upload size={14} />
                    {t("upload")}
                  </button>
                  <button
                    type="button"
                    className="op-btn op-btn-ghost op-btn-sm gap-1.5"
                    onClick={() => handleClear()}
                  >
                    <RotateCcw size={14} />
                    {t("clear")}
                  </button>
                </div>
              </div>
            </div>

            <div className="op-card p-4 md:p-5 flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
                    <Edit3 size={16} />
                  </div>
                  <span className="font-medium select-none truncate">
                    {t("initials")}
                  </span>
                </div>
                <SignatureStatusBadge isConfigured={isInitialsConfigured} t={t} />
              </div>
              <input
                type="file"
                onChange={onImgInitialsChange}
                className="filetype"
                accept="image/*"
                ref={imgInitialsRef}
                data-testid="initials-file-input"
                hidden
              />
              {imgInitials ? (
                <div className="relative border border-base-200 rounded-box overflow-hidden bg-white w-full max-w-[180px] aspect-square mx-auto">
                  <img
                    alt="initials"
                    src={imgInitials}
                    className="w-full h-full object-contain"
                  />
                </div>
              ) : (
                <SignatureCanvas
                  ref={initailsRef}
                  penColor={initialPen}
                  canvasProps={{
                    className:
                      "border border-base-200 rounded-box bg-white w-full max-w-[180px] aspect-square mx-auto",
                    role: "img",
                    "aria-label": `${t("initials")} - ${
                      isInitialsConfigured
                        ? t("signature-configured")
                        : t("signature-not-defined")
                    }`
                  }}
                  onEnd={() => handleInitialsChange()}
                  dotSize={1}
                />
              )}
              <div className="flex flex-row items-center justify-between gap-2">
                {!isInitials ? (
                  <ColorSwatches
                    colors={allColor}
                    selectedColor={initialPen}
                    onSelect={setInitialPen}
                  />
                ) : (
                  <span />
                )}
                <div className="flex flex-row gap-1.5">
                  <button
                    type="button"
                    className="op-btn op-btn-ghost op-btn-sm gap-1.5"
                    onClick={() => handleUploadInitials()}
                  >
                    <Upload size={14} />
                    {t("upload")}
                  </button>
                  <button
                    type="button"
                    className="op-btn op-btn-ghost op-btn-sm gap-1.5"
                    onClick={() => handleClearInitials()}
                  >
                    <RotateCcw size={14} />
                    {t("clear")}
                  </button>
                </div>
              </div>
            </div>

            <div className="op-card p-4 md:p-5 flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
                    <Stamp size={16} />
                  </div>
                  <span className="font-medium select-none truncate">
                    {t("stamp")}
                  </span>
                </div>
                <SignatureStatusBadge isConfigured={isStampConfigured} t={t} />
              </div>
              <input
                onChange={onStampChange}
                type="file"
                className="filetype"
                accept="image/png,image/jpeg"
                hidden
                ref={stampRef}
                data-testid="stamp-file-input"
              />
              <div
                data-testid="stamp-dropzone"
                role={stamp ? undefined : "button"}
                tabIndex={stamp ? undefined : 0}
                aria-label={stamp ? undefined : t("drop-stamp-here")}
                onClick={() => !stamp && stampRef.current?.click()}
                onKeyDown={(event) => {
                  if (stamp) return;
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    stampRef.current?.click();
                  }
                }}
                onDragOver={handleStampDragOver}
                onDragLeave={handleStampDragLeave}
                onDrop={handleStampDrop}
                className={`relative border-2 border-dashed rounded-xl flex flex-col items-center justify-center w-full aspect-[5/2] overflow-hidden transition-colors duration-200 ${
                  stamp ? "" : "cursor-pointer"
                } ${
                  stamp
                    ? ""
                    : "outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                } ${
                  isStampDragging
                    ? "border-blue-500 bg-blue-50/50 dark:bg-blue-500/10 scale-[1.01]"
                    : "border-slate-300 bg-white hover:border-blue-500/60"
                }`}
              >
                {stamp ? (
                  <img
                    alt={t("stamp")}
                    src={stamp}
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <>
                    <Upload size={24} className="text-slate-500" />
                    <div className="text-[13px] text-slate-600 mt-1.5 px-4 text-center">
                      {t("drop-stamp-here")}
                    </div>
                  </>
                )}
              </div>
              <div className="flex justify-end">
                <button
                  type="button"
                  className="op-btn op-btn-ghost op-btn-sm gap-1.5"
                  onClick={() => handleClearStamp()}
                >
                  <RotateCcw size={14} />
                  {t("clear")}
                </button>
              </div>
            </div>
          </div>
          <div className="pt-5">
            <button
              type="button"
              className="op-btn op-btn-primary gap-2"
              disabled={isLoader}
              onClick={(e) => handleSubmit(e)}
            >
              {isLoader ? (
                <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              ) : (
                <Check size={16} />
              )}
              {t("save")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ManageSign;
