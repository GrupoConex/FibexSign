import { useState, useEffect } from "react";
import Menu from "./Menu";
import Submenu from "./SubMenu";
import dp from "../../assets/images/dp.png";
import logoPositivo from "../../assets/images/Fibex-logo-positivo.svg";
import logoNegativo from "../../assets/images/Fibex-logo-negativo.svg";
import sidebarList, { subSetting } from "../../json/menuJson";
import { useLocation, useNavigate } from "react-router";
import { useDispatch, useSelector } from "react-redux";
import { useWindowSize } from "../../hook/useWindowSize";
import { appInfo } from "../../constant/appinfo";
import { getAppLogo } from "../../constant/Utils";
import Icon from "../../primitives/Icon";
import {
  setSelectedMenu,
  toggleSidebar
} from "../../redux/reducers/sidebarReducer";

const Sidebar = () => {
  const { width } = useWindowSize();
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useDispatch();
  const isOpen = useSelector((state) => state.sidebar.isOpen);
  const [menuList, setmenuList] = useState([]);
  const [submenuOpen, setSubmenuOpen] = useState({});
  const username = localStorage.getItem("username") || "Usuario";
  const userProfileImg = localStorage.getItem("profileImg");
  const hasCustomImg =
    Boolean(userProfileImg) &&
    userProfileImg !== "dp" &&
    userProfileImg !== dp;
  const tenantname = localStorage.getItem("Extand_Class")
    ? JSON.parse(localStorage.getItem("Extand_Class"))?.[0]?.Company
    : "";

  const [isDarkTheme, setIsDarkTheme] = useState(() => {
    if (typeof document !== "undefined") {
      return (
        document.documentElement.getAttribute("data-theme") === "opensigndark"
      );
    }
    return false;
  });

  const [applogo, setAppLogo] = useState(
    () => localStorage.getItem("appLogo") || appInfo.applogo || logoPositivo
  );

  useEffect(() => {
    const updateThemeStatus = () => {
      const isDark =
        document.documentElement.getAttribute("data-theme") === "opensigndark";
      setIsDarkTheme(isDark);
    };
    updateThemeStatus();

    const observer = new MutationObserver(updateThemeStatus);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"]
    });

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    async function loadLogo() {
      try {
        const tenantLogoData = await getAppLogo();
        if (tenantLogoData?.logo) {
          setAppLogo(tenantLogoData.logo);
        }
      } catch (err) {
        console.error("Error loading logo in sidebar", err);
      }
    }
    loadLogo();
  }, []);

  useEffect(() => {
    if (localStorage.getItem("accesstoken")) {
      menuItem();
    }
  }, []);

  // Mantener abierto el submenú si la ruta actual corresponde a una de sus opciones hijas
  useEffect(() => {
    if (!menuList || menuList.length === 0) return;
    const currentPath = location.pathname;
    menuList.forEach((item) => {
      if (item.children) {
        const hasActiveChild = item.children.some((child) => {
          const path = child.pageType
            ? `/${child.pageType}/${child.objectId}`
            : `/${child.objectId}`;
          return currentPath === path || currentPath.startsWith(path + "/");
        });
        if (hasActiveChild) {
          setSubmenuOpen((prev) => ({
            ...(typeof prev === "object" && prev ? prev : {}),
            [item.title]: true
          }));
        }
      }
    });
  }, [location.pathname, menuList]);

  const closeSidebar = () => {
    dispatch(setSelectedMenu(true));
    if (width <= 1023) {
      dispatch(toggleSidebar(false));
    }
  };

  const menuItem = async () => {
    try {
      if (localStorage.getItem("defaultmenuid")) {
        const Extand_Class = localStorage.getItem("Extand_Class");
        const extClass = Extand_Class && JSON.parse(Extand_Class);
        const userRole = extClass?.[0]?.UserRole || "contracts_User";
        const isAdmin =
          userRole === "contracts_Admin" || userRole === "contracts_OrgAdmin";
        const newSidebarList = sidebarList.map((item) => {
          if (item.title !== "Settings") return item;
          const newItem = { ...item };
          const baseChildren = isAdmin ? subSetting : subSetting?.slice(0, 1);
          const mysignature = newItem.children.slice(0, 1);
          newItem.children = [...mysignature, ...baseChildren];
          return newItem;
        });
        setmenuList(newSidebarList);
      }
    } catch (e) {
      console.error("Problem loading sidebar menu", e);
    }
  };

  const toggleSubmenu = (title) => {
    setSubmenuOpen((prev) => ({
      ...(typeof prev === "object" && prev ? prev : {}),
      [title]: !prev?.[title]
    }));
  };

  const handleMenuItem = () => {
    dispatch(setSelectedMenu(true));
    closeSidebar();
    setSubmenuOpen({});
  };

  const handleProfile = () => {
    closeSidebar();
    navigate("/profile");
  };

  const defaultLogo = isDarkTheme ? logoNegativo : logoPositivo;
  const currentLogo =
    applogo && applogo !== appInfo.applogo && applogo !== logoPositivo
      ? applogo
      : defaultLogo;

  const isMobile = width <= 1023;

  return (
    <>
      {/* TELÓN / BACKDROP EN PANTALLAS MÓVILES */}
      {isMobile && isOpen && (
        <div
          onClick={() => dispatch(toggleSidebar(false))}
          className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[990] transition-opacity duration-300"
          aria-hidden="true"
        />
      )}

      {/* ASIDE LIQUID GLASS */}
      <aside
        className={`liquid-glass-sidebar z-[350] flex flex-col hide-scrollbar ${
          isMobile
            ? `fixed inset-y-0 left-0 w-[85%] max-w-[280px] h-full shadow-2xl z-[1000] transition-transform duration-300 ease-out ${
                isOpen ? "translate-x-0" : "-translate-x-full pointer-events-none"
              }`
            : `relative h-full flex-shrink-0 transition-all duration-300 ease-in-out ${
                isOpen ? "w-64" : "w-0 overflow-hidden border-0 p-0 shadow-none opacity-0 pointer-events-none"
              }`
        }`}
      >
        {/* EN MOBILE: CABECERA CON BOTÓN CERRAR */}
        {isMobile && (
          <div className="h-16 min-h-[4rem] px-4 flex items-center justify-between flex-shrink-0 border-b border-base-200/80 dark:border-slate-800/80">
            <div className="flex items-center gap-3">
              <img
                className="object-contain h-9 w-9"
                src={currentLogo}
                alt="Fibex logo"
              />
              <span className="font-bold text-xl tracking-tight text-base-content">
                Fibex<span className="fibex-sign-text">Sign</span>
              </span>
            </div>
            <button
              onClick={() => dispatch(toggleSidebar(false))}
              className="p-1.5 rounded-xl hover:bg-base-200 text-base-content"
              aria-label="Cerrar menú"
            >
              <Icon name="x" size={18} />
            </button>
          </div>
        )}

        {/* NAVEGACIÓN Y ACCESOS */}
        <nav
          className="op-menu op-menu-sm px-3 flex-1 overflow-y-auto hide-scrollbar py-3"
          aria-label="FibexSign Sidebar Navigation"
        >
          <ul
            className="text-sm flex flex-col gap-1.5"
            role="menubar"
            aria-label="FibexSign Sidebar Navigation"
          >
            {menuList.map((item) =>
              !item.children ? (
                <Menu
                  key={item.title}
                  item={item}
                  isOpen={isOpen}
                  closeSidebar={handleMenuItem}
                />
              ) : (
                <Submenu
                  key={item.title}
                  item={item}
                  closeSidebar={closeSidebar}
                  toggleSubmenu={toggleSubmenu}
                  submenuOpen={submenuOpen}
                />
              )
            )}
          </ul>
        </nav>

        {/* PIE DE SIDEBAR: PERFIL COMPACTO */}
        <div className="mt-auto px-3 pb-3 pt-2 flex-shrink-0">
          <div
            onClick={handleProfile}
            className="flex items-center gap-3 p-2 rounded-2xl hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer transition-all duration-200"
            title="Ver Perfil de Usuario"
          >
            {hasCustomImg ? (
              <img
                className="w-10 h-10 rounded-full object-cover ring-2 ring-primary/30 shrink-0"
                src={userProfileImg}
                alt="Profile"
              />
            ) : (
              <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-[#1d4ed8] to-[#3b82f6] text-white flex items-center justify-center ring-2 ring-blue-400/25 shadow-sm shrink-0">
                <Icon name="user" size={20} className="text-white" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-base-content truncate leading-tight">
                {username}
              </p>
              {tenantname && (
                <p className="text-[11px] text-base-content/70 truncate mt-0.5">
                  {tenantname}
                </p>
              )}
            </div>
          </div>
        </div>
      </aside>
    </>
  );
};

export default Sidebar;
