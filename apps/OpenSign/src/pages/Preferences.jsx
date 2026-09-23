import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Loader from "../primitives/Loader";
import {
  getTenantDetails,
  handleSignatureType,
  signatureTypes,
  usertimezone
} from "../constant/Utils";
import Parse from "parse";
import { Settings, SlidersHorizontal, Mail, FileSignature, Globe, Bell, Check } from "lucide-react";
import TimezoneSelector from "../components/preferences/TimezoneSelector";
import DateFormatSelector from "../components/preferences/DateFormatSelector";
import FilenameFormatSelector from "../components/preferences/FilenameFormatSelector";
import HelpHint from "../components/preferences/HelpHint";
import CardSection from "../components/preferences/CardSection";
import ToggleField from "../components/preferences/ToggleField";
import axios from "axios";
import { notify, withSessionValidation } from "../utils";
import { WidgetsTab, EmailTab } from "../components/preferences/tabs";
import {
  setUserInfo,
  setTenantInfo,
  setLoader,
  setTopLoader
} from "../redux/reducers/userReducer";
import { useDispatch, useSelector } from "react-redux";
import { appInfo } from "../constant/appinfo";

const TAB_ICONS = {
  general: Settings,
  widgets: SlidersHorizontal,
  email: Mail
};

const Preferences = () => {
  const appName = appInfo.appName;
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const { isLoader, isTopLoader } = useSelector((state) => state.user);
  const [signatureType, setSignatureType] = useState([]);
  const [errMsg, setErrMsg] = useState("");
  const [isNotifyOnSignatures, setIsNotifyOnSignatures] = useState();
  const [timezone, setTimezone] = useState(usertimezone);
  const [activeTab, setactiveTab] = useState(0);
  const tabRefs = useRef([]);
  const generaltab = {
    name: "general",
    title: t("general")
  };
  const [tab, setTab] = useState([generaltab]);
  const [sendinOrder, setSendinOrder] = useState(true);
  const [isTourEnabled, setIsTourEnabled] = useState(false);
  const [dateFormat, setDateFormat] = useState("MM/DD/YYYY");
  const [is12HourTime, setIs12HourTime] = useState(false);
  const [isLTVEnabled, setIsLTVEnabled] = useState(false);
  const [fileNameFormat, setFileNameFormat] = useState("DOCNAME");
  const [useNameAsSender, setUseNameAsSender] = useState(false);

  useEffect(() => {
    fetchSignType();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchSignType = withSessionValidation(async () => {
    dispatch(setTopLoader(true));
    const EmailTab = [{ name: "email", title: t("email") }];

    const arr = [
      generaltab,
      { name: "widgets", title: t("widgets") },
      ...EmailTab
    ];
    setTab(arr);
    try {
      const user = JSON.parse(
        localStorage.getItem(
          `Parse/${localStorage.getItem("parseAppId")}/currentUser`
        )
      );
      const tenantDetails = await getTenantDetails(user?.objectId);
      dispatch(setTenantInfo(tenantDetails));
      const signatureType = tenantDetails?.SignatureType || [];
      const tenantSignTypes = signatureType?.filter((x) => x.enabled === true);
      const extUser = await axios.post(
        `${localStorage.getItem("baseUrl")}functions/getUserDetails`,
        {},
        {
          headers: {
            "Content-Type": "application/json",
            "X-Parse-Application-Id": localStorage.getItem("parseAppId"),
            "X-Parse-Session-Token": localStorage.getItem("accesstoken")
          }
        }
      );
      const getUser = extUser?.data?.result;
      if (!getUser) {
        setErrMsg(t("something-went-wrong-mssg"));
        return;
      }
      const _getUser = JSON.parse(JSON.stringify(getUser));
      dispatch(setUserInfo(_getUser));
      setIsNotifyOnSignatures(
        _getUser?.NotifyOnSignatures !== undefined
          ? _getUser?.NotifyOnSignatures
          : true
      );
      setTimezone(_getUser?.Timezone || usertimezone);
      if (tenantSignTypes?.length > 0) {
        const signatureType = _getUser?.SignatureType || signatureTypes;
        const updatedSignatureType = await handleSignatureType(
          tenantSignTypes,
          signatureType
        );
        setSignatureType(updatedSignatureType);
      } else {
        setSignatureType(_getUser?.SignatureType || signatureTypes);
      }
      setSendinOrder(
        _getUser?.SendinOrder !== undefined ? _getUser?.SendinOrder : true
      );
      setIsTourEnabled(
        _getUser?.IsTourEnabled !== undefined ? _getUser?.IsTourEnabled : true
      );
      setDateFormat(
        _getUser?.DateFormat !== undefined ? _getUser?.DateFormat : "MM/DD/YYYY"
      );
      setIs12HourTime(
        _getUser?.Is12HourTime !== undefined ? _getUser?.Is12HourTime : false
      );
      setIsLTVEnabled(
        _getUser?.IsLTVEnabled !== undefined ? _getUser?.IsLTVEnabled : false
      );
      const downloadFilenameFormat =
        _getUser?.DownloadFilenameFormat || "DOCNAME";
      setFileNameFormat(downloadFilenameFormat);
      setUseNameAsSender(_getUser?.UseNameAsSender === true);
    } catch (err) {
      console.error("Error while getting user details: ", err);
      setErrMsg(t("something-went-wrong-mssg"));
    } finally {
      dispatch(setTopLoader(false));
    }
  });

  const handleCheckboxChange = (index) => {
    setSignatureType((prev) =>
      prev.map((item, i) =>
        i === index ? { ...item, enabled: !item.enabled } : item
      )
    );
  };

  const handleSave = withSessionValidation(async () => {
    dispatch(setLoader(true));
    try {
      const Timezone = timezone || usertimezone;
      if (
        signatureType.length > 0 ||
        isNotifyOnSignatures !== undefined ||
        Timezone
      ) {
        let params = { Timezone: Timezone };
        if (signatureType.length > 0) {
          const enabledSignTypes = signatureType?.filter((x) => x.enabled);
          const isDefaultSignTypeOnly =
            enabledSignTypes?.length === 1 &&
            enabledSignTypes[0]?.name === "default";
          if (enabledSignTypes.length === 0) {
            notify.error(t("at-least-one-signature-type"));
            return;
          } else if (isDefaultSignTypeOnly) {
            notify.error(t("expect-default-one-signature-type"));
            return;
          } else {
            params = { ...params, SignatureType: signatureType };
          }
        }
        if (isNotifyOnSignatures !== undefined) {
          params = { ...params, NotifyOnSignatures: isNotifyOnSignatures };
        }
        params = {
          ...params,
          SendinOrder: sendinOrder,
          IsTourEnabled: isTourEnabled,
          DateFormat: dateFormat,
          Is12HourTime: is12HourTime,
          IsLTVEnabled: isLTVEnabled,
          DownloadFilenameFormat: fileNameFormat,
          UseNameAsSender: useNameAsSender
        };
        const updateRes = await Parse.Cloud.run("updatepreferences", params);
        if (updateRes) {
          notify.success(t("saved-successfully"));
          let extUser =
            localStorage.getItem("Extand_Class") &&
            JSON.parse(localStorage.getItem("Extand_Class"))?.[0];
          if (extUser && extUser?.objectId) {
            extUser.NotifyOnSignatures = isNotifyOnSignatures;
            extUser.SendinOrder = sendinOrder;
            extUser.IsTourEnabled = isTourEnabled;
            extUser.DateFormat = dateFormat;
            extUser.Is12HourTime = is12HourTime;
            extUser.DownloadFilenameFormat = fileNameFormat;
            extUser.UseNameAsSender = useNameAsSender;
            const _extUser = JSON.parse(JSON.stringify(extUser));
            localStorage.setItem("Extand_Class", JSON.stringify([_extUser]));
          }
        }
      }
    } catch (err) {
      console.error("Error updating signature type: ", err);
      notify.error(err.message);
    } finally {
      dispatch(setLoader(false));
    }
  });

  const handleNotifySignChange = () =>
    setIsNotifyOnSignatures((prev) => !prev);
  const handleTourInput = () => setIsTourEnabled((prev) => !prev);
  const handleSendinOrderInput = () => setSendinOrder((prev) => !prev);
  const tabName = (ind) => tab.find((t, i) => i === ind)?.name;

  const handleTabKeyDown = (event, ind) => {
    const count = tab.length;
    let nextIndex = null;
    if (event.key === "ArrowRight") {
      nextIndex = (ind + 1) % count;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (ind - 1 + count) % count;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = count - 1;
    } else {
      return;
    }
    event.preventDefault();
    setactiveTab(nextIndex);
    tabRefs.current[nextIndex]?.focus();
  };

  return (
    <React.Fragment>
      {isTopLoader ? (
        <div className="flex justify-center items-center h-screen">
          <Loader />
        </div>
      ) : (
        <>
          {errMsg ? (
            <div className="flex justify-center items-center h-screen">
              {errMsg}
            </div>
          ) : (
            <div className="relative bg-base-100 text-base-content flex flex-col justify-center rounded-box mb-3">
              {isLoader && (
                <div className="flex z-[100] justify-center items-center absolute w-full h-full rounded-box bg-black/30">
                  <Loader />
                </div>
              )}
              <div className="flex items-center gap-3 ml-4 mt-4 mb-1">
                <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  <Settings size={20} aria-hidden="true" />
                </div>
                <div>
                  <h1 className="text-lg font-semibold text-base-content leading-tight">
                    {appName} {t("Preferences")}
                  </h1>
                  <p className="text-xs text-base-content/60">
                    {t("preferences-subtitle")}
                  </p>
                </div>
              </div>
              <div className="flex justify-center items-center mt-3">
                <div
                  role="tablist"
                  className="op-tabs op-tabs-boxed bg-base-200 op-tabs-sm md:op-tabs-md"
                >
                  {tab.map((tabData, ind) => {
                    const TabIcon = TAB_ICONS[tabData.name] || Settings;
                    const isActive = activeTab === ind;
                    return (
                      <div
                        ref={(el) => (tabRefs.current[ind] = el)}
                        onClick={() => setactiveTab(ind)}
                        onKeyDown={(e) => handleTabKeyDown(e, ind)}
                        key={ind}
                        id={`tab-${tabData.name}`}
                        role="tab"
                        tabIndex={isActive ? 0 : -1}
                        className={`op-tab gap-1 text-xs md:text-sm transition-all ${isActive ? "op-tab-active" : ""}`}
                        aria-selected={isActive}
                        aria-controls={`tabpanel-${tabData.name}`}
                        aria-label={tabData.title}
                      >
                        <TabIcon size={14} aria-hidden="true" />
                        <span
                          className={`${isActive ? "inline" : "hidden"} md:inline`}
                          title={tabData?.title}
                        >
                          {tabData.title}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div
                id={`tabpanel-${tabName(activeTab)}`}
                className="px-4 md:px-6 pt-4 pb-6"
                aria-labelledby={`tab-${tabName(activeTab)}`}
                role="tabpanel"
                tabIndex={0}
              >
                {tabName(activeTab) === "general" && (
                  <div className="flex flex-col gap-4 md:gap-5">
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-5">
                      <CardSection icon={FileSignature} title={t("preferences-signature-flow-title")}>
                        <fieldset className="min-w-0 p-0 m-0 border-0">
                          <legend
                            className="text-[14px] font-medium inline-flex items-center p-0"
                          >
                            {t("allowed-signature-types")}
                            <HelpHint id="signtypes-tooltip">
                              <div className="max-w-[200px] md:max-w-[450px]">
                                <p className="font-bold">
                                  {t("allowed-signature-types")}
                                </p>
                                <p>{t("allowed-signature-types-help.p1")}</p>
                                <div className="p-[5px] ml-2">
                                  <ol className="list-disc">
                                    <li>
                                      <span className="font-bold">
                                        {t("draw")}:{" "}
                                      </span>
                                      <span>
                                        {t("allowed-signature-types-help.l1")}
                                      </span>
                                    </li>
                                    <li>
                                      <span className="font-bold">Type: </span>
                                      <span>
                                        {t("allowed-signature-types-help.l2")}
                                      </span>
                                    </li>
                                    <li>
                                      <span className="font-bold">
                                        {t("upload")}:{" "}
                                      </span>
                                      <span>
                                        {t("allowed-signature-types-help.l3")}
                                      </span>
                                    </li>
                                    <li>
                                      <span className="font-bold">
                                        Default:{" "}
                                      </span>
                                      <span>
                                        {t("allowed-signature-types-help.l4")}
                                      </span>
                                    </li>
                                  </ol>
                                </div>
                              </div>
                            </HelpHint>
                          </legend>
                          <div className="flex flex-col md:flex-row flex-wrap gap-3 mt-2">
                            {signatureType.map((type, i) => (
                              <div
                                key={i}
                                className="flex flex-row gap-2 items-center"
                              >
                                <input
                                  className="op-checkbox op-checkbox-xs"
                                  type="checkbox"
                                  id={`signature-type-${type.name}`}
                                  name="signaturetype"
                                  onChange={() => handleCheckboxChange(i)}
                                  checked={type.enabled}
                                />
                                <label
                                  htmlFor={`signature-type-${type.name}`}
                                  className="text-sm font-medium text-base-content hover:underline underline-offset-2 cursor-pointer capitalize mb-0"
                                  title={`Enabling this allows signers to ${type.name} signature`}
                                >
                                  {type?.name === "typed" ? "type" : type?.name}
                                </label>
                              </div>
                            ))}
                          </div>
                        </fieldset>

                        <ToggleField
                          id="send-in-order"
                          label={t("send-in-order")}
                          helpId="sendInOrder-tooltip"
                          checked={sendinOrder}
                          onChange={handleSendinOrderInput}
                          caption={t("send-in-order-help.p1")}
                          helpContent={
                            <div className="max-w-[200px] md:max-w-[450px]">
                              <p className="font-bold">{t("send-in-order")}</p>
                              <p>{t("send-in-order-help.p1")}</p>
                              <div className="p-[5px]">
                                <ol className="list-disc">
                                  <li>
                                    <span className="font-bold">
                                      {t("yes")}:{" "}
                                    </span>
                                    <span>{t("send-in-order-help.p2")}</span>
                                  </li>
                                  <li>
                                    <span className="font-bold">
                                      {t("no")}:{" "}
                                    </span>
                                    <span>{t("send-in-order-help.p3")}</span>
                                  </li>
                                </ol>
                              </div>
                              <p>{t("send-in-order-help.p4")}</p>
                            </div>
                          }
                        />

                        <ToggleField
                          id="use-name-as-sender"
                          label={t("use-name-as-sender")}
                          helpId="sender-name-toggle-tooltip"
                          checked={useNameAsSender}
                          onChange={() =>
                            setUseNameAsSender((prevValue) => !prevValue)
                          }
                          caption={t("use-name-as-sender-help", { appName })}
                          helpContent={
                            <div className="max-w-[200px] md:max-w-[450px] text-[13px] font-medium">
                              <p>
                                {t("use-name-as-sender-help", { appName })}
                              </p>
                            </div>
                          }
                        />
                      </CardSection>

                      <CardSection icon={Globe} title={t("preferences-localization-title")}>
                        <TimezoneSelector
                          timezone={timezone}
                          setTimezone={setTimezone}
                        />
                        <DateFormatSelector
                          timezone={timezone}
                          dateFormat={dateFormat}
                          is12HourTime={is12HourTime}
                          setIs12HourTime={setIs12HourTime}
                          setDateFormat={setDateFormat}
                        />
                        <FilenameFormatSelector
                          fileNameFormat={fileNameFormat}
                          setFileNameFormat={setFileNameFormat}
                        />
                      </CardSection>

                      <CardSection icon={Bell} title={t("preferences-notifications-title")}>
                        <ToggleField
                          id="notify-on-signatures"
                          label={t("notify-on-signatures")}
                          helpId="nos-tooltip"
                          checked={isNotifyOnSignatures === true}
                          onChange={handleNotifySignChange}
                          caption={t("notify-on-signatures-help.p1")}
                          helpContent={
                            <div className="max-w-[200px] md:max-w-[450px]">
                              <p className="font-bold">
                                {t("notify-on-signatures")}
                              </p>
                              <p>{t("notify-on-signatures-help.p1")}</p>
                              <p>{t("notify-on-signatures-help.note")}</p>
                            </div>
                          }
                        />

                        <ToggleField
                          id="tour-enabled"
                          label={t("enable-tour")}
                          helpId="istourenabled-tooltip"
                          checked={isTourEnabled}
                          onChange={handleTourInput}
                          caption={t("istourenabled-help.p1")}
                          helpContent={
                            <div className="max-w-[200px] md:max-w-[450px]">
                              <p className="font-bold">{t("enable-tour")}</p>
                              <div className="p-[5px]">
                                <ol className="list-disc">
                                  <li>
                                    <span className="font-bold">
                                      {t("yes")}:{" "}
                                    </span>
                                    <span>{t("istourenabled-help.p1")}</span>
                                  </li>
                                  <li>
                                    <span className="font-bold">
                                      {t("no")}:{" "}
                                    </span>
                                    <span>{t("istourenabled-help.p2")}</span>
                                  </li>
                                </ol>
                              </div>
                              <p>
                                {t("istourenabled-help.p3", { appName })}
                              </p>
                            </div>
                          }
                        />
                      </CardSection>
                    </div>

                    <div className="flex justify-start">
                      <button
                        data-testid="general-save-button"
                        className="op-btn op-btn-primary gap-2"
                        onClick={handleSave}
                        disabled={isLoader}
                      >
                        <Check size={16} aria-hidden="true" />
                        {t("save")}
                      </button>
                    </div>
                  </div>
                )}
                {tabName(activeTab) === "widgets" && <WidgetsTab />}
                {tabName(activeTab) === "email" && <EmailTab />}
              </div>
            </div>
          )}
        </>
      )}
    </React.Fragment>
  );
};
export default Preferences;
