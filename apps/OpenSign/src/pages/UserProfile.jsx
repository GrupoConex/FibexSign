import React, { useState, useEffect, useRef } from "react";
import { Navigate, useNavigate } from "react-router";
import Parse from "parse";
import { SaveFileSize } from "../constant/saveFileSize";
import dp from "../assets/images/dp.png";
import {
  compressImage,
  notify,
  sanitizeFileName,
  withSessionValidation
} from "../utils";
import axios from "axios";
import { getSecureUrl, handleSendOTP } from "../constant/Utils";
import ModalUi from "../primitives/ModalUi";
import Loader from "../primitives/Loader";
import { useTranslation } from "react-i18next";
import { ShieldCheck, Camera } from "lucide-react";
import PersonalInfoCard from "../components/profile/PersonalInfoCard";
import ProfessionalInfoCard from "../components/profile/ProfessionalInfoCard";
import PreferencesCard from "../components/profile/PreferencesCard";
import SecurityCard from "../components/profile/SecurityCard";

const INITIALS_BADGE_CLASSES = [
  "bg-primary text-primary-content",
  "bg-secondary text-secondary-content",
  "bg-accent text-accent-content",
  "bg-info text-info-content",
  "bg-success text-success-content",
  "bg-warning text-warning-content"
];

const ROLE_BADGE_CLASSES = {
  Admin: "op-badge-primary",
  OrgAdmin: "op-badge-accent",
  Editor: "op-badge-secondary",
  User: "op-badge-ghost",
  Guest: "op-badge-ghost"
};

const PHONE_FORMAT_REGEX = /^[+]?[\d\s().-]{7,20}$/;

function readLocalStorageJson(key) {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (error) {
    console.error(`Unable to parse localStorage key "${key}"`, error);
    return null;
  }
}

function getInitialsFromName(fullName) {
  if (!fullName) return "";
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  const first = parts[0][0] || "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] || "" : "";
  return `${first}${last}`.toUpperCase();
}

function getInitialsBadgeClass(fullName) {
  if (!fullName) return INITIALS_BADGE_CLASSES[0];
  const code = fullName.charCodeAt(0) || 0;
  return INITIALS_BADGE_CLASSES[code % INITIALS_BADGE_CLASSES.length];
}

function getRoleBadgeClass(role) {
  return ROLE_BADGE_CLASSES[role] || "op-badge-ghost";
}

function isValidPhoneFormat(phone) {
  if (!phone) return true;
  return PHONE_FORMAT_REGEX.test(phone);
}

function UserProfile() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const storedUserInfo = readLocalStorageJson("UserInformation");
  const extendUser = readLocalStorageJson("Extand_Class");
  const [parseBaseUrl] = useState(localStorage.getItem("baseUrl"));
  const [parseAppId] = useState(localStorage.getItem("parseAppId"));
  const [editmode, setEditMode] = useState(false);
  const [name, SetName] = useState(localStorage.getItem("username"));
  const [Phone, SetPhone] = useState(storedUserInfo?.phone);
  const [Image, setImage] = useState(localStorage.getItem("profileImg"));
  const [previewUrl, setPreviewUrl] = useState(null);
  const [isLoader, setIsLoader] = useState(false);
  const [percentage, setpercentage] = useState(0);
  const [company, setCompany] = useState(extendUser?.[0]?.Company);
  const [jobTitle, setJobTitle] = useState(extendUser?.[0]?.JobTitle);
  const [nameError, setNameError] = useState("");
  const [phoneError, setPhoneError] = useState("");
  const [isVerifyModal, setIsVerifyModal] = useState(false);
  const [otp, setOtp] = useState("");
  const [otpLoader, setOtpLoader] = useState(false);
  const [isEmailVerified, setIsEmailVerified] = useState(false);
  const [isdeleteModal, setIsdeleteModal] = useState(false);
  const [deleteUserRes, setDeleteUserRes] = useState("");
  const [isDelLoader, setIsDelLoader] = useState(false);
  const avatarInputRef = useRef(null);
  const otpInputRef = useRef(null);
  const deleteCancelBtnRef = useRef(null);
  const uploadGenerationRef = useRef(0);

  useEffect(() => {
    getUserDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isVerifyModal && !otpLoader) {
      otpInputRef.current?.focus();
    }
  }, [isVerifyModal, otpLoader]);

  useEffect(() => {
    if (!isVerifyModal) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setIsVerifyModal(false);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isVerifyModal]);

  useEffect(() => {
    if (isdeleteModal && !isDelLoader && !deleteUserRes) {
      deleteCancelBtnRef.current?.focus();
    }
  }, [isdeleteModal, isDelLoader, deleteUserRes]);

  useEffect(() => {
    if (!isdeleteModal) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setIsdeleteModal(false);
        setDeleteUserRes("");
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isdeleteModal]);

  const getUserDetail = async () => {
    setIsLoader(true);
    const currentUser = JSON.parse(JSON.stringify(Parse.User.current()));
    let userEmailVerified = currentUser?.emailVerified || false;
    if (userEmailVerified) {
      setIsEmailVerified(userEmailVerified);
      setIsLoader(false);
    } else {
      try {
        const userQuery = new Parse.Query(Parse.User);
        const user = await userQuery.get(currentUser.objectId, {
          sessionToken: localStorage.getItem("accesstoken")
        });
        if (user) {
          userEmailVerified = user?.get("emailVerified");
          setIsEmailVerified(userEmailVerified);
        }
      } catch (e) {
        notify.error(t("something-went-wrong-mssg"));
      } finally {
        setIsLoader(false);
      }
    }
  };

  const validateEditableFields = () => {
    const trimmedName = name?.trim();
    let isValid = true;
    if (!trimmedName) {
      setNameError(t("name-required"));
      isValid = false;
    } else {
      setNameError("");
    }
    if (!isValidPhoneFormat(Phone)) {
      setPhoneError(t("invalid-phone-format"));
      isValid = false;
    } else {
      setPhoneError("");
    }
    return isValid;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateEditableFields()) return;
    setIsLoader(true);
    try {
      const userExtendClass = Parse.Object.extend("_User");
      const query = new Parse.Query(userExtendClass);
      const object = await query.get(storedUserInfo?.objectId);
      object.set("name", name);
      object.set("ProfilePic", Image);
      object.set("phone", Phone || "");
      const response = await object.save();
      if (response) {
        const res = response.toJSON();
        localStorage.setItem("UserInformation", JSON.stringify(res));
        SetName(res.name);
        SetPhone(res?.phone || "");
        setImage(res.ProfilePic);
        localStorage.setItem("username", res.name);
        localStorage.setItem("profileImg", res.ProfilePic);
        await updateExtUser({
          Name: res.name,
          Phone: res?.phone || ""
        });
        notify.success(t("profile-update-alert"));
        setEditMode(false);
      }
    } catch (error) {
      notify.error(t("something-went-wrong-mssg"));
      console.error("Error while updating profile", error);
    } finally {
      setIsLoader(false);
    }
  };

  const updateExtUser = withSessionValidation(async (obj) => {
    try {
      const extData = readLocalStorageJson("Extand_Class");
      const ExtUserId = extData?.[0]?.objectId;
      const body = {
        Phone: obj?.Phone || "",
        Name: obj.Name,
        JobTitle: jobTitle,
        Company: company,
        Language: obj?.language || ""
      };

      await axios.put(
        parseBaseUrl + "classes/contracts_Users/" + ExtUserId,
        body,
        {
          headers: {
            "Content-Type": "application/json",
            "X-Parse-Application-Id": parseAppId,
            "X-Parse-Session-Token": localStorage.getItem("accesstoken")
          }
        }
      );
      const res = await Parse.Cloud.run("getUserDetails");

      const json = JSON.parse(JSON.stringify([res]));
      const extRes = JSON.stringify(json);
      localStorage.setItem("Extand_Class", extRes);
    } catch (err) {
      console.error("Error saving data in contracts_Users class", err);
    }
  });

  const fileUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    uploadGenerationRef.current += 1;
    const thisGeneration = uploadGenerationRef.current;
    const objectPreviewUrl = URL.createObjectURL(file);
    setPreviewUrl(objectPreviewUrl);
    try {
      const compressedfile = await compressImage(
        file,
        { width: 200, height: 200 },
        "file"
      );
      await handleFileUpload(compressedfile);
    } finally {
      URL.revokeObjectURL(objectPreviewUrl);
      if (uploadGenerationRef.current === thisGeneration) {
        setPreviewUrl(null);
      }
    }
  };

  const handleFileUpload = async (file) => {
    const size = file.size;
    const pdfFile = file;
    const fileName = file.name;
    const sanitizedName = sanitizeFileName(fileName);
    const parseFile = new Parse.File(sanitizedName, pdfFile);

    try {
      const response = await parseFile.save({
        progress: (progressValue, loaded, total) => {
          if (progressValue !== null) {
            const percentCompleted = Math.round((loaded * 100) / total);
            setpercentage(percentCompleted);
          }
        }
      });

      if (response?.url()) {
        const fileRes = await getSecureUrl(response?.url());
        if (fileRes?.url) {
          setImage(fileRes?.url);
          setpercentage(0);
          const tenantId = localStorage.getItem("TenantId");
          const userId = extendUser?.[0]?.UserId?.objectId;
          SaveFileSize(size, fileRes?.url, tenantId, userId);
          return fileRes?.url;
        }
      }
    } catch (error) {
      console.error("Error uploading file:", error);
    }
  };

  if (
    localStorage.getItem("accesstoken") === null &&
    localStorage.getItem("pageType") === null
  ) {
    const redirectTo = `/`;
    return <Navigate to={redirectTo} />;
  }

  const handleVerifyBtn = async () => {
    setIsVerifyModal(true);
    await handleSendOTP(Parse.User.current().getEmail());
  };
  const handleCloseVerifyModal = async () => {
    setIsVerifyModal(false);
  };
  const handleVerifyEmail = async (e) => {
    e.preventDefault();
    setOtpLoader(true);
    try {
      const resEmail = await Parse.Cloud.run("verifyemail", {
        otp: otp,
        email: Parse.User.current().getEmail()
      });
      if (resEmail?.message === "Email is verified.") {
        setIsEmailVerified(true);
        notify.success(t("Email-verified-alert-1"));
      } else if (resEmail?.message === "Email is already verified.") {
        setIsEmailVerified(true);
        notify.success(t("Email-verified-alert-2"));
      }
      setOtp("");
      setIsVerifyModal(false);
    } catch (error) {
      notify.error(error.message);
    } finally {
      setOtpLoader(false);
    }
  };
  const handleResend = async (e) => {
    e.preventDefault();
    setOtpLoader(true);
    await handleSendOTP(Parse.User.current().getEmail());
    setOtpLoader(false);
    notify.success(t("otp-sent-alert"));
  };

  const handleCancel = () => {
    setEditMode(false);
    setNameError("");
    setPhoneError("");
    SetName(localStorage.getItem("username"));
    SetPhone(storedUserInfo?.phone);
    setImage(localStorage.getItem("profileImg"));
    setCompany(extendUser?.[0]?.Company);
    setJobTitle(extendUser?.[0]?.JobTitle);
  };

  const handleEnterEditMode = () => {
    setNameError("");
    setPhoneError("");
    setEditMode(true);
  };

  const handleDeleteAccountBtn = () => {
    const isAdmin = extendUser?.[0]?.UserRole === "contracts_Admin";
    if (!isAdmin) {
      setDeleteUserRes(t("delete-action-prohibited"));
    }
    setIsdeleteModal(true);
  };

  const handleDeleteAccount = async (e) => {
    e.preventDefault();
    setIsDelLoader(true);
    try {
      await Parse.Cloud.run("senddeleterequest", {
        userId: Parse.User.current().id
      });
      setDeleteUserRes(t("account-deletion-request-sent-via-mail"));
    } catch (err) {
      setDeleteUserRes(err.message);
      console.error("Error deleting user account", err);
    } finally {
      setIsDelLoader(false);
    }
  };

  const handleCloseDeleteModal = () => {
    setIsdeleteModal(false);
    setDeleteUserRes("");
  };

  const displayName = editmode ? name : localStorage.getItem("username");
  const initials = getInitialsFromName(displayName);
  const hasProfileImage = Boolean(Image);
  const avatarImageSrc = previewUrl || (hasProfileImage ? Image : null);
  const userRole = localStorage.getItem("_user_role");

  return (
    <React.Fragment>
      {isLoader ? (
        <div className="h-[100vh] flex justify-center items-center">
          <Loader />
        </div>
      ) : (
        <div className="w-full max-w-3xl mx-auto py-4 px-2 md:px-0">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <ShieldCheck size={20} aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-base-content leading-tight">
                {t("profile")}
              </h1>
              <p className="text-xs text-base-content/60">
                {t("profile-subtitle")}
              </p>
            </div>
          </div>

          <div className="flex flex-col items-center gap-2 mb-6">
            <div className="relative w-28 h-28 md:w-32 md:h-32">
              <div className="w-full h-full rounded-full overflow-hidden ring-4 ring-base-200 bg-base-200">
                {avatarImageSrc ? (
                  <img
                    data-testid="profile-avatar-image"
                    className="object-cover w-full h-full"
                    src={avatarImageSrc}
                    alt={displayName || "avatar"}
                  />
                ) : initials ? (
                  <div
                    data-testid="profile-avatar-initials"
                    role="img"
                    aria-label={displayName || "avatar"}
                    className={`w-full h-full flex items-center justify-center text-2xl font-semibold ${getInitialsBadgeClass(displayName)}`}
                  >
                    {initials}
                  </div>
                ) : (
                  <img
                    data-testid="profile-avatar-image"
                    className="object-cover w-full h-full"
                    src={dp}
                    alt="avatar"
                  />
                )}
              </div>
              {editmode && (
                <>
                  <input
                    id="profile-avatar-input"
                    ref={avatarInputRef}
                    type="file"
                    className="hidden"
                    accept="image/png, image/gif, image/jpeg"
                    onChange={fileUpload}
                    data-testid="avatar-file-input"
                  />
                  <label
                    htmlFor="profile-avatar-input"
                    data-testid="avatar-camera-button"
                    aria-label={t("change-photo-help")}
                    title={t("change-photo-help")}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
                        e.preventDefault();
                        avatarInputRef.current?.click();
                      }
                    }}
                    className="absolute bottom-0 right-0 w-9 h-9 rounded-full op-btn op-btn-circle op-btn-primary op-btn-sm border-2 border-base-100 flex items-center justify-center cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                  >
                    <Camera size={16} aria-hidden="true" />
                  </label>
                </>
              )}
            </div>
            {percentage > 0 && (
              <div
                className="flex items-center gap-2 w-full max-w-[220px]"
                data-testid="avatar-upload-progress"
              >
                <progress
                  className="op-progress op-progress-primary w-full"
                  value={percentage}
                  max="100"
                  data-testid="avatar-progress-bar"
                ></progress>
                <span className="text-xs text-base-content/70 shrink-0">
                  {percentage}%
                </span>
              </div>
            )}
            {userRole && (
              <span
                className={`op-badge op-badge-sm mt-1 ${getRoleBadgeClass(userRole)}`}
                data-testid="header-role-badge"
              >
                {userRole}
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5">
            <PersonalInfoCard
              t={t}
              editmode={editmode}
              name={name}
              onNameChange={SetName}
              nameError={nameError}
              displayName={displayName}
              phone={Phone}
              onPhoneChange={SetPhone}
              phoneError={phoneError}
              savedPhone={storedUserInfo?.phone}
              email={storedUserInfo?.email}
              isEmailVerified={isEmailVerified}
              onVerifyEmail={handleVerifyBtn}
            />

            <ProfessionalInfoCard
              t={t}
              editmode={editmode}
              company={company}
              onCompanyChange={setCompany}
              displayCompany={extendUser?.[0]?.Company}
              jobTitle={jobTitle}
              onJobTitleChange={setJobTitle}
              displayJobTitle={extendUser?.[0]?.JobTitle}
              userRole={userRole}
              roleBadgeClass={getRoleBadgeClass(userRole)}
            />

            <PreferencesCard t={t} updateExtUser={updateExtUser} />

            <SecurityCard
              t={t}
              onChangePassword={() => navigate("/changepassword")}
              onDeleteAccount={handleDeleteAccountBtn}
            />
          </div>

          <div className="flex flex-col md:flex-row justify-start gap-2 mt-5">
            <button
              type="button"
              onClick={(e) => (editmode ? handleSubmit(e) : handleEnterEditMode())}
              className="op-btn op-btn-primary md:w-[140px]"
              data-testid="edit-save-button"
            >
              {editmode ? t("save") : t("edit")}
            </button>
            {editmode && (
              <button
                type="button"
                onClick={() => handleCancel()}
                className="op-btn op-btn-ghost md:w-[140px]"
                data-testid="cancel-button"
              >
                {t("cancel")}
              </button>
            )}
          </div>

          {isdeleteModal && (
            <ModalUi
              id="delete-account-modal"
              isOpen
              title={t("delete-account")}
              handleClose={handleCloseDeleteModal}
            >
              {isDelLoader ? (
                <div className="h-[100px] flex justify-center items-center">
                  <Loader />
                </div>
              ) : (
                <>
                  {deleteUserRes ? (
                    <div className="h-[100px] p-[20px] flex justify-center items-center text-base-content text-sm md:text-base">
                      {deleteUserRes}
                    </div>
                  ) : (
                    <form onSubmit={(e) => handleDeleteAccount(e)}>
                      <div className="px-6 py-3 text-base-content text-sm md:text-base">
                        {t("delete-account-que")}
                      </div>
                      <div className="px-6 mb-3 flex gap-2">
                        <button type="submit" className="op-btn op-btn-error">
                          {t("yes")}
                        </button>
                        <button
                          ref={deleteCancelBtnRef}
                          type="button"
                          className="op-btn op-btn-ghost"
                          onClick={handleCloseDeleteModal}
                        >
                          {t("cancel")}
                        </button>
                      </div>
                    </form>
                  )}
                </>
              )}
            </ModalUi>
          )}

          {isVerifyModal && (
            <ModalUi
              id="otp-verification-modal"
              isOpen
              title={t("otp-verification")}
              handleClose={handleCloseVerifyModal}
            >
              {otpLoader ? (
                <div className="h-[150px] flex justify-center items-center">
                  <Loader />
                </div>
              ) : (
                <form onSubmit={(e) => handleVerifyEmail(e)}>
                  <div className="px-6 py-3 text-base-content">
                    <label className="mb-2 text-sm font-medium block">
                      {t("enter-otp")}
                    </label>
                    <input
                      ref={otpInputRef}
                      onInvalid={(e) =>
                        e.target.setCustomValidity(t("input-required"))
                      }
                      onInput={(e) => e.target.setCustomValidity("")}
                      required
                      type="tel"
                      pattern="[0-9]{4}"
                      className="w-full op-input op-input-bordered op-input-sm hover:border-base-content text-xs"
                      placeholder={t("otp-placeholder")}
                      value={otp}
                      onChange={(e) => setOtp(e.target.value)}
                    />
                  </div>
                  <div className="px-6 mb-3 flex gap-2">
                    <button type="submit" className="op-btn op-btn-primary">
                      {t("verify")}
                    </button>
                    <button
                      type="button"
                      className="op-btn op-btn-secondary"
                      onClick={(e) => handleResend(e)}
                    >
                      {t("resend")}
                    </button>
                  </div>
                </form>
              )}
            </ModalUi>
          )}
        </div>
      )}
    </React.Fragment>
  );
}

export default UserProfile;
