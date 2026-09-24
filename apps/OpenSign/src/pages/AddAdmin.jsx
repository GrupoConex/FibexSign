import { useEffect, useState } from "react";
import Parse from "parse";
import { appInfo } from "../constant/appinfo";
import { useNavigate } from "react-router";
import {
  getAppLogo,
  saveLanguageInLocal,
  usertimezone
} from "../constant/Utils";
import { useDispatch } from "react-redux";
import { showTenant } from "../redux/reducers/ShowTenant";
import Loader from "../primitives/Loader";
import { useTranslation } from "react-i18next";
import { emailRegex } from "../constant/const";
import { notify } from "../utils";
import AuthLayout from "../components/auth/AuthLayout";
import Icon from "../primitives/Icon";

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
  const [lengthValid, setLengthValid] = useState(false);
  const [caseDigitValid, setCaseDigitValid] = useState(false);
  const [specialCharValid, setSpecialCharValid] = useState(false);
  const [isAuthorize, setIsAuthorize] = useState(false);
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

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!emailRegex.test(email)) {
      notify.warning(t("valid-email-alert"));
    } else {
      if (lengthValid && caseDigitValid && specialCharValid) {
        clearStorage();
        setState({ loading: true });
        const userDetails = {
          name: name,
          email: email?.toLowerCase()?.replace(/\s/g, ""),
          phone: phone,
          company: company,
          jobTitle: jobTitle
        };
        localStorage.setItem("userDetails", JSON.stringify(userDetails));
        try {
          event.preventDefault();
          const params = {
            userDetails: {
              jobTitle: jobTitle,
              company: company,
              name: name,
              email: email?.toLowerCase()?.replace(/\s/g, ""),
              phone: phone,
              password: password,
              role: "contracts_Admin",
              timezone: usertimezone
            }
          };
          const usersignup = await Parse.Cloud.run("addadmin", params);
          if (usersignup?.sessionToken) {
            handleNavigation(usersignup.sessionToken);
          }
        } catch (error) {
          console.log("err ", error);
          if (error.code === 202) {
            const params = { email: email };
            const res = await Parse.Cloud.run("getUserDetails", params);
            // console.log("Res ", res);
            if (res?.exists) {
              notify.error(t("already-exists-this-username"));
              setState({ loading: false });
            } else {
              // console.log("state.email ", email);
              try {
                await Parse.User.requestPasswordReset(email).then(
                  async function (res) {
                    if (res.data === undefined) {
                      notify.success(t("verification-code-sent"));
                    }
                  }
                );
              } catch (err) {
                console.log(err);
              }
              setState({ loading: false });
            }
          } else {
            notify.error(error.message);
            setState({ loading: false });
          }
        }
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
  const handlePasswordChange = (e) => {
    const newPassword = e.target.value;
    setPassword(newPassword);
    // Check conditions separately
    setLengthValid(newPassword.length >= 8);
    setCaseDigitValid(
      /[a-z]/.test(newPassword) &&
        /[A-Z]/.test(newPassword) &&
        /\d/.test(newPassword)
    );
    setSpecialCharValid(/[!@#$%^&*()\-_=+{};:,<.>]/.test(newPassword));
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
              <form onSubmit={handleSubmit} className="space-y-5">
                <h1 className="text-2xl font-semibold text-base-content text-center">
                  {t("opensign-setup", { appName })}
                </h1>
                <div className="space-y-4 text-sm">
                  <div>
                    <label className="block text-xs mb-1 text-base-content" htmlFor="name">
                      {t("name")}{" "}
                      <span className="text-error text-xs">*</span>
                    </label>
                    <input
                      id="name"
                      type="text"
                      className="op-input op-input-bordered w-full text-sm"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      onInvalid={(e) =>
                        e.target.setCustomValidity(t("input-required"))
                      }
                      onInput={(e) => e.target.setCustomValidity("")}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs mb-1 text-base-content" htmlFor="email">
                      {t("email")}{" "}
                      <span className="text-error text-xs">*</span>
                    </label>
                    <input
                      id="email"
                      type="email"
                      className="op-input op-input-bordered w-full text-sm"
                      value={email}
                      onChange={(e) =>
                        setEmail(
                          e.target.value?.toLowerCase()?.replace(/\s/g, "")
                        )
                      }
                      onInvalid={(e) =>
                        e.target.setCustomValidity(t("input-required"))
                      }
                      onInput={(e) => e.target.setCustomValidity("")}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs mb-1 text-base-content" htmlFor="phone">
                      {t("phone")}{" "}
                      <span className="text-error text-xs">*</span>
                    </label>
                    <input
                      id="phone"
                      type="tel"
                      className="op-input op-input-bordered w-full text-sm"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      onInvalid={(e) =>
                        e.target.setCustomValidity(t("input-required"))
                      }
                      onInput={(e) => e.target.setCustomValidity("")}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs mb-1 text-base-content" htmlFor="company">
                      {t("company")}{" "}
                      <span className="text-error text-xs">*</span>
                    </label>
                    <input
                      id="company"
                      type="text"
                      className="op-input op-input-bordered w-full text-sm"
                      value={company}
                      onChange={(e) => setCompany(e.target.value)}
                      onInvalid={(e) =>
                        e.target.setCustomValidity(t("input-required"))
                      }
                      onInput={(e) => e.target.setCustomValidity("")}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs mb-1 text-base-content" htmlFor="jobTitle">
                      {t("job-title")}{" "}
                      <span className="text-error text-xs">*</span>
                    </label>
                    <input
                      id="jobTitle"
                      type="text"
                      className="op-input op-input-bordered w-full text-sm"
                      value={jobTitle}
                      onChange={(e) => setJobTitle(e.target.value)}
                      onInvalid={(e) =>
                        e.target.setCustomValidity(t("input-required"))
                      }
                      onInput={(e) => e.target.setCustomValidity("")}
                      required
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
                        className="op-input op-input-bordered w-full text-sm pr-9"
                        name="password"
                        value={password}
                        onChange={(e) => handlePasswordChange(e)}
                        onInvalid={(e) =>
                          e.target.setCustomValidity(t("input-required"))
                        }
                        onInput={(e) => e.target.setCustomValidity("")}
                        required
                      />
                      <button
                        type="button"
                        className="absolute top-1/2 right-3 -translate-y-1/2 cursor-pointer text-base-content/60 hover:text-base-content"
                        onClick={togglePasswordVisibility}
                        aria-label={
                          showPassword
                            ? t("hide-password")
                            : t("show-password")
                        }
                      >
                        <Icon
                          name={showPassword ? "eye-off" : "eye"}
                          size={16}
                        />
                      </button>
                    </div>
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
                  <div className="flex flex-row items-center">
                    <input
                      type="checkbox"
                      className="op-checkbox op-checkbox-sm"
                      id="termsandcondition"
                      checked={isAuthorize}
                      onChange={(e) => setIsAuthorize(e.target.checked)}
                      onInvalid={(e) =>
                        e.target.setCustomValidity(t("input-required"))
                      }
                      onInput={(e) => e.target.setCustomValidity("")}
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
                </div>
                <button
                  type="submit"
                  className="op-btn op-btn-primary w-full"
                  disabled={state.loading}
                >
                  {state.loading ? t("loading") : t("next")}
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
