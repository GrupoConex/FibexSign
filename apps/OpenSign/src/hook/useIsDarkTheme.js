import { useEffect, useState } from "react";

const DARK_THEME_NAME = "opensigndark";

function readIsDarkTheme() {
  if (typeof document === "undefined") {
    return false;
  }
  return (
    document.documentElement.getAttribute("data-theme") === DARK_THEME_NAME
  );
}

export function useIsDarkTheme() {
  const [isDarkTheme, setIsDarkTheme] = useState(readIsDarkTheme);

  useEffect(() => {
    const updateThemeStatus = () => {
      setIsDarkTheme(readIsDarkTheme());
    };
    updateThemeStatus();

    const observer = new MutationObserver(updateThemeStatus);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"]
    });

    return () => observer.disconnect();
  }, []);

  return isDarkTheme;
}
