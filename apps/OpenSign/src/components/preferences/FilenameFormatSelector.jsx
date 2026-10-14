import { useState, useEffect, useMemo } from "react";
import Select from "react-select";
import Parse from "parse";
import { buildDownloadFilename } from "../../utils";
import { useTranslation } from "react-i18next";
import HelpHint from "./HelpHint";

/**
 * Enum-like list of supported filename format IDs and their labels
 * Keep IDs stable; you can freely change labels for UX.
 */
const FILENAME_FORMATS = [
  { id: "DOCNAME", label: "document Name.pdf" },
  { id: "DOCNAME_SIGNED", label: "document Name - Signed.pdf" },
  { id: "DOCNAME_EMAIL", label: "document Name - name@domain.com.pdf" },
  {
    id: "DOCNAME_EMAIL_DATE",
    label: "document Name - name@domain.com - date.pdf"
  }
];

const FILENAME_FORMAT_OPTIONS = FILENAME_FORMATS.map((opt) => ({
  value: opt.id,
  label: opt.label
}));

const FilenameFormatSelector = ({ fileNameFormat, setFileNameFormat }) => {
  const { t } = useTranslation();
  const sampleDocName = "Agreement";
  const [value, setValue] = useState(fileNameFormat);
  const [error, setError] = useState("");
  const currentUser = Parse?.User?.current();
  const email = currentUser?.get("email") || "user@example.com";

  // Load preference from contracts_User
  useEffect(() => {
    (async () => {
      try {
        if (!currentUser) return;
        const rec = await Parse.Cloud.run("getUserDetails");
        if (rec) {
          const fmt = rec.get("DownloadFilenameFormat");
          if (fmt) setValue(fmt);
        }
      } catch (e) {
        console.error("Load filename pref failed", e);
        setError(e?.message || String(e));
      }
    })();
  }, [currentUser]);

  const preview = useMemo(() => {
    return buildDownloadFilename(value, {
      docName: sampleDocName,
      email,
      isSigned: true // preview with signed true for that option
    });
  }, [value, email, sampleDocName]);

  async function savePreference(nextValue) {
    setFileNameFormat(nextValue);
  }
  return (
    <div className="max-w-[400px] pr-[20px]">
      <label
        htmlFor="filename-format-select"
        className="text-[14px] mb-[0.7rem] font-medium inline-flex items-center"
      >
        {t("document-download-filename-format")}
        <HelpHint id="filename-tooltip">
          <div className="max-w-[200px] md:max-w-[450px]">
            <p>{t("download-filename-format-help")}</p>
          </div>
        </HelpHint>
      </label>
      <Select
        inputId="filename-format-select"
        value={FILENAME_FORMAT_OPTIONS.find((opt) => opt.value === value)}
        onChange={async (option) => {
          const v = option?.value;
          setValue(v);
          await savePreference(v);
        }}
        options={FILENAME_FORMAT_OPTIONS}
        unstyled
        isSearchable={false}
        classNames={{
          control: () =>
            "op-input op-input-bordered op-input-sm focus:outline-none hover:border-base-content w-full h-full text-[11px]",
          valueContainer: () =>
            "flex flex-row gap-x-[2px] gap-y-[2px] md:gap-y-0 w-full my-[2px]",
          menu: () =>
            "mt-1 shadow-md rounded-lg bg-base-200 text-base-content",
          menuList: () => "shadow-md rounded-lg overflow-hidden",
          option: () =>
            "bg-base-200 text-base-content rounded-lg m-1 hover:bg-base-300 p-2 text-[11px]",
          noOptionsMessage: () => "p-2 bg-base-200 rounded-lg m-1 p-2 text-[11px]"
        }}
      />

      <div className="mt-2 text-xs opacity-80">
        {t("preview")}
        <span className="font-medium">{preview}</span>
      </div>
      {error && <div className="mt-2 text-xs text-red-600">{error}</div>}
    </div>
  );
};

export default FilenameFormatSelector;
