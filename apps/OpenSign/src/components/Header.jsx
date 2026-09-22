import { useState, useEffect, useMemo, useRef } from "react";
import dp from "../assets/images/dp.png";
import FullScreenButton from "./FullScreenButton";
import ThemeToggle from "./ThemeToggle";
import Icon from "../primitives/Icon";
import logoPositivo from "../assets/images/Fibex-logo-positivo.svg";
import logoNegativo from "../assets/images/Fibex-logo-negativo.svg";
import { useNavigate } from "react-router";
import Parse from "parse";
import { useWindowSize } from "../hook/useWindowSize";
import { useIsDarkTheme } from "../hook/useIsDarkTheme";
import { getAppLogo, saveLanguageInLocal } from "../constant/Utils";
import { useTranslation } from "react-i18next";
import { appInfo } from "../constant/appinfo";
import { useDispatch, useSelector } from "react-redux";
import { toggleSidebar } from "../redux/reducers/sidebarReducer";
import { sessionStatus } from "../redux/reducers/userReducer";

const Header = ({ isConsole, setIsLoggingOut }) => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { width } = useWindowSize();
  const dispatch = useDispatch();
  const isSidebarOpen = useSelector((state) => state.sidebar.isOpen);
  const username = localStorage.getItem("username") || "";
  const hasCustomImg =
    Boolean(localStorage.getItem("profileImg")) &&
    localStorage.getItem("profileImg") !== dp;
  const image = localStorage.getItem("profileImg") || dp;
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);
  const [applogo, setAppLogo] = useState(
    () => localStorage.getItem("appLogo") || appInfo.applogo || logoPositivo
  );
  const isDarkTheme = useIsDarkTheme();

  const toggleDropdown = (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    setIsOpen((prev) => !prev);
    closeSidebar();
  };
  const closeSidebar = () => {
    if (width && width <= 768) {
      dispatch(toggleSidebar(false));
    }
  };

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
    };
  }, []);

  useEffect(() => {
    initializeHead();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    closeSidebar();
  }, [width]);

  const showSidebar = () => {
    dispatch(toggleSidebar());
  };

  async function initializeHead() {
    try {
      const tenantLogoData = await getAppLogo();
      if (tenantLogoData?.logo) {
        setAppLogo(tenantLogoData.logo);
        localStorage.setItem("appLogo", tenantLogoData.logo);
      } else {
        setAppLogo(logoPositivo);
        localStorage.setItem("appLogo", logoPositivo);
      }
    } catch (err) {
      console.log("Error fetching logo", err);
      setAppLogo(logoPositivo);
    }
  }
  const handleLogout = async () => {
    setIsOpen(false);
    setIsLoggingOut(true);
    try {
      await Parse.User.logOut();
    } catch (err) {
      console.log("Err while logging out", err);
    } finally {
      dispatch(sessionStatus(true));
    }
    let appdata = localStorage.getItem("userSettings");
    let applogo = localStorage.getItem("appLogo");
    let defaultmenuid = localStorage.getItem("defaultmenuid");
    let PageLanding = localStorage.getItem("PageLanding");
    let baseUrl = localStorage.getItem("baseUrl");
    let appid = localStorage.getItem("parseAppId");
    let favicon = localStorage.getItem("favicon");

    localStorage.clear();
    saveLanguageInLocal(i18n);
    localStorage.setItem("appLogo", applogo);
    localStorage.setItem("defaultmenuid", defaultmenuid);
    localStorage.setItem("PageLanding", PageLanding);
    localStorage.setItem("userSettings", appdata);
    localStorage.setItem("baseUrl", baseUrl);
    localStorage.setItem("parseAppId", appid);
    localStorage.setItem("favicon", favicon);
    setIsLoggingOut(false);
    navigate("/");
  };


  const defaultLogo = isDarkTheme ? logoNegativo : logoPositivo;
  const currentLogo =
    applogo && applogo !== appInfo.applogo && applogo !== logoPositivo
      ? applogo
      : defaultLogo;

  return (
    <>
      <div className="op-navbar bg-base-100 touch-none pl-0 pr-2 sm:pr-4 h-16 min-h-[4rem]">
        {/* LOGO + CONTENEDOR DE MARCA (ANCHO FIJO 256px + RAYA PERMANENTE + FLECHA SIEMPRE EN SU SITIO) */}
        <div className="header-brand-container relative flex items-center h-16 min-h-[4rem] w-64 border-r-active flex-shrink-0">
          <div
            onClick={() => navigate("/dashboard/35KBoSgoAK")}
            className="cursor-pointer flex items-center gap-3 transition-transform active:scale-95 pl-4 pr-3 select-none"
            title="Ir al Dashboard"
          >
            <img
              className="object-contain h-10 w-10 shrink-0"
              src={currentLogo}
              onError={(e) => {
                e.currentTarget.onerror = null;
                e.currentTarget.src = defaultLogo;
              }}
              alt="Firma logo"
            />
            <span className="font-bold text-2xl tracking-tight text-base-content whitespace-nowrap">
              <span className="firma-text">Firma</span>
            </span>
          </div>

          {/* Botón de flecha SIEMPRE fijo en el borde a 256px, sin moverse nunca */}
          <button
            type="button"
            className="sidebar-toggle-btn w-7 h-7 rounded-full flex items-center justify-center transition-all active:scale-90 focus:outline-none cursor-pointer z-50 absolute -right-3.5 top-1/2 -translate-y-1/2"
            onClick={showSidebar}
            aria-label={isSidebarOpen ? "Colapsar menú lateral" : "Expandir menú lateral"}
            title={isSidebarOpen ? "Colapsar menú lateral" : "Expandir menú lateral"}
          >
            <Icon
              name={isSidebarOpen ? "chevron-left" : "chevron-right"}
              size={14}
              className="text-current"
            />
          </button>
        </div>

        {/* ESPACIADOR CENTRAL */}
        <div className="flex-1"></div>

        <div className="flex items-center gap-3">
          <div>
            <FullScreenButton />
          </div>

          {/* Menú de Perfil de Usuario */}
          <div id="profile-menu" className="relative" ref={dropdownRef}>
            <button
              type="button"
              onClick={toggleDropdown}
              className="flex items-center gap-2.5 p-1 pl-1.5 pr-2.5 rounded-xl hover:bg-base-200/80 dark:hover:bg-white/10 transition-all duration-200 focus:outline-none cursor-pointer select-none"
              aria-label="Menú de usuario"
              aria-expanded={isOpen}
            >
              {/* Avatar Moderno: Imagen real o Ícono Lucide en badge con degradado */}
              {hasCustomImg ? (
                <img
                  className="w-9 h-9 rounded-full object-cover ring-2 ring-primary/25 shrink-0"
                  src={localStorage.getItem("profileImg")}
                  alt="Profile"
                />
              ) : (
                <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-[#1d4ed8] to-[#3b82f6] text-white flex items-center justify-center ring-2 ring-blue-400/25 shadow-sm shrink-0">
                  <Icon name="user" size={18} className="text-white" />
                </div>
              )}

              {width >= 768 && (
                <span className="text-sm font-semibold text-base-content max-w-[150px] truncate">
                  {username}
                </span>
              )}

              <Icon
                name="chevron-down"
                size={15}
                className={`text-gray-400 transition-transform duration-200 ${
                  isOpen ? "rotate-180 text-primary" : ""
                }`}
              />
            </button>

            {/* Menú Desplegable Mejorado, Espacioso y con Colores Adaptativos */}
            {isOpen && (
              <div className="user-profile-dropdown absolute right-0 top-full mt-2 w-72 rounded-2xl p-2 shadow-2xl z-[500]">
                {/* Encabezado del Menú con Info del Usuario (Borde inferior limpio, sin cortes de texto) */}
                <div className="px-3.5 pt-3 pb-2.5 mb-1.5 dropdown-user-header">
                  <div className="text-sm font-semibold dropdown-user-title leading-snug truncate">
                    {username || "Usuario"}
                  </div>
                  <div className="text-xs dropdown-user-subtitle mt-0.5 leading-snug truncate">
                    {localStorage.getItem("tenantName") || "Fibex Telecom"}
                  </div>
                </div>

                {!isConsole && (
                  <div className="space-y-1">
                    <button
                      type="button"
                      onClick={() => {
                        setIsOpen(false);
                        navigate("/profile");
                      }}
                      className="w-full flex items-center gap-3 px-3.5 py-2.5 text-sm dropdown-item rounded-xl transition-colors text-left cursor-pointer"
                    >
                      <Icon name="user" size={18} className="text-blue-500 shrink-0" />
                      <span className="font-medium">{t("profile")}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setIsOpen(false);
                        navigate("/changepassword");
                      }}
                      className="w-full flex items-center gap-3 px-3.5 py-2.5 text-sm dropdown-item rounded-xl transition-colors text-left cursor-pointer"
                    >
                      <Icon name="lock" size={18} className="text-indigo-500 shrink-0" />
                      <span className="font-medium">{t("change-password")}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setIsOpen(false);
                        navigate("/verify-document");
                      }}
                      className="w-full flex items-center gap-3 px-3.5 py-2.5 text-sm dropdown-item rounded-xl transition-colors text-left cursor-pointer"
                    >
                      <Icon name="check-square" size={18} className="text-emerald-500 shrink-0" />
                      <span className="font-medium">{t("verify-document")}</span>
                    </button>

                    {/* Fila de Modo Oscuro con Toggle Perfectamente Alineado en una sola fila (SIN BETA) */}
                    <div className="flex items-center justify-between px-3.5 py-2 text-sm dropdown-item rounded-xl transition-colors select-none">
                      <div className="flex items-center gap-3 min-w-0">
                        <Icon name="moon" size={18} className="text-purple-500 shrink-0" />
                        <span className="font-medium truncate">{t("dark-mode")}</span>
                      </div>
                      <div className="shrink-0 ml-2 flex items-center">
                        <ThemeToggle />
                      </div>
                    </div>
                  </div>
                )}

                {/* Separador */}
                <div className="my-1.5 dropdown-divider"></div>

                {/* Cerrar Sesión */}
                <button
                  type="button"
                  onClick={() => {
                    setIsOpen(false);
                    handleLogout();
                  }}
                  className="w-full flex items-center gap-3 px-3.5 py-2.5 text-sm text-error hover:bg-error/10 rounded-xl transition-colors text-left cursor-pointer font-medium"
                >
                  <Icon name="log-out" size={18} className="shrink-0" />
                  <span>{t("log-out")}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

export default Header;
