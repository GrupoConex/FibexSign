import { useState, useEffect, useMemo } from "react";
import dp from "../assets/images/dp.png";
import FullScreenButton from "./FullScreenButton";
import ThemeToggle from "./ThemeToggle";
import Icon from "../primitives/Icon";
import logoPositivo from "../assets/images/logo.svg";
import logoNegativo from "../assets/images/Fibex-logo-negativo.svg";
import { useNavigate } from "react-router";
import Parse from "parse";
import { useWindowSize } from "../hook/useWindowSize";
import { getAppLogo, saveLanguageInLocal } from "../constant/Utils";
import { useTranslation } from "react-i18next";
import { appInfo } from "../constant/appinfo";
import { useDispatch } from "react-redux";
import { toggleSidebar } from "../redux/reducers/sidebarReducer";
import { sessionStatus } from "../redux/reducers/userReducer";

const Header = ({ isConsole, setIsLoggingOut }) => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { width } = useWindowSize();
  const dispatch = useDispatch();
  const username = localStorage.getItem("username") || "";
  const image = localStorage.getItem("profileImg") || dp;
  const [isOpen, setIsOpen] = useState(false);
  const [applogo, setAppLogo] = useState(
    () => localStorage.getItem("appLogo") || appInfo.applogo || logoPositivo
  );
  const [isDarkTheme, setIsDarkTheme] = useState(() => {
    if (typeof document !== "undefined") {
      return (
        document.documentElement.getAttribute("data-theme") === "opensigndark"
      );
    }
    return false;
  });

  const toggleDropdown = () => {
    setIsOpen(!isOpen);
    closeSidebar();
  };
  const closeSidebar = () => {
    if (width && width <= 768) {
      dispatch(toggleSidebar(false));
    }
  };

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

  //handle to close profile drop down menu onclick screen
  useEffect(() => {
    const closeMenuOnOutsideClick = (e) => {
      if (isOpen && !e.target.closest("#profile-menu")) {
        setIsOpen(false);
      }
    };

    document.addEventListener("click", closeMenuOnOutsideClick);

    return () => {
      // Cleanup the event listener when the component unmounts
      document.removeEventListener("click", closeMenuOnOutsideClick);
    };
  }, [isOpen]);


  useEffect(() => {
    const updateThemeStatus = () => {
      const isDarkTheme =
        document.documentElement.getAttribute("data-theme") === "opensigndark";
      setIsDarkTheme(isDarkTheme);
    };
    updateThemeStatus();

    const observer = new MutationObserver(() => {
      updateThemeStatus();
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"]
    });

    return () => observer.disconnect();
  }, []);

  const defaultLogo = isDarkTheme ? logoNegativo : logoPositivo;
  const currentLogo =
    applogo && applogo !== appInfo.applogo && applogo !== logoPositivo
      ? applogo
      : defaultLogo;

  return (
    <>
      <div className="op-navbar bg-base-100 shadow touch-none">
        <div className="flex-none">
          <button
            className="op-btn op-btn-square op-btn-ghost focus:outline-none hover:bg-transparent op-btn-sm no-animation"
            onClick={showSidebar}
            aria-label="Toggle Sidebar"
          >
            <Icon name="menu" size={22} className="text-base-content" />
          </button>
        </div>
        <div className="flex-1 ml-2">
          <div
            onClick={() => navigate("/dashboard/35KBoSgoAK")}
            className="h-[25px] md:h-[40px] w-auto overflow-hidden cursor-pointer flex items-center"
          >
            <img
              className="object-contain h-full w-auto max-h-[40px]"
              src={currentLogo}
              onError={(e) => {
                e.currentTarget.onerror = null;
                e.currentTarget.src = defaultLogo;
              }}
              alt="FibexSign logo"
            />
          </div>
        </div>
        <div id="profile-menu" className="flex-none gap-2">
          <div>
              <FullScreenButton />
          </div>
          {width >= 768 && (
            <div
              onClick={toggleDropdown}
              className="cursor-pointer w-[35px] h-[35px] rounded-full ring-[1px] ring-offset-2 ring-gray-400 overflow-hidden"
            >
              <img
                className="w-[35px] h-[35px] object-contain"
                src={image}
                alt="img"
              />
            </div>
          )}
          {width >= 768 && (
            <div
              onClick={toggleDropdown}
              role="button"
              tabIndex="0"
              className="cursor-pointer text-base-content text-sm"
            >
              {username && username}
            </div>
          )}
          <div
            className="op-dropdown op-dropdown-open op-dropdown-end"
            id="profile-menu"
          >
            <div
              tabIndex={0}
              role="button"
              onClick={toggleDropdown}
              className="op-btn op-btn-ghost op-btn-xs w-[10px] h-[20px] hover:bg-transparent flex items-center justify-center"
            >
              <Icon name="chevron-down" size={16} className="text-base-content" />
            </div>
            <ul
              tabIndex={0}
              className={`mt-4 z-[1] p-2 shadow op-dropdown-open op-menu op-menu-sm op-dropdown-content text-base-content bg-base-100 rounded-box w-56 ${
                isOpen ? "" : "hidden"
              }`}
            >
              {!isConsole && (
                <>
                  <li
                    onClick={() => {
                      setIsOpen(false);
                      navigate("/profile");
                    }}
                  >
                    <span className="flex items-center gap-2">
                      <Icon name="user" size={16} /> {t("profile")}
                    </span>
                  </li>
                    <li
                      onClick={() => {
                        setIsOpen(false);
                        navigate("/changepassword");
                      }}
                    >
                      <span className="flex items-center gap-2">
                        <Icon name="lock" size={16} /> {t("change-password")}
                      </span>
                    </li>
                  <li
                    onClick={() => {
                      setIsOpen(false);
                      navigate("/verify-document");
                    }}
                  >
                    <span className="flex items-center gap-2">
                      <Icon name="check-square" size={16} /> {t("verify-document")}
                    </span>
                  </li>
                  <li>
                    <span className="flex items-center gap-2">
                      <Icon name="moon" size={16} />
                      {t("dark-mode")}
                      <span className="text-[10px] font-semibold bg-base-300 text-base-content px-1 rounded-md">
                        BETA
                      </span>
                      <ThemeToggle />
                    </span>
                  </li>
                </>
              )}
              <li onClick={handleLogout}>
                <span className="flex items-center gap-2">
                  <Icon name="log-out" size={16} /> {t("log-out")}
                </span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </>
  );
};

export default Header;
