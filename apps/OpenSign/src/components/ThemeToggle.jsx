import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Icon from "../primitives/Icon";

const ThemeToggle = ({ variant = "checkbox", className = "" }) => {
  const { t } = useTranslation();
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const currentTheme =
      document.documentElement.getAttribute("data-theme") ||
      localStorage.getItem("theme");
    if (currentTheme === "opensigndark" || currentTheme === "dark") {
      setIsDark(true);
      document.documentElement.setAttribute("data-theme", "opensigndark");
      document.documentElement.classList.add("dark");
    } else {
      setIsDark(false);
      document.documentElement.setAttribute("data-theme", "opensigncss");
      document.documentElement.classList.remove("dark");
    }
  }, []);

  const handleChange = () => {
    const newTheme = !isDark;
    setIsDark(newTheme);
    if (newTheme) {
      document.documentElement.setAttribute("data-theme", "opensigndark");
      document.documentElement.classList.add("dark");
      localStorage.setItem("theme", "dark");
    } else {
      document.documentElement.setAttribute("data-theme", "opensigncss");
      document.documentElement.classList.remove("dark");
      localStorage.setItem("theme", "light");
    }
  };

  if (variant === "button") {
    const label = isDark ? t("light-mode") : t("dark-mode");
    return (
      <button
        type="button"
        onClick={handleChange}
        aria-label={label}
        title={label}
        className={`w-9 h-9 rounded-xl border border-slate-200/90 dark:border-slate-800 bg-base-100 hover:bg-base-200/80 dark:hover:bg-slate-800/80 shadow-sm flex items-center justify-center text-base-content/80 hover:text-base-content hover:scale-105 active:scale-95 transition-all cursor-pointer ${className}`}
      >
        <Icon
          name={isDark ? "sun" : "moon"}
          size={18}
          className={isDark ? "text-amber-400" : "text-slate-600"}
        />
      </button>
    );
  }

  return (
    <input
      id="dark-mode-toggle"
      type="checkbox"
      className={`op-toggle op-toggle-sm checked:[--tglbg:#3368ff] transition-all checked:bg-white cursor-pointer shrink-0 ${className}`}
      checked={isDark}
      onChange={handleChange}
    />
  );
};

export default ThemeToggle;
