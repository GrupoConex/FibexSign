import { useTranslation } from "react-i18next";
import { useSelector } from "react-redux";
import { NavLink } from "react-router";
import Icon from "../../primitives/Icon";
import { appInfo } from "../../constant/appinfo";

const Submenu = ({ item, closeSidebar, toggleSubmenu, submenuOpen }) => {
  const appName = appInfo.appName;
  const drivename = appName;
  const { t } = useTranslation();
  const { title, icon, children } = item;
  const { selectedMenu } = useSelector((state) => state.sidebar);

  const isExpanded = Boolean(submenuOpen && submenuOpen[item.title]);

  return (
    <li role="none">
      <button
        type="button"
        onClick={() => toggleSubmenu(item.title)}
        className="flex w-full gap-x-5 items-center justify-start text-left p-3 rounded-lg text-base-content hover:text-base-content hover:no-underline focus:outline-none transition-colors"
        aria-expanded={isExpanded}
        aria-haspopup="true"
        aria-controls={`submenu-${title}`}
      >
        <span className="w-[20px] h-[20px] flex items-center justify-center">
          <Icon name={icon} size={20} className="text-current" />
        </span>
        <div className="flex justify-between items-center w-full">
          <span className="flex items-center mb-0.5">
            {t(`sidebar.${item.title}`, {
              appName,
              defaultValue: item.title
            })}
          </span>
          <Icon
            name={isExpanded ? "chevron-down" : "chevron-right"}
            size={16}
            className="text-current transition-transform duration-200"
          />
        </div>
      </button>
      {isExpanded && (
        <ul
          id={`submenu-${title}`}
          role="menu"
          aria-label={`${title} submenu`}
          className="bg-transparent border-l-2 border-black/10 dark:border-white/15 ml-5 pl-2.5 my-1 flex flex-col gap-1.5"
        >
          {children.map((childItem) => (
            <li key={childItem.title} role="none">
              <NavLink
                to={
                  childItem.pageType
                    ? `/${childItem.pageType}/${childItem.objectId}`
                    : `/${childItem.objectId}`
                }
                className={({ isActive }) =>
                  `${isActive && selectedMenu ? "bg-base-300 active font-medium" : ""} pl-3 flex items-center gap-x-3.5 py-2 text-sm cursor-pointer rounded-lg text-base-content hover:text-base-content hover:no-underline focus:outline-none transition-colors`
                }
                onClick={() => closeSidebar(childItem.title)}
                role="menuitem"
                tabIndex={isExpanded ? 0 : -1}
              >
                <span className="w-[18px] h-[18px] flex items-center justify-center">
                  <Icon
                    name={childItem.icon}
                    size={18}
                    className="text-current"
                  />
                </span>
                <span className="mb-0.5">
                  {t(`sidebar.${item.title}-Children.${childItem.title}`, {
                    appName: drivename,
                    defaultValue: t(`sidebar.${childItem.title}`, {
                      appName: drivename,
                      defaultValue: childItem.title
                    })
                  })}
                </span>
              </NavLink>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
};

export default Submenu;
