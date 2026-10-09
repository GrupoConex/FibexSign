import { useEffect, useState } from "react";
import Parse from "parse";
import { appInfo } from "../constant/appinfo";
import { useNavigate } from "react-router";
import {
  getAppLogo,
  handleSendOTP,
  saveLanguageInLocal,
  usertimezone
} from "../constant/Utils";
import { useDispatch } from "react-redux";
import { showTenant } from "../redux/reducers/ShowTenant";
import Loader from "../primitives/Loader";
import { useTranslation } from "react-i18next";
import {
  applyFieldError,
  getFirstInvalidFieldId,
  getPasswordRuleStatus,
  hasErrors,
  validateAddAdminForm
} from "../utils/authFormValidation";
import FieldError from "../components/auth/FieldError";
import { notify } from "../utils";
import AuthLayout from "../components/auth/AuthLayout";
import Icon from "../primitives/Icon";
import OtpCodeField from "../components/auth/OtpCodeField";
import OtpResendButton from "../components/auth/OtpResendButton";
import { useOtpResendCooldown } from "../hook/useOtpResendCooldown";
import {
  isOtpFormatValid,
  isOtpInvalidError,
  isOtpResendLimitError
} from "../utils/otpPolicy";

const ADMIN_FIELD_IDS = {
  name: "name",
  email: "email",
  phone: "phone",
  company: "company",
  jobTitle: "jobTitle",
  password: "admin-password",
  isAuthorize: "termsandcondition"
};

const AddAdmin = () => {
  const appName = appInfo.appName;
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const [showPassword, setShowPassword] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [isAuthorize, setIsAuthorize] = useState(false);
  const [errors, setErrors] = useState({});
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [isOtpSent, setIsOtpSent] = useState(false);
  const [otpNoticeKey, setOtpNoticeKey] = useState("");
  const [otp, setOtp] = useState("");
  const [otpErrorKey, setOtpErrorKey] = useState("");
  const { lengthValid, caseDigitValid, specialCharValid } =
    getPasswordRuleStatus(password);
  const [errMsg, setErrMsg] = useState("");
  const [state, setState] = useState({
    loading: false
  });
  const togglePasswordVisibility = () => setShowPassword(!showPassword);

  useEffect(() => {
    checkUserExist();
    // eslint-disable-next-line
  }, []);
  const checkUserExist = async () => {
    setState((prev) => ({ ...prev, loading: true }));
    try {
      const app = await getAppLogo();
      if (app?.error === "invalid_json") {
        setErrMsg(t("server-down", { appName: appName }));
      } else if (app?.user === "exist") {
        setErrMsg(t("admin-exists"));
      }
    } catch (err) {
      setErrMsg(t("something-went-wrong-mssg"));
      console.log("err in check user exist", err);
    } finally {
      setState((prev) => ({ ...prev, loading: false }));
    }
  };
  const clearStorage = async () => {
    try {
      await Parse.User.logOut();
    } catch (err) {
      console.log("Err while logging out", err);
    }
    const baseUrl = localStorage.getItem("baseUrl");
    const appid = localStorage.getItem("parseAppId");
    const applogo = localStorage.getItem("appLogo");
    const defaultmenuid = localStorage.getItem("defaultmenuid");
    const PageLanding = localStorage.getItem("PageLanding");
    const userSettings = localStorage.getItem("userSettings");
    const favicon = localStorage.getItem("favicon");

    localStorage.clear();
    saveLanguageInLocal(i18n);
    localStorage.setItem("baseUrl", baseUrl);
    localStorage.setItem("parseAppId", appid);
    localStorage.setItem("appLogo", applogo);
    localStorage.setItem("defaultmenuid", defaultmenuid);
    localStorage.setItem("PageLanding", PageLanding);
    localStorage.setItem("userSettings", userSettings);
    localStorage.setItem("baseUrl", baseUrl);
    localStorage.setItem("parseAppId", appid);
    localStorage.setItem("favicon", favicon);
  };

  const formValues = {
    name,
    email,
    phone,
    company,
    jobTitle,
    password,
    isAuthorize
  };

  const revalidateField = (field, overrides) => {
    const validation = validateAddAdminForm({ ...formValues, ...overrides });
    setErrors((prev) => applyFieldError(prev, field, validation));
  };

  const updateField = (field, setter, value) => {
    setter(value);
    if (errors[field]) {
      revalidateField(field, { [field]: value });
    }
  };

  const validateOnBlur = (field) => () => {
    if (hasSubmitted) revalidateField(field, {});
  };

  const resetOtpStep = () => {
    resetOtpCooldown();
    setOtpNoticeKey("");
    setIsOtpSent(false);
    setOtp("");
    setOtpErrorKey("");
  };

  const handleEmailChange = (value) => {
    if (isOtpSent) resetOtpStep();
    else resetOtpCooldown();
    updateField("email", setEmail, value);
  };

  const deliverOtp = async ({ isStale }) => {
    setOtpNoticeKey("");
    try {
      const isSent = await handleSendOTP(email);
      if (isStale()) return false;
      if (isSent) {
        setOtp("");
        setOtpErrorKey("");
        setIsOtpSent(true);
        setOtpNoticeKey(
          isOtpSent ? "otp-resent-to-email" : "otp-sent-to-email"
        );
      }
      return isSent;
    } catch (error) {
      if (!isStale()) notify.error(t("something-went-wrong-mssg"));
      return false;
    }
  };

  const {
    send: sendVerificationCode,
    reset: resetOtpCooldown,
    isSending: isSendingOtp,
    isResendDisabled,
    secondsLeft: resendSecondsLeft
  } = useOtpResendCooldown(deliverOtp);

  const handleOtpChange = (value) => {
    setOtp(value);
    if (otpErrorKey) setOtpErrorKey("");
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const validation = validateAddAdminForm(formValues);
    setHasSubmitted(true);
    setErrors(validation);
    if (hasErrors(validation)) {
      const firstInvalidId = getFirstInvalidFieldId(
        validation,
        ADMIN_FIELD_IDS
      );
      document.getElementById(firstInvalidId)?.focus();
      return;
    }
    if (!isOtpSent) {
      await sendVerificationCode();
      return;
    }
    if (!isOtpFormatValid(otp)) {
      setOtpErrorKey(
        otp ? "verification-code-invalid" : "verification-code-required"
      );
      document.getElementById("otp")?.focus();
      return;
    }
    await registerAdmin();
  };

  const handleExistingUser = async () => {
    const params = { email: email };
    const res = await Parse.Cloud.run("getUserDetails", params);
    if (res?.exists) {
      notify.error(t("already-exists-this-username"));
      setState({ loading: false });
      return;
    }
    try {
      await Parse.User.requestPasswordReset(email).then(async function (res) {
        if (res.data === undefined) {
          notify.success(t("verification-code-sent"));
        }
      });
    } catch (err) {
      console.log(err);
    }
    setState({ loading: false });
  };

  const registerAdmin = async () => {
    await clearStorage();
    setState({ loading: true });
    const normalizedEmail = email?.toLowerCase()?.replace(/\s/g, "");
    const userDetails = {
      name: name,
      email: normalizedEmail,
      phone: phone,
      company: company,
      jobTitle: jobTitle
    };
    localStorage.setItem("userDetails", JSON.stringify(userDetails));
    try {
      const params = {
        userDetails: {
          jobTitle: jobTitle,
          company: company,
          name: name,
          email: normalizedEmail,
          phone: phone,
          password: password,
          role: "contracts_Admin",
          timezone: usertimezone
        },
        otp
      };
      const usersignup = await Parse.Cloud.run("addadmin", params);
      if (usersignup?.sessionToken) {
        handleNavigation(usersignup.sessionToken);
      }
    } catch (error) {
      console.log("err ", error);
      if (error.code === 202) {
        await handleExistingUser();
      } else if (isOtpInvalidError(error)) {
        setOtpErrorKey("verification-code-invalid");
        setState({ loading: false });
      } else if (isOtpResendLimitError(error)) {
        setOtpErrorKey("otp-too-many-attempts");
        setState({ loading: false });
      } else {
        notify.error(error.message);
        setState({ loading: false });
      }
    }
  };
  const handleNavigation = async (sessionToken) => {
    const res = await Parse.User.become(sessionToken);
    if (res) {
      const _user = JSON.parse(JSON.stringify(res));
      // console.log("_user ", _user);
      localStorage.setItem("accesstoken", sessionToken);
      localStorage.setItem("UserInformation", JSON.stringify(_user));
      localStorage.setItem("accesstoken", _user.sessionToken);
      if (_user.ProfilePic) {
        localStorage.setItem("profileImg", _user.ProfilePic);
      } else {
        localStorage.setItem("profileImg", "");
      }
      // Check extended class user role and tenentId
      try {
        const userSettings = appInfo.settings;
        const extUser = await Parse.Cloud.run("getUserDetails");
        if (extUser) {
          const IsDisabled = extUser?.get("IsDisabled") || false;
          if (!IsDisabled) {
            const userRole = extUser?.get("UserRole");
            const menu =
              userRole && userSettings.find((menu) => menu.role === userRole);
            if (menu) {
              const _currentRole = userRole;
              const _role = _currentRole.replace("contracts_", "");
              localStorage.setItem("_user_role", _role);
              const extInfo_stringify = JSON.stringify([extUser]);
              localStorage.setItem("Extand_Class", extInfo_stringify);
              const extInfo = JSON.parse(JSON.stringify(extUser));
              localStorage.setItem("userEmail", extInfo?.Email);
              localStorage.setItem("username", extInfo?.Name);
              if (extInfo?.TenantId) {
                const tenant = {
                  Id: extInfo?.TenantId?.objectId || "",
                  Name: extInfo?.TenantId?.TenantName || ""
                };
                localStorage.setItem("TenantId", tenant?.Id);
                dispatch(showTenant(tenant?.Name));
                localStorage.setItem("TenantName", tenant?.Name);
              }
              localStorage.setItem("PageLanding", menu.pageId);
              localStorage.setItem("defaultmenuid", menu.menuId);
              localStorage.setItem("pageType", menu.pageType);
              notify.success(t("registered-user-successfully"));
              setState({ loading: false });
              navigate(`/${menu.pageType}/${menu.pageId}`);
            } else {
              notify.error(t("role-not-found"));
              setState({ loading: false });
            }
          } else {
            notify.error(t("do-not-access"));
            setState({ loading: false });
          }
        }
      } catch (error) {
        console.log("error in fetch extuser", error);
        const msg = error.message || t("something-went-wrong-mssg");
        notify.error(msg);
        setState({ loading: false });
      }
    }
  };
  return (
    <div className="min-h-screen flex justify-center">
      {state.loading ? (
        <div
          role="status"
          aria-live="assertive"
          className="flex justify-center items-center text-base-content/60 text-lg md:text-2xl"
        >
          <Loader />
          <span className="sr-only">{t("loading")}</span>
        </div>
      ) : (
        <>
          {errMsg ? (
            <div className="flex justify-center items-center text-base-content/60 text-lg md:text-2xl">
              {errMsg}
            </div>
          ) : (
            <AuthLayout>
              <form onSubmit={handleSubmit} noValidate className="space-y-5">
                <h1 className="text-2xl font-semibold text-base-content text-center">
                  {t("opensign-setup", { appName })}
                </h1>
                <div className="space-y-4 text-sm">
                  <div>
                    <label
                      className="block text-xs mb-1 text-base-content"
                      htmlFor="name"
                    >
                      {t("name")} <span className="text-error text-xs">*</span>
                    </label>
                    <input
                      id="name"
                      type="text"
                      className={`op-input op-input-bordered w-full text-sm${errors.name ? " op-input-error" : ""}`}
                      value={name}
                      onChange={(e) =>
                        updateField("name", setName, e.target.value)
                      }
                      onBlur={validateOnBlur("name")}
                      aria-invalid={Boolean(errors.name)}
                      aria-describedby={errors.name ? "name-error" : undefined}
                      required
                    />
                    <FieldError
                      id="name-error"
                      message={errors.name && t(errors.name)}
                    />
                  </div>
                  <div>
                    <label
                      className="block text-xs mb-1 text-base-content"
                      htmlFor="email"
                    >
                      {t("email")} <span className="text-error text-xs">*</span>
                    </label>
                    <input
                      id="email"
                      type="email"
                      className={`op-input op-input-bordered w-full text-sm${errors.email ? " op-input-error" : ""}`}
                      value={email}
                      onChange={(e) =>
                        handleEmailChange(
                          e.target.value?.toLowerCase()?.replace(/\s/g, "")
                        )
                      }
                      onBlur={validateOnBlur("email")}
                      aria-invalid={Boolean(errors.email)}
                      aria-describedby={
                        errors.email ? "email-error" : undefined
                      }
                      required
                    />
                    <FieldError
                      id="email-error"
                      message={errors.email && t(errors.email)}
                    />
                  </div>
                  <div>
                    <label
                      className="block text-xs mb-1 text-base-content"
                      htmlFor="phone"
                    >
                      {t("phone")} <span className="text-error text-xs">*</span>
                    </label>
                    <input
                      id="phone"
                      type="tel"
                      className={`op-input op-input-bordered w-full text-sm${errors.phone ? " op-input-error" : ""}`}
                      value={phone}
                      onChange={(e) =>
                        updateField("phone", setPhone, e.target.value)
                      }
                      onBlur={validateOnBlur("phone")}
                      aria-invalid={Boolean(errors.phone)}
                      aria-describedby={
                        errors.phone ? "phone-error" : undefined
                      }
                      required
                    />
                    <FieldError
                      id="phone-error"
                      message={errors.phone && t(errors.phone)}
                    />
                  </div>
                  <div>
                    <label
                      className="block text-xs mb-1 text-base-content"
                      htmlFor="company"
                    >
                      {t("company")}{" "}
                      <span className="text-error text-xs">*</span>
                    </label>
                    <input
                      id="company"
                      type="text"
                      className={`op-input op-input-bordered w-full text-sm${errors.company ? " op-input-error" : ""}`}
                      value={company}
                      onChange={(e) =>
                        updateField("company", setCompany, e.target.value)
                      }
                      onBlur={validateOnBlur("company")}
                      aria-invalid={Boolean(errors.company)}
                      aria-describedby={
                        errors.company ? "company-error" : undefined
                      }
                      required
                    />
                    <FieldError
                      id="company-error"
                      message={errors.company && t(errors.company)}
                    />
                  </div>
                  <div>
                    <label
                      className="block text-xs mb-1 text-base-content"
                      htmlFor="jobTitle"
                    >
                      {t("job-title")}{" "}
                      <span className="text-error text-xs">*</span>
                    </label>
                    <input
                      id="jobTitle"
                      type="text"
                      className={`op-input op-input-bordered w-full text-sm${errors.jobTitle ? " op-input-error" : ""}`}
                      value={jobTitle}
                      onChange={(e) =>
                        updateField("jobTitle", setJobTitle, e.target.value)
                      }
                      onBlur={validateOnBlur("jobTitle")}
                      aria-invalid={Boolean(errors.jobTitle)}
                      aria-describedby={
                        errors.jobTitle ? "jobTitle-error" : undefined
                      }
                      required
                    />
                    <FieldError
                      id="jobTitle-error"
                      message={errors.jobTitle && t(errors.jobTitle)}
                    />
                  </div>
                  <div>
                    <label
                      className="block text-xs mb-1 text-base-content"
                      htmlFor="admin-password"
                    >
                      {t("password")}{" "}
                      <span className="text-error text-xs">*</span>
                    </label>
                    <div className="relative">
                      <input
                        id="admin-password"
                        type={showPassword ? "text" : "password"}
                        className={`op-input op-input-bordered w-full text-sm pr-9${errors.password ? " op-input-error" : ""}`}
                        name="password"
                        value={password}
                        onChange={(e) =>
                          updateField("password", setPassword, e.target.value)
                        }
                        onBlur={validateOnBlur("password")}
                        aria-invalid={Boolean(errors.password)}
                        aria-describedby={
                          errors.password ? "password-error" : undefined
                        }
                        required
                      />
                      <button
                        type="button"
                        className="absolute top-1/2 right-3 -translate-y-1/2 cursor-pointer text-base-content/60 hover:text-base-content"
                        onClick={togglePasswordVisibility}
                        aria-label={
                          showPassword ? t("hide-password") : t("show-password")
                        }
                      >
                        <Icon
                          name={showPassword ? "eye-off" : "eye"}
                          size={16}
                        />
                      </button>
                    </div>
                    <FieldError
                      id="password-error"
                      message={errors.password && t(errors.password)}
                    />
                    {password.length > 0 && (
                      <div className="mt-1.5 text-xs space-y-0.5">
                        <p
                          className={
                            lengthValid
                              ? "text-success-scale-700 opensigndark:text-success"
                              : "text-error-scale-700 opensigndark:text-error"
                          }
                        >
                          {lengthValid ? "✓" : "✗"} {t("password-length")}
                        </p>
                        <p
                          className={
                            caseDigitValid
                              ? "text-success-scale-700 opensigndark:text-success"
                              : "text-error-scale-700 opensigndark:text-error"
                          }
                        >
                          {caseDigitValid ? "✓" : "✗"} {t("password-case")}
                        </p>
                        <p
                          className={
                            specialCharValid
                              ? "text-success-scale-700 opensigndark:text-success"
                              : "text-error-scale-700 opensigndark:text-error"
                          }
                        >
                          {specialCharValid ? "✓" : "✗"}{" "}
                          {t("password-special-char")}
                        </p>
                      </div>
                    )}
                  </div>
                  <div>
                    <div className="flex flex-row items-center">
                      <input
                        type="checkbox"
                        className="op-checkbox op-checkbox-sm"
                        id="termsandcondition"
                        checked={isAuthorize}
                        onChange={(e) =>
                          updateField(
                            "isAuthorize",
                            setIsAuthorize,
                            e.target.checked
                          )
                        }
                        onBlur={validateOnBlur("isAuthorize")}
                        aria-invalid={Boolean(errors.isAuthorize)}
                        aria-describedby={
                          errors.isAuthorize
                            ? "termsandcondition-error"
                            : undefined
                        }
                        required
                      />
                      <label
                        className="text-xs cursor-pointer ml-2 mb-0"
                        htmlFor="termsandcondition"
                      >
                        {t("agree")}
                      </label>
                      <span className="ml-1 text-xs text-base-content/80 font-medium">
                        {t("term")}
                      </span>
                      <span className="text-xs">.</span>
                    </div>
                    <FieldError
                      id="termsandcondition-error"
                      message={errors.isAuthorize && t(errors.isAuthorize)}
                    />
                  </div>
                  <p
                    role="status"
                    aria-live="polite"
                    className="text-xs text-base-content/80 empty:sr-only"
                  >
                    {otpNoticeKey ? t(otpNoticeKey, { email }) : null}
                  </p>
                  {isOtpSent && (
                    <div className="space-y-2">
                      <OtpCodeField
                        value={otp}
                        onChange={handleOtpChange}
                        errorKey={otpErrorKey}
                        autoFocus
                      />
                      <OtpResendButton
                        className="op-btn op-btn-ghost op-btn-sm"
                        onClick={sendVerificationCode}
                        isDisabled={isResendDisabled}
                        isSending={isSendingOtp}
                        secondsLeft={resendSecondsLeft}
                        returnFocusTo={() => document.getElementById("otp")}
                      />
                    </div>
                  )}
                </div>
                <button
                  type="submit"
                  className="op-btn op-btn-primary w-full"
                  disabled={state.loading || isSendingOtp}
                >
                  {state.loading || isSendingOtp
                    ? t("loading")
                    : t(isOtpSent ? "next" : "send-verification-code")}
                </button>
              </form>
            </AuthLayout>
          )}
        </>
      )}
    </div>
  );
};

export default AddAdmin;
