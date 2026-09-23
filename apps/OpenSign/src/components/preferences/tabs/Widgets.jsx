import { useEffect, useState } from "react";
import Parse from "parse";
import {
  dateFormat,
  formatDate,
  notify,
  withSessionValidation
} from "../../../utils";
import { useTranslation } from "react-i18next";
import { useDispatch, useSelector } from "react-redux";
import { setLoader, setUserInfo } from "../../../redux/reducers/userReducer";
import DatePicker from "../../DatePicker";
import DateFormat from "../../DateFormat";
import {
  changeDateToMomentFormat,
  selectFormat
} from "../../../constant/Utils";
import moment from "moment";
import { Calendar, Check } from "lucide-react";
import HelpHint from "../HelpHint";
import CardSection from "../CardSection";


const WidgetsTab = () => {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const { userInfo, isLoader } = useSelector((state) => state.user);
  const [selectDate, setSelectDate] = useState({
    date: "",
    format: "MM/dd/yyyy"
  });
  const [dateFormatList, setDateFormatList] = useState([]);
  const [dateWidget, setDateWidget] = useState({
    isSigningDate: false,
    isReadOnly: false,
    date: "",
    format: "MM/dd/yyyy"
  });

  useEffect(() => {
    updateStates();
  }, [userInfo]);

  const updateStates = () => {
    const widgetPreferences = userInfo?.WidgetPreferences || [];
    const dateWidgetPref = widgetPreferences.find((w) => w.type === "date") || {
      isSigningDate: false,
      isReadOnly: false
    };
    setDateWidget({
      isSigningDate: !!dateWidgetPref.isSigningDate,
      isReadOnly: !!dateWidgetPref.isReadOnly,
      date: dateWidgetPref.date,
      format: dateWidgetPref.format
    });
    setSelectDate({ date: dateWidgetPref.date, format: dateWidgetPref.format });
    const formatted = moment(
      dateWidgetPref.date,
      changeDateToMomentFormat(dateWidgetPref.format),
      true
    ).toISOString();
    formatDateList(formatted);
  };

  const handleSigningDateChange = (e) => {
    if (e.target.checked) {
      setSelectDate({ date: "", format: selectDate.format });
    }
    setDateWidget((prev) => ({
      ...prev,
      date: "",
      isSigningDate: e.target.checked
    }));
  };

  const handleReadOnlyChange = (e) => {
    setDateWidget({ ...dateWidget, isReadOnly: e.target.checked });
  };

  const handleSave = withSessionValidation(async () => {
    dispatch(setLoader(true));
    try {
      if (
        dateWidget?.isReadOnly &&
        !selectDate.date &&
        !dateWidget.isSigningDate
      ) {
        notify.warning(t("read-only-date-error"));
        return;
      }
      const res = await Parse.Cloud.run("setwidgetpreferences", {
        dateWidget: dateWidget
      });
      if (res) {
        const widgetPreferences = userInfo?.WidgetPreferences || [];
        // Normalize booleans (simple + safe)
        const dateOpt = { type: "date", ...dateWidget };
        // Upsert: replace if exists, otherwise append
        const updatedWidgetPreferences =
          widgetPreferences?.length > 0
            ? widgetPreferences.map((w) => (w.type === "date" ? dateOpt : w))
            : [...widgetPreferences, dateOpt];
        const userdata = { ...userInfo };
        userdata.WidgetPreferences = updatedWidgetPreferences;
        dispatch(setUserInfo(userdata));
        notify.success(t("saved-successfully"));
      }
    } catch (error) {
      console.error("Widgets preferences error: ", error);
      notify.error(error.message);
    } finally {
      dispatch(setLoader(false));
    }
  });
  const handleDateChange = (date) => {
    //function to save date and format in local array
    const formattedDate = formatDate({
      date: date,
      format: selectDate.format
    });
    setDateWidget({
      ...dateWidget,
      isSigningDate: false,
      date: formattedDate,
      format: selectDate.format
    });
    setSelectDate({ date: formattedDate, format: selectDate.format });
    formatDateList(date);
  };

  const formatDateList = (selecteddate) => {
    let date = selecteddate || new Date();
    const list = dateFormat.map((dateFormat) => {
      const format = selectFormat(dateFormat);
      return { date: formatDate({ date, format }), format: format };
    });
    setDateFormatList(list);
  };
  const handleChangeFormat = (e) => {
    e.stopPropagation();
    const selectedIndex = Number(e.target.value);
    const format = dateFormatList[selectedIndex]?.format;
    const dateObj =
      selectDate.date && !dateWidget?.isSigningDate
        ? { date: dateFormatList[selectedIndex]?.date, format: format }
        : { format: format };
    setDateWidget((prev) => ({ ...prev, ...dateObj }));
    setSelectDate((prev) => ({ ...prev, ...dateObj }));
  };
  const handleClear = () => {
    setSelectDate((prev) => ({ ...prev, date: "" }));
    setDateWidget((prev) => ({ ...prev, date: "" }));
  };
  return (
    <div id="panel-widgets" className="flex flex-col gap-4 md:gap-5">
      <div className="lg:max-w-2xl">
        <CardSection
          icon={Calendar}
          title={
            <span className="inline-flex items-center">
              {t("date-widget")}
              <HelpHint id="date-widget-tooltip">
                <div className="max-w-[200px] md:max-w-[450px]">
                  <p className="font-bold"> {t("date-widget")}</p>
                  <p>{t("date-pref-help-sub-title")}</p>
                  <div className="p-[5px]">
                    <ol className="list-disc">
                      <li>
                        <span className="font-bold capitalize">
                          {t("format")}:{" "}
                        </span>
                        <span>{t("date-pref-help-format")}</span>
                      </li>
                      <li>
                        <span className="font-bold capitalize">
                          {t("default-date")}:{" "}
                        </span>
                        <span>{t("date-pref-help-default-date")}</span>
                      </li>
                      <li>
                        <span className="font-bold capitalize">
                          {t("signing-date")}:{" "}
                        </span>
                        <span>{t("date-pref-help-signing-date")}</span>
                      </li>
                      <li>
                        <span className="font-bold capitalize">
                          {t("read-only")}:{" "}
                        </span>
                        <span>{t("date-pref-help-read-only")}</span>
                      </li>
                    </ol>
                  </div>
                </div>
              </HelpHint>
            </span>
          }
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="flex flex-col gap-3">
              <DateFormat
                selectDate={selectDate}
                dateFormatList={dateFormatList}
                handleChangeFormat={handleChangeFormat}
              />
              <div className="flex flex-col md:flex-row md:items-center gap-1">
                <DatePicker
                  selectDate={selectDate}
                  onChange={handleDateChange}
                  handleClear={handleClear}
                />
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex flex-row gap-2 items-center">
                <input
                  className="op-checkbox op-checkbox-xs"
                  type="checkbox"
                  id="date-widget-signingdate"
                  name="isSigningDate"
                  onChange={handleSigningDateChange}
                  checked={dateWidget.isSigningDate}
                />
                <label
                  htmlFor="date-widget-signingdate"
                  className="text-sm font-medium text-base-content hover:underline underline-offset-2 cursor-pointer capitalize mb-0"
                  title={t("signing-date")}
                >
                  {t("signing-date")}
                </label>
              </div>
              <div className="flex flex-row gap-2 items-center">
                <input
                  className="op-checkbox op-checkbox-xs"
                  type="checkbox"
                  id="date-widget-readonly"
                  name="isReadOnly"
                  onChange={handleReadOnlyChange}
                  checked={dateWidget.isReadOnly}
                />
                <label
                  htmlFor="date-widget-readonly"
                  className="text-sm font-medium text-base-content hover:underline underline-offset-2 cursor-pointer capitalize mb-0"
                  title={t("read-only")}
                >
                  {t("read-only")}
                </label>
              </div>
            </div>
          </div>
        </CardSection>
      </div>

      <div className="flex justify-start">
        <button
          data-testid="widgets-save-button"
          className="op-btn op-btn-primary gap-2"
          onClick={handleSave}
          disabled={isLoader}
        >
          <Check size={16} aria-hidden="true" />
          {t("save")}
        </button>
      </div>
    </div>
  );
};

export default WidgetsTab;
