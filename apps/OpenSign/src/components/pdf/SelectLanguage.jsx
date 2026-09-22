import i18next from "i18next";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Icon from "../../primitives/Icon";

const LANGUAGES = [
  { value: "en", text: "English" },
  { value: "es", text: "Español" },
  { value: "fr", text: "Français" },
  { value: "it", text: "Italiano" },
  { value: "de", text: "Deutsch" },
  { value: "hi", text: "हिन्दी" },
  { value: "kr", text: "한국어" }
];

const getNormalizedLang = (langCode) => {
  if (!langCode) return "en";
  const code = langCode.split("-")[0].toLowerCase();
  const exists = LANGUAGES.some((l) => l.value === code);
  return exists ? code : "en";
};

function SelectLanguage({ isProfile, className = "", updateExtUser }) {
  const { i18n, t } = useTranslation();
  const [lang, setLang] = useState(() =>
    getNormalizedLang(i18n.language || i18next.language)
  );

  useEffect(() => {
    if (i18n.language) {
      setLang(getNormalizedLang(i18n.language));
    }
  }, [i18n.language]);

  const handleChangeLang = (e) => {
    const newLang = e.target.value;
    setLang(newLang);
    i18n.changeLanguage(newLang);
    updateExtUser && updateExtUser({ language: newLang });
  };

  if (isProfile) {
    return (
      <div className={`flex items-center text-base-content ${className}`}>
        <select
          value={lang}
          onChange={handleChangeLang}
          aria-label={t("language")}
          className="w-[180px] op-select op-select-bordered op-select-sm text-xs"
        >
          {LANGUAGES.map((item) => (
            <option key={item.value} value={item.value}>
              {item.text}
            </option>
          ))}
        </select>
      </div>
    );
  }

  return (
    <div
      className={`inline-flex items-center gap-2 text-base-content ${className}`}
    >
      <Icon
        name="globe"
        size={15}
        className="text-base-content/60 shrink-0"
        aria-hidden="true"
      />
      <select
        value={lang}
        onChange={handleChangeLang}
        aria-label={t("language")}
        className="op-select op-select-bordered op-select-sm w-36 text-xs font-medium cursor-pointer focus:outline-none"
      >
        {LANGUAGES.map((item) => (
          <option key={item.value} value={item.value}>
            {item.text}
          </option>
        ))}
      </select>
    </div>
  );
}

export default SelectLanguage;
