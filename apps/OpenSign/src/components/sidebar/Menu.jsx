import { useTranslation } from "react-i18next";
import { useSelector } from "react-redux";
import { NavLink } from "react-router";
import Icon from "../../primitives/Icon";

const Menu = ({ item, isOpen, closeSidebar }) => {
  const appName = "FibexSign";
  const drivename = appName;
  const { t } = useTranslation();
  const { selectedMenu } = useSelector((state) => state.sidebar);

  return (
    <li key={item.title} role="none">
      <NavLink
        to={
          item.pageType
            ? `/${item.pageType}/${item.objectId}`
            : `/${item.objectId}`
        }
        className={({ isActive }) =>
          `${isActive && selectedMenu ? "bg-base-300 active font-medium" : ""} flex gap-x-5 items-center justify-start text-left p-3 rounded-lg text-base-content hover:text-base-content hover:no-underline focus:outline-none transition-colors`
        }
        onClick={() => closeSidebar(item.title)}
        tabIndex={isOpen ? 0 : -1}
        role="menuitem"
      >
        <span className="w-[20px] h-[20px] flex items-center justify-center">
          <Icon name={item.icon} size={20} className="text-current" />
        </span>
        <span className="flex items-center mb-0.5">
          {t(`sidebar.${item.title}`, { appName: drivename })}
        </span>
      </NavLink>
    </li>
  );
};

export default Menu;
