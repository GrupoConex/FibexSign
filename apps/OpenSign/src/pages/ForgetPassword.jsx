import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import Parse from "parse";
import { appInfo } from "../constant/appinfo";
import { useDispatch } from "react-redux";
import { fetchAppInfo } from "../redux/reducers/infoReducer";
import {
  applyFieldError,
  hasErrors,
  validateForgotPasswordForm
} from "../utils/authFormValidation";
import FieldError from "../components/auth/FieldError";
import { useTranslation } from "react-i18next";
import Loader from "../primitives/Loader";
import Icon from "../primitives/Icon";
import { notify } from "../utils";
import AuthLayout from "../components/auth/AuthLayout";
import SelectLanguage from "../components/pdf/SelectLanguage";
import { useIsDarkTheme } from "../hook/useIsDarkTheme";
import logoPositivo from "../assets/images/Fibex-logo-positivo.svg";
import logoNegativo from "../assets/images/Fibex-logo-negativo.svg";

function ForgotPassword() {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const [state, setState] = useState({ email: "", password: "" });
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState({});
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [image, setImage] = useState();
  const isDarkTheme = useIsDarkTheme();
  const defaultLogo = isDarkTheme ? logoNegativo : logoPositivo;
  const currentLogo =
    image && image !== appInfo.applogo ? image : defaultLogo;

  const handleChange = (event) => {
    let { name, value } = event.target;
    if (name === "email") {
      value = value?.toLowerCase()?.replace(/\s/g, "");
    }
    setState({ ...state, [name]: value });
    if (errors[name]) {
      revalidateField(name, value);
    }
  };

  const revalidateField = (name, value) => {
    const validation = validateForgotPasswordForm({ ...state, [name]: value });
    setErrors((prev) => applyFieldError(prev, name, validation));
  };

  const handleBlur = (event) => {
    if (!hasSubmitted) return;
    const { name, value } = event.target;
    revalidateField(name, value);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const validation = validateForgotPasswordForm(state);
    setHasSubmitted(true);
    setErrors(validation);
    if (hasErrors(validation)) {
      document.getElementById("email")?.focus();
    } else {
      setIsLoading(true);
      localStorage.setItem("appLogo", appInfo.applogo);
      localStorage.setItem("userSettings", JSON.stringify(appInfo.settings));
      if (state.email) {
        const username = state.email;
        try {
            await Parse.User.requestPasswordReset(username);
          notify.success(t("reset-password-alert-1"));
        } catch (err) {
          console.log("err ", err.code);
          notify.error(err.message || t("reset-password-alert-2"));
        } finally {
          setIsLoading(false);
        }
      }
    }
  };

  useEffect(() => {
    dispatch(fetchAppInfo());
    saveLogo();
    // eslint-disable-next-line
  }, []);
  const saveLogo = async () => {
    try {
      await Parse.User.logOut();
    } catch (err) {
      console.log("err while logging out ", err);
    }
      setImage(appInfo?.applogo || undefined);
  };
  return (
    <>
      {isLoading && (
        <div
          role="status"
          aria-live="assertive"
          className="fixed w-full h-full flex justify-center items-center bg-black bg-opacity-30 z-50"
        >
          <Loader />
          <span className="sr-only">{t("loading")}</span>
        </div>
      )}
      <AuthLayout>
        {image && (
          <img
            src={currentLogo}
            className="h-10 max-w-[200px] object-contain mb-8"
            alt="applogo"
          />
        )}
        <form onSubmit={handleSubmit} noValidate className="space-y-5">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-base-content">
              {t("reset-password-heading")}
            </h1>
            <p className="text-sm text-base-content/80 font-medium mt-1">
              {t("reset-password-subheading", t("reset-password-alert-3"))}
            </p>
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1 text-base-content" htmlFor="email">
              {t("email")}
            </label>
            <input
              id="email"
              type="email"
              name="email"
              className={`op-input op-input-bordered w-full text-sm${errors.email ? " op-input-error" : ""}`}
              value={state.email}
              onChange={handleChange}
              onBlur={handleBlur}
              aria-invalid={Boolean(errors.email)}
              aria-describedby={errors.email ? "email-error" : undefined}
              required
            />
            <FieldError
              id="email-error"
              message={errors.email && t(errors.email)}
            />
          </div>
          <div className="space-y-3 pt-1">
            <button
              type="submit"
              className="op-btn op-btn-primary w-full"
              disabled={isLoading}
            >
              {isLoading ? t("loading") : t("submit")}
            </button>
            <div className="text-center pt-1">
              <button
                type="button"
                onClick={() => navigate("/", { replace: true })}
                className="inline-flex items-center justify-center gap-2 text-sm font-semibold text-base-content/75 hover:text-royal-600 dark:hover:text-blue-400 transition-colors cursor-pointer group py-1"
              >
                <Icon
                  name="arrow-left"
                  size={16}
                  className="transition-transform group-hover:-translate-x-1"
                />
                <span>{t("back-to-login")}</span>
              </button>
            </div>
          </div>
        </form>
        <div className="mt-8 pt-6 border-t border-base-200/80 flex justify-center">
          <SelectLanguage />
        </div>
      </AuthLayout>
    </>
  );
}

export default ForgotPassword;
