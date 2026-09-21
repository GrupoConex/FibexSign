import { useEffect, useState } from "react";

const ThemeToggle = () => {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const storedTheme = localStorage.getItem("theme");
    if (storedTheme === "dark") {
      setIsDark(true);
      document.documentElement.setAttribute("data-theme", "opensigndark");
      document.documentElement.classList.add("dark");
    } else {
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

  return (
    <>
      <input
        id="dark-mode-toggle"
        type="checkbox"
        className="op-toggle op-toggle-sm checked:[--tglbg:#3368ff] transition-all checked:bg-white cursor-pointer shrink-0"
        checked={isDark}
        onChange={handleChange}
      />
    </>
  );
};

export default ThemeToggle;
