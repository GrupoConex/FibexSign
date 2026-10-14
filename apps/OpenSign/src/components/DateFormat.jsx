import Select from "react-select";
import { useTranslation } from "react-i18next";

const DateFormat = ({ selectDate, dateFormatList, handleChangeFormat }) => {
  const selectedFormatIndex = dateFormatList?.findIndex(
    (item) => item.format === selectDate?.format
  );
  const { t } = useTranslation();

  const dateFormatOptions = dateFormatList.map((data, ind) => ({
    value: ind,
    label: data?.date ? data.date : "nodata"
  }));

  const handleSelectChange = (option) => {
    handleChangeFormat({
      stopPropagation: () => {},
      target: { value: option?.value }
    });
  };

  return (
    <div className="max-w-[400px]">
      <label className="text-[14px] mb-[0.7rem] font-medium capitalize block">
        {t("format")}
      </label>
      <Select
        value={dateFormatOptions.find(
          (option) => option.value === selectedFormatIndex
        )}
        onChange={handleSelectChange}
        options={dateFormatOptions}
        placeholder={t("select-date-format")}
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
      <span className="text-xs text-gray-400 mt-1 uppercase block">
        {selectDate.format}
      </span>
    </div>
  );
};

export default DateFormat;
