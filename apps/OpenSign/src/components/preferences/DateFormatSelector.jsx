import React, { useState } from "react";
import Select from "react-select";
import { formatDateTime } from "../../constant/Utils";
import { useTranslation } from "react-i18next";

const dateFormats = [
  "MM/DD/YYYY",
  "MM-DD-YYYY",
  "MM.DD.YYYY",
  "DD/MM/YYYY",
  "DD-MM-YYYY",
  "DD.MM.YYYY",
  "YYYY-MM-DD",
  "MMM DD, YYYY",
  "MMMM DD, YYYY",
  "DD MMM, YYYY",
  "DD MMMM, YYYY",
  "DD-MMM-YYYY"
];

const dateFormatOptions = dateFormats.map((format) => ({
  value: format,
  label: format
}));

const DateFormatSelector = (props) => {
  const { t } = useTranslation();
  const date = new Date();
  const [selectedFormat, setSelectedFormat] = useState(props.dateFormat);
  const [is12Hour, setIs12Hour] = useState(props?.is12HourTime);

  const handleFormatChange = (option) => {
    setSelectedFormat(option?.value);
    props.setDateFormat && props.setDateFormat(option?.value);
  };
  const handleHrInput = () => {
    setIs12Hour(!is12Hour);
    props.setIs12HourTime && props.setIs12HourTime(!is12Hour);
  };
  return (
    <div className="max-w-[400px] pr-[20px]">
      <label className="text-[14px] mb-[0.7rem] font-medium">
        {t("date-format")}
      </label>
      <Select
        value={dateFormatOptions.find((option) => option.value === selectedFormat)}
        onChange={handleFormatChange}
        options={dateFormatOptions}
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
      <div className="flex flex-row gap-4 mt-[0.75rem] text-[12px]">
        <label
          htmlFor="is12Hour-true"
          className="flex items-center gap-2 ml-2 cursor-pointer"
        >
          <input
            id="is12Hour-true"
            type="radio"
            name="hour-format"
            value={true}
            className="op-radio op-radio-xs"
            checked={is12Hour}
            onChange={handleHrInput}
          />
          <div className="text-center">12 hr</div>
        </label>
        <label
          htmlFor="is12Hour-false"
          className="flex items-center gap-2 ml-2 cursor-pointer"
        >
          <input
            id="is12Hour-false"
            type="radio"
            name="hour-format"
            value={false}
            className="op-radio op-radio-xs"
            checked={!is12Hour}
            onChange={handleHrInput}
          />
          <div className="text-center">24 hr</div>
        </label>
      </div>
      <p className="mt-[12px] ml-[10px] text-[13px] font-medium">
        <strong>
          {formatDateTime(date, selectedFormat, props?.timezone, is12Hour)}
        </strong>
      </p>
    </div>
  );
};

export default DateFormatSelector;
