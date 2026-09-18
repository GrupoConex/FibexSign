import { useTranslation } from "react-i18next";
import { useSelector } from "react-redux";
import { NavLink } from "react-router";
import Icon from "../../primitives/Icon";

const Submenu = ({ item, closeSidebar, toggleSubmenu, submenuOpen }) => {
  const appName = "FibexSign";
  const drivename = appName;
  const { t } = useTranslation();
  const { title, icon, children } = item;
  const { selectedMenu } = useSelector((state) => state.sidebar);

  return (
    <li role="none" className="my-0.5">
      <button
        onClick={() => toggleSubmenu(item.title)}
        className="flex gap-x-5 items-center justify-start text-left p-3 text-base-content hover:text-base-content focus:bg-base-300 hover:bg-base-300 hover:no-underline focus:outline-none"
        aria-expanded={submenuOpen}
        aria-haspopup="true"
        aria-controls={`submenu-${title}`}
      >
        <span className="w-[20px] h-[20px] flex items-center justify-center">
          <Icon name={icon} size={20} className="text-current" />
        </span>
        <div className="flex justify-between items-center w-full">
          <span className="flex items-center mb-0.5">
            {t(`sidebar.${item.title}`, { appName })}
          </span>
          <Icon
            name={submenuOpen[item.title] ? "chevron-down" : "chevron-right"}
            size={16}
            className="text-current transition-transform duration-200"
          />
        </div>
      </button>
      {submenuOpen[item.title] && (
        <ul id={`submenu-${title}`} role="menu" aria-label={`${title} submenu`}>
          {children.map((childItem) => (
            <li key={childItem.title} role="none" className="my-0.5">
              <NavLink
                to={
                  childItem.pageType
                    ? `/${childItem.pageType}/${childItem.objectId}`
                    : `/${childItem.objectId}`
                }
                className={({ isActive }) =>
                  `${isActive && selectedMenu ? "bg-base-300 text-base-content" : ""} pl-4 flex items-center gap-x-5 py-2 text-sm cursor-pointer text-base-content hover:text-base-content focus:bg-base-300 hover:bg-base-300 hover:no-underline focus:outline-none`
                }
                onClick={() => closeSidebar(childItem.title)}
                role="menuitem"
                tabIndex={submenuOpen ? 0 : -1}
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
                    appName: drivename
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
