import React, { useEffect, useState, useRef, useCallback } from "react";
import { lazyWithRetry, notify, withSessionValidation } from "../utils";
import "../styles/opensigndrive.css";
import {
  getDrive
} from "../constant/Utils";
import { useNavigate } from "react-router";
import Parse from "parse";
import ModalUi from "../primitives/ModalUi";
import TourContentWithBtn from "../primitives/TourContentWithBtn";
import Tour from "../primitives/Tour";
import axios from "axios";
import Loader from "../primitives/Loader";
import { useTranslation } from "react-i18next";
import { appInfo } from "../constant/appinfo";

const DriveBody = lazyWithRetry(
  () => import("../components/opensigndrive/DriveBody")
);
const AppLoader = () => {
  return (
    <div className="h-[100vh] flex justify-center items-center">
      <Loader />
    </div>
  );
};
function Opensigndrive() {
  const appName = appInfo.appName;
  const drivename = appName;
  const { t } = useTranslation();
  const navigate = useNavigate();
  const scrollRef = useRef(null);
  // Create a ref for the "sentinel" element at the bottom of the list
  const bottomRef = useRef(null);
  const [isList, setIsList] = useState(false);
  const [selectedSort, setSelectedSort] = useState("Date");
  const [sortingOrder, setSortingOrder] = useState("Descending");
  const [pdfData, setPdfData] = useState([]);
  const [isFolder, setIsFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState();
  const [error, setError] = useState();
  const [folderLoader, setIsFolderLoader] = useState(false);
  const [isShowSort, setIsShowSort] = useState(false);
  const [isTour, setIsTour] = useState(false);
  const [tourStatusArr, setTourStatusArr] = useState([]);
  const [isLoading, setIsLoading] = useState({
    isLoad: true,
    message: t("loading-mssg")
  });
  const [docId, setDocId] = useState();
  const [handleError, setHandleError] = useState("");
  const [folderName, setFolderName] = useState([]);
  const [isAlert, setIsAlert] = useState({ isShow: false, alertMessage: "" });
  const [isOptions, setIsOptions] = useState(false);
  const [skip, setSkip] = useState(0);
  const limit = 50;
  const [loading, setLoading] = useState(false);
  const sortOrder = ["Ascending", "Descending"];
  const sortingValue = ["Name", "Date"];
  const [isDontShow, setIsDontShow] = useState(true);
  const [tourData, setTourData] = useState();
  const [showTourFirstTIme, setShowTourFirstTime] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const debounceTimer = useRef(null);
  const orderName = {
    Ascending: "Ascending",
    Descending: "Descending",
    Name: "Name",
    Date: "Date"
  };
  const currentUser =
    localStorage.getItem(
      `Parse/${localStorage.getItem("parseAppId")}/currentUser`
    ) &&
    localStorage.getItem(
      `Parse/${localStorage.getItem("parseAppId")}/currentUser`
    );
  const jsonCurrentUser = JSON.parse(currentUser);

  useEffect(() => {
    getDetails();
    // eslint-disable-next-line
  }, [docId]);

  const tourConfigs = [
    {
      selector: '[data-tut="reactourFirst"]',
      content: () => (
        <TourContentWithBtn
          message={t("tour-mssg.opensign-drive-1")}
          isChecked={handleDontShow}
        />
      ),
      position: "top",
      styles: { fontSize: "13px" }
    },
    {
      selector: '[data-tut="reactourSecond"]',
      content: () => (
        <TourContentWithBtn
          message={t("tour-mssg.opensign-drive-2")}
          isChecked={handleDontShow}
        />
      ),
      position: "top",
      styles: { fontSize: "13px" }
    },
    {
      selector: '[data-tut="reactourThird"]',
      content: () => (
        <TourContentWithBtn
          message={t("tour-mssg.opensign-drive-3")}
          isChecked={handleDontShow}
        />
      ),
      position: "top",
      styles: { fontSize: "13px" }
    },
    {
      selector: '[data-tut="reactourForth"]',
      content: () => (
        <TourContentWithBtn
          message={t("tour-mssg.opensign-drive-4")}
          isChecked={handleDontShow}
        />
      ),
      position: "top",
      styles: { fontSize: "13px" }
    }
  ];
  const getDetails = async () => {
      getPdfDocumentList();
  };
  //function for get all pdf document list
  const getPdfDocumentList = async (disbaleLoading) => {
    setLoading(true);
    if (showTourFirstTIme) {
      checkTourStatus();
    }
    if (!disbaleLoading) {
      setIsLoading({ isLoad: true, message: t("loading-mssg") });
    }
    try {
      const driveDetails = await getDrive(docId, skip, limit);
      if (driveDetails && driveDetails === "Error: Something went wrong!") {
        setHandleError(t("something-went-wrong-mssg"));
      } else if (driveDetails && driveDetails.length > 0) {
        const addMoreTour = [
          {
            selector: '[data-tut="reactourFifth"]',
            content: () => (
              <TourContentWithBtn
                message={t("tour-mssg.opensign-drive-5")}
                isChecked={handleDontShow}
              />
            ),
            position: "bottom",
            styles: { fontSize: "13px" }
          },
          {
            selector: '[data-tut="reactourSixth"]',
            content: () => (
              <TourContentWithBtn
                message={t("tour-mssg.opensign-drive-6")}
                isChecked={handleDontShow}
              />
            ),
            position: "bottom",
            styles: { fontSize: "13px" }
          },
          {
            selector: '[data-tut="reactourSeventh"]',
            content: () => (
              <TourContentWithBtn
                message={t("tour-mssg.opensign-drive-7")}
                isChecked={handleDontShow}
              />
            ),
            position: "bottom",
            styles: { fontSize: "13px" }
          }
        ];
        let newTour = [...tourConfigs, ...addMoreTour];
        const isFolderExist = driveDetails.some(
          (data) => data.Type === "Folder"
        );
        if (!isFolderExist) {
          newTour = newTour.filter(
            (data) => data.selector !== '[data-tut="reactourSeventh"]'
          );
        }
        const isDocumentExist = driveDetails.some((data) => data.URL);
        if (!isDocumentExist) {
          newTour = newTour.filter(
            (data) => data.selector !== '[data-tut="reactourSixth"]'
          );
        }
        setTourData(newTour);
        setSkip((prevSkip) => prevSkip + limit);
        sortingData(null, null, driveDetails, true);
      } else {
        setTourData(tourConfigs);
      }
      if (!docId) {
        setFolderName([
          { name: t("OpenSign-drive", { appName: drivename }), objectId: "" }
        ]);
      }
    } catch (e) {
      setIsAlert({
        isShow: true,
        alertMessage: t("something-went-wrong-mssg")
      });
    } finally {
      setLoading(false);
      setIsLoading({ isLoad: false });
    }
  };

  // Memoize the loader function so it only changes when deps change
  const loadMore = useCallback(() => {
    // Only fetch if we're not already loading and we've got a full "page" (50 items)
    if (!loading && pdfData.length % 50 === 0) {
      // Pass `true` to disable the initial loader UI
      getPdfDocumentList(true);
    }
  }, [loading, pdfData.length, getPdfDocumentList]);

  useEffect(() => {
    const container = document.getElementById("renderList") || null;
    if (!container) return;
    // Set up the IntersectionObserver
    const observer = new IntersectionObserver(
      ([entry]) => {
        // 5. When the sentinel comes fully into view, trigger loadMore()
        if (entry.isIntersecting) loadMore();
      },
      {
        root: container, // Determine the scroll container (null = viewport)
        rootMargin: "0px", // no extra margin
        threshold: 1.0 // fire when 100% of sentinel is visible
      }
    );
    // Start observing the sentinel DOM node
    if (bottomRef.current) observer.observe(bottomRef.current);
    // Clean up on unmount or if loadMore changes
    return () => {
      if (bottomRef.current) observer.unobserve(bottomRef.current);
      observer.disconnect();
    };
  }, [loadMore]);

  //function for handle folder name path
  const handleRoute = (index, folderData) => {
    setSkip(0);
    // after onclick on route filter route from that index
    const updateFolderName = folderName.filter((_, i) => i <= index);
    setFolderName(updateFolderName);
    //get route details after onclick path of folder name
    const getCurrentId = folderData[index];
    const getLastId = updateFolderName[updateFolderName.length - 1];
    //below condition is used to check if user click on same route which already open then don't change any thing
    if (docId !== getCurrentId.objectId) {
      setPdfData([]);
      setDocId(getLastId.objectId);
    }
  };

  //function for add new folder name
  const handleFolderName = (e) => {
    setError();
    const value = e.target.value;
    setNewFolderName(value);
  };
  //function for create folder
  const handleAddFolder = withSessionValidation(async (e) => {
    e.preventDefault();
    if (newFolderName) {
      setIsFolderLoader(true);
      const getParentObjId = folderName[folderName.length - 1];
      const parentId = getParentObjId && getParentObjId.objectId;
      const foldercls = "contracts_Document";
      const folderPtr = {
        __type: "Pointer",
        className: foldercls,
        objectId: parentId
      };
      const CreatedBy = {
        __type: "Pointer",
        className: "_User",
        objectId: jsonCurrentUser.objectId
      };

      try {
        const exsitQuery = new Parse.Query(foldercls);
        exsitQuery.equalTo("Name", newFolderName);
        exsitQuery.equalTo("Type", "Folder");
        exsitQuery.notEqualTo("IsArchive", true);
        if (parentId) {
          exsitQuery.equalTo("Folder", folderPtr);
        }
        const templExist = await exsitQuery.first();
        if (templExist) {
          setError("Folder already exist!");
          setIsFolderLoader(false);
        } else {
          const template = new Parse.Object(foldercls);
          template.set("Name", newFolderName);
          template.set("Type", "Folder");
          const ExtCls = JSON.parse(localStorage.getItem("Extand_Class"));
          template.set("ExtUserPtr", {
            __type: "Pointer",
            className: "contracts_Users",
            objectId: ExtCls[0].objectId
          });
          if (parentId) {
            template.set("Folder", folderPtr);
          }
          template.set("CreatedBy", CreatedBy);
          const res = await template.save();
          if (res) {
            const result = JSON.parse(JSON.stringify(res));

            setPdfData((prev) => [...prev, result]);
            sortingData(null, null, [result], true);
            setNewFolderName();
            setIsFolderLoader(false);
            setIsFolder(false);
          }
        }
      } catch (e) {
        setIsAlert({
          isShow: true,
          alertMessage: t("something-went-wrong-mssg")
        });
      }
    } else {
      setError(t("fill-field"));
    }
  });

  //function to use sorting document list according to type and order
  const sortedBy = (appInfo, type, order) => {
    if (type === orderName.Name) {
      if (order === orderName.Ascending) {
        return appInfo.sort((a, b) =>
          a.Name.toLowerCase() < b.Name.toLowerCase() ? -1 : 1
        );
      } else if (order === orderName.Descending) {
        return appInfo.sort((a, b) =>
          a.Name.toLowerCase() < b.Name.toLowerCase() ? 1 : -1
        );
      }
    } else if (type === orderName.Date) {
      if (order === orderName.Ascending) {
        return appInfo.sort((a, b) => (a.createdAt > b.createdAt ? 1 : -1));
      } else if (order === orderName.Descending) {
        return appInfo.sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1));
      }
    }
  };

  //function to use get sorting type, order and document list to sort
  const sortingData = (type, order, driveDetails, isInitial) => {
    const selectedSortType = type ? type : selectedSort;
    const sortOrder = order ? order : sortingOrder;

    //check isInitial true it means sort previous 20 and get on scrolling 20 = 40 document list
    const allPdfData = isInitial ? [...pdfData, ...driveDetails] : driveDetails;
    //call sortedBy function according to selected Type and order
    if (selectedSortType === orderName.Name) {
      sortedBy(allPdfData, orderName.Name, sortOrder);
    } else if (selectedSortType === orderName.Date) {
      sortedBy(allPdfData, orderName.Date, sortOrder);
    }

    setPdfData(allPdfData);
  };

  //function for handle auto scroll on folder path
  const handleMouseEnter = (e) => {
    let side = "";
    const container = scrollRef.current;
    const containerRect = container.getBoundingClientRect();
    const cursorX = e.clientX;
    const containerX = containerRect.left;
    const containerWidth = containerRect.width;

    // Define a threshold (e.g., 10 pixels) for the start and end points
    const threshold = 10;

    if (cursorX - containerX <= threshold) {
      side = "start";
    } else if (containerX + containerWidth - cursorX <= threshold) {
      side = "end";
    } else {
      side = "";
    }

    const scrollSpeed = 10;
    let scrollAmount = 0;

    const scroll = () => {
      if (side === "start" && container.scrollLeft > 0) {
        container.scrollLeft -= scrollAmount;
        requestAnimationFrame(scroll);
      } else if (
        side === "end" &&
        container.scrollLeft < container.scrollWidth - container.clientWidth
      ) {
        container.scrollLeft += scrollAmount;
        requestAnimationFrame(scroll);
      }
    };

    container.addEventListener("mousemove", (e) => {
      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const containerWidth = rect.width;

      // Calculate the scroll amount based on the cursor's position
      scrollAmount = (x / containerWidth) * scrollSpeed;
    });

    scroll();
  };

  //handle to close drop down menu onclick screen
  useEffect(() => {
    const closeMenuOnOutsideClick = (e) => {
      if (isShowSort && !e.target.closest("#menu-container")) {
        setIsShowSort(!isShowSort);
      } else if (isOptions && !e.target.closest("#folder-menu")) {
        setIsOptions(!isOptions);
      }
    };

    document.addEventListener("click", closeMenuOnOutsideClick);

    return () => {
      // Cleanup the event listener when the component unmounts
      document.removeEventListener("click", closeMenuOnOutsideClick);
    };
    // eslint-disable-next-line
  }, [isShowSort, isOptions]);

  const handleFolderTab = (folderData) => {
    return folderData.map((data, id) => {
      const isLast = id === folderData.length - 1;
      return (
        <React.Fragment key={id}>
          {id > 0 && (
            <i className="fa-light fa-chevron-right text-[10px] text-base-content/40 mx-1"></i>
          )}
          <span
            onClick={() => handleRoute(id, folderData)}
            className={`transition-colors text-xs md:text-sm ${
              isLast
                ? "text-base-content font-bold cursor-default"
                : "text-base-content/70 hover:text-primary font-medium cursor-pointer"
            }`}
          >
            {data.name}
          </span>
        </React.Fragment>
      );
    });
  };
  const oncloseFolder = () => {
    setIsFolder(false);
    setNewFolderName("");
    setError("");
  };

  const handleDontShow = (isChecked) => {
    setIsDontShow(isChecked);
  };

  const closeTour = async () => {
    setIsTour(false);
    setShowTourFirstTime(false);
    if (isDontShow) {
      const serverUrl = localStorage.getItem("baseUrl");
      const appId = localStorage.getItem("parseAppId");
      const json = JSON.parse(localStorage.getItem("Extand_Class"));
      const extUserId = json && json.length > 0 && json[0].objectId;
      let updatedTourStatus = [];
      if (tourStatusArr.length > 0) {
        updatedTourStatus = [...tourStatusArr];
        const driveTourIndex = tourStatusArr.findIndex(
          (obj) => obj["driveTour"] === false || obj["driveTour"] === true
        );
        if (driveTourIndex !== -1) {
          updatedTourStatus[driveTourIndex] = { driveTour: true };
        } else {
          updatedTourStatus.push({ driveTour: true });
        }
      } else {
        updatedTourStatus = [{ driveTour: true }];
      }
      await axios.put(
        serverUrl + "classes/contracts_Users/" + extUserId,
        {
          TourStatus: updatedTourStatus
        },
        {
          headers: {
            "X-Parse-Application-Id": appId
          }
        }
      );
    }
  };
  //function to use check tour status of open sign drive
  async function checkTourStatus() {
    const cloudRes = await Parse.Cloud.run("getUserDetails");
    if (cloudRes) {
      const extUser = JSON.parse(JSON.stringify(cloudRes));
      localStorage.setItem("Extand_Class", JSON.stringify([extUser]));
      const tourStatus = extUser?.TourStatus || [];
      setTourStatusArr(tourStatus);
      const driveTour = tourStatus.find((obj) => obj.driveTour)?.driveTour;
      setIsTour(!driveTour);
    } else {
      setIsTour(true);
    }
  }

  const handleSearchChange = async (e) => {
    const name = e.target.value.toLowerCase();
    setSearchTerm(name);
    // Clear previous timer
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }
    // Start new debounce timer
    debounceTimer.current = setTimeout(async () => {
      try {
        const res = await Parse.Cloud.run("filterdocs", { searchTerm: name });
        setPdfData(JSON.parse(JSON.stringify(res)));
      } catch (err) {
        console.error("Search error:", err);
        notify.error(`Error: ${err.message}`);
      }
    }, 300);
  };

  const handleSearchPaste = (e) => {
    setTimeout(() => {
      handleSearchChange({ target: { value: e.target.value } });
    }, 0);
  };
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, []);

  const handleHighlightClick = () => {
    setIsTour(false);
    setShowTourFirstTime(false);
  };

  const handleFolderOptions = () => {
    setIsOptions(!isOptions);
    handleHighlightClick();
  };

  const handleSortOptions = () => {
    setIsShowSort(!isShowSort);
    handleHighlightClick();
  };

  const handleViewOption = () => {
    setIsList(!isList);
    handleHighlightClick();
  };
  return (
    <div className="w-full flex-1 flex flex-col">
      <ModalUi
        isOpen={isAlert.isShow}
        title={t("alert")}
        handleClose={() => {
          setIsAlert({ isShow: false, alertMessage: "" });
        }}
      >
        <div className="p-5 text-base-content">
          <p className="text-sm mb-4">{isAlert.alertMessage}</p>
          <div className="flex justify-end">
            <button
              onClick={() => setIsAlert({ isShow: false, alertMessage: "" })}
              type="button"
              className="op-btn op-btn-neutral op-btn-sm rounded-lg"
            >
              {t("close")}
            </button>
          </div>
        </div>
      </ModalUi>

      <ModalUi
        isOpen={isFolder}
        title={t("add-new-folder")}
        handleClose={oncloseFolder}
      >
        <div className="p-5 text-base-content">
          {folderLoader ? (
            <div className="h-[150px] flex justify-center items-center">
              <Loader />
            </div>
          ) : (
            <form
              onSubmit={handleAddFolder}
              className="flex flex-col text-base-content"
            >
              <label className="text-xs font-semibold mb-1.5 text-base-content">
                {t("name")}
                <span className="text-error ml-0.5">*</span>
              </label>
              <input
                onInvalid={(e) =>
                  e.target.setCustomValidity(t("input-required"))
                }
                onInput={(e) => e.target.setCustomValidity("")}
                required
                className="op-input op-input-bordered op-input-sm text-xs rounded-lg focus:outline-none hover:border-base-content"
                type="text"
                placeholder={t("folder-name-placeholder") || "Nombre de la carpeta"}
                value={newFolderName}
                onChange={(e) => handleFolderName(e)}
              />
              {error && <span className="text-error text-xs mt-1.5">{error}</span>}
              <div className="flex justify-end gap-2 mt-5">
                <button
                  type="button"
                  className="op-btn op-btn-ghost op-btn-sm rounded-lg text-base-content"
                  onClick={oncloseFolder}
                >
                  {t("close")}
                </button>
                <button type="submit" className="op-btn op-btn-primary op-btn-sm rounded-lg">
                  {t("add")}
                </button>
              </div>
            </form>
          )}
        </div>
      </ModalUi>

      {isLoading.isLoad ? (
        <div className="flex flex-col justify-center items-center h-[70vh] w-full">
          <Loader />
          <span className="text-xs text-base-content/70 mt-2">
            {isLoading.message}
          </span>
        </div>
      ) : handleError ? (
        <div className="flex justify-center items-center h-[70vh] w-full">
          <span className="text-sm font-medium text-error">{handleError}</span>
        </div>
      ) : (
        <div className="op-card w-full p-3 sm:p-4 md:p-6 flex-1 flex flex-col shadow-sm">
          {tourData && (
            <Tour
              onRequestClose={closeTour}
              steps={tourData}
              isOpen={isTour}
              scrollOffset={-100}
            />
          )}

          {/* Header estandarizado con la estética de Form.jsx */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-3.5 mb-4 border-b border-base-200">
            {/* Izquierda: Icono + Breadcrumbs + Badge + Subtítulo */}
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center flex-shrink-0 text-lg">
                <i className="fa-light fa-folder-tree"></i>
              </div>
              <div className="flex flex-col">
                <div
                  data-tut="reactourFirst"
                  onMouseEnter={(e) => handleMouseEnter(e)}
                  onClick={handleHighlightClick}
                  ref={scrollRef}
                  className="flex items-center gap-2 flex-wrap"
                >
                  <div className="flex items-center gap-1 flex-wrap">
                    {handleFolderTab(folderName)}
                  </div>
                  <span className="op-badge op-badge-primary op-badge-outline text-[11px] font-medium py-1.5 px-2">
                    Drive
                  </span>
                </div>
                <p className="text-xs text-base-content/60 mt-0.5">
                  {t("drive-subtitle") && t("drive-subtitle") !== "drive-subtitle"
                    ? t("drive-subtitle")
                    : "Organiza, gestiona y firma tus documentos y carpetas en la nube"}
                </p>
              </div>
            </div>

            {/* Derecha: Buscador + Nuevo + Ordenar + Toggle Grid/List */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Desktop search input */}
              <div className="relative hidden md:block">
                <i className="fa-light fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-base-content/40 text-xs pointer-events-none"></i>
                <input
                  type="search"
                  value={searchTerm}
                  onChange={handleSearchChange}
                  placeholder={t("search-documents")}
                  onPaste={handleSearchPaste}
                  className="op-input op-input-bordered op-input-sm pl-8 pr-3 focus:outline-none hover:border-base-content w-48 lg:w-56 text-xs rounded-lg"
                />
              </div>

              {/* Mobile search toggle */}
              <button
                className="md:hidden op-btn op-btn-ghost op-btn-sm op-btn-square text-base-content"
                aria-label="Search"
                onClick={() => setMobileSearchOpen((open) => !open)}
              >
                <i className="fa-light fa-magnifying-glass text-base"></i>
              </button>

              {/* Botón Nuevo con Menú desplegable */}
              <div
                id="folder-menu"
                className="relative"
                data-tut="reactourSecond"
              >
                <button
                  type="button"
                  onClick={handleFolderOptions}
                  className="op-btn op-btn-primary op-btn-sm rounded-lg gap-1.5 font-medium shadow-sm"
                >
                  <i className="fa-light fa-plus text-sm"></i>
                  <span className="hidden sm:inline">{t("Nuevo") || "Nuevo"}</span>
                  <i className="fa-light fa-chevron-down text-[10px] opacity-70"></i>
                </button>
                {isOptions && (
                  <div
                    className="absolute left-0 sm:left-auto sm:right-0 mt-1.5 w-52 bg-base-100 border border-base-200 shadow-xl rounded-xl p-1.5 z-[900] text-base-content"
                    onClick={() => setIsOptions(false)}
                  >
                    <button
                      type="button"
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-xs rounded-lg hover:bg-base-200/60 transition-colors text-left font-medium"
                      onClick={() => setIsFolder(true)}
                    >
                      <i className="fa-light fa-folder-plus text-primary text-sm"></i>
                      <span>{t("create-folder")}</span>
                    </button>
                    <button
                      type="button"
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-xs rounded-lg hover:bg-base-200/60 transition-colors text-left font-medium"
                      onClick={() => navigate("/form/sHAnZphf69")}
                    >
                      <i className="fa-light fa-pen-nib text-secondary text-sm"></i>
                      <span>{t("Sign Yourself")}</span>
                    </button>
                    <button
                      type="button"
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-xs rounded-lg hover:bg-base-200/60 transition-colors text-left font-medium"
                      onClick={() => navigate("/form/8mZzFxbG1z")}
                    >
                      <i className="fa-light fa-file-signature text-accent text-sm"></i>
                      <span>{t("Request Signatures")}</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Botón Ordenar */}
              <div
                id="menu-container"
                className="relative"
                data-tut="reactourThird"
              >
                <button
                  type="button"
                  onClick={handleSortOptions}
                  className="op-btn op-btn-ghost op-btn-sm border border-base-200 rounded-lg gap-1.5 text-xs text-base-content"
                >
                  <i className="fa-light fa-arrow-down-short-wide text-sm text-base-content/70"></i>
                  <span className="font-normal">{t(`sort-order.${selectedSort}`) || selectedSort}</span>
                  <i className="fa-light fa-chevron-down text-[10px] opacity-60"></i>
                </button>
                {isShowSort && (
                  <div
                    className="absolute right-0 mt-1.5 w-44 bg-base-100 border border-base-200 shadow-xl rounded-xl p-1.5 z-[900] text-base-content"
                    onClick={() => setIsShowSort(false)}
                  >
                    <div className="px-2 py-1 text-[11px] font-semibold text-base-content/50 uppercase tracking-wider">
                      {t("sort-by") || "Ordenar por"}
                    </div>
                    {sortingValue.map((value, ind) => (
                      <button
                        key={ind}
                        type="button"
                        onClick={() => {
                          setSelectedSort(value);
                          sortingData(value, null, pdfData);
                        }}
                        className={`w-full flex items-center justify-between px-2.5 py-1.5 text-xs rounded-lg transition-colors ${
                          selectedSort === value
                            ? "bg-primary/10 text-primary font-semibold"
                            : "hover:bg-base-200/60 text-base-content"
                        }`}
                      >
                        <span>{t(`sort-order.${value}`)}</span>
                        {selectedSort === value && (
                          <i className="fa-light fa-check text-xs"></i>
                        )}
                      </button>
                    ))}
                    <div className="h-[1px] bg-base-200 my-1"></div>
                    <div className="px-2 py-1 text-[11px] font-semibold text-base-content/50 uppercase tracking-wider">
                      {t("order") || "Dirección"}
                    </div>
                    {sortOrder.map((order, ind) => (
                      <button
                        key={ind}
                        type="button"
                        onClick={() => {
                          setSortingOrder(order);
                          sortingData(null, order, pdfData);
                        }}
                        className={`w-full flex items-center justify-between px-2.5 py-1.5 text-xs rounded-lg transition-colors ${
                          sortingOrder === order
                            ? "bg-primary/10 text-primary font-semibold"
                            : "hover:bg-base-200/60 text-base-content"
                        }`}
                      >
                        <span>{t(`sort-order.${order}`)}</span>
                        {sortingOrder === order && (
                          <i className="fa-light fa-check text-xs"></i>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Botón Toggle Vista Grid / Lista */}
              <div
                className="join border border-base-200 rounded-lg p-0.5"
                data-tut="reactourForth"
              >
                <button
                  type="button"
                  onClick={() => {
                    if (isList) handleViewOption();
                  }}
                  className={`op-btn op-btn-xs rounded-md ${
                    !isList
                      ? "op-btn-active bg-base-200 text-base-content shadow-sm"
                      : "op-btn-ghost text-base-content/60"
                  }`}
                  title={t("view-grid") || "Cuadrícula"}
                >
                  <i className="fa-light fa-grid-2 text-xs"></i>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!isList) handleViewOption();
                  }}
                  className={`op-btn op-btn-xs rounded-md ${
                    isList
                      ? "op-btn-active bg-base-200 text-base-content shadow-sm"
                      : "op-btn-ghost text-base-content/60"
                  }`}
                  title={t("view-list") || "Lista"}
                >
                  <i className="fa-light fa-list text-xs"></i>
                </button>
              </div>
            </div>
          </div>

          {/* Mobile search bar expands below header */}
          {mobileSearchOpen && (
            <div className="w-full pb-3 md:hidden">
              <input
                type="search"
                value={searchTerm}
                onChange={handleSearchChange}
                placeholder={t("search-documents")}
                onPaste={handleSearchPaste}
                className="op-input op-input-bordered op-input-sm focus:outline-none hover:border-base-content w-full text-xs rounded-lg"
              />
            </div>
          )}

          {/* Body Content */}
          {pdfData && pdfData.length === 0 ? (
            <div className="flex-1 flex flex-col justify-center items-center py-16 text-center">
              <div className="w-16 h-16 rounded-2xl bg-base-200/70 text-base-content/30 flex items-center justify-center text-3xl mb-3">
                <i className="fa-light fa-folder-open"></i>
              </div>
              <h3 className="text-sm font-semibold text-base-content mb-1">
                {t("empty-folder-title") || "Esta carpeta está vacía"}
              </h3>
              <p className="text-xs text-base-content/60 max-w-sm mb-4">
                {t("empty-folder-desc") ||
                  "Crea una nueva carpeta o genera documentos para comenzar a organizar tu espacio de trabajo."}
              </p>
              <button
                type="button"
                onClick={() => setIsFolder(true)}
                className="op-btn op-btn-primary op-btn-sm rounded-lg gap-2"
              >
                <i className="fa-light fa-folder-plus"></i>
                <span>{t("create-folder")}</span>
              </button>
            </div>
          ) : (
            <div data-tut="reactourFifth" className="flex-1 flex flex-col">
              <React.Suspense fallback={<AppLoader />}>
                <DriveBody
                  dataTutSixth="reactourSixth"
                  dataTutSeventh="reactourSeventh"
                  pdfData={pdfData}
                  setFolderName={setFolderName}
                  setIsLoading={setIsLoading}
                  setDocId={setDocId}
                  getPdfDocumentList={getPdfDocumentList}
                  isDocId={docId}
                  setPdfData={setPdfData}
                  isList={isList}
                  setIsAlert={setIsAlert}
                  setSkip={setSkip}
                  sortingData={sortingData}
                />
                {/* sentinel */}
                <div ref={bottomRef} className="h-1" />
                {loading && (
                  <div className="text-center py-3 text-xs text-base-content/60">
                    <Loader />
                  </div>
                )}
              </React.Suspense>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default Opensigndrive;
