import React, { useEffect, useMemo, useState } from "react";
import Parse from "parse";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  KeyRound,
  RotateCcw,
  Search,
  ShieldAlert,
  Trash2,
  UserPlus,
  Users,
  X
} from "lucide-react";
import Loader from "../primitives/Loader";
import { useLocation } from "react-router";
import ModalUi from "../primitives/ModalUi";
import pad from "../assets/images/pad.svg";
import Tooltip from "../primitives/Tooltip";
import AddUser from "../components/AddUser";
import {
  useTranslation
} from "react-i18next";
import DeleteUserModal from "../primitives/DeleteUserModal";
import axios from "axios";
import PasswordResetModal from "../primitives/PasswordResetModal";
import { usersActions } from "../json/ReportJson";
import { notify, withSessionValidation } from "../utils";
import RoleBadge from "../components/users/RoleBadge";
import ToggleStatusModal from "../components/users/ToggleStatusModal";
import { useUserListFilters } from "../hook/useUserListFilters";

const heading = ["Sr.No", "Name", "Email", "Phone", "Role", "Team", "Active"];

const ROLE_OPTIONS = ["Admin", "OrgAdmin", "Editor", "User"];

const ACTION_ICONS = {
  trash: Trash2,
  key: KeyRound
};

const UserList = () => {
  const { t } = useTranslation();
  const [userList, setUserList] = useState([]);
  const [isLoader, setIsLoader] = useState(false);
  const [isModal, setIsModal] = useState({
    form: false,
    addseats: false,
    options: false
  });
  const location = useLocation();
  const isDashboard =
    location?.pathname === "/dashboard/35KBoSgoAK" ? true : false;
  const [isActiveModal, setIsActiveModal] = useState({});
  const [isActLoader, setIsActLoader] = useState({});
  const [isAdmin, setIsAdmin] = useState(false);
  const [formHeader, setFormHeader] = useState(t("add-user"));
  const [deleteUserRes, setDeleteUserRes] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [isActModal, setIsActModal] = useState({});
  const Extand_Class = localStorage.getItem("Extand_Class");
  const extClass = Extand_Class && JSON.parse(Extand_Class);

  const {
    searchQuery,
    setSearchQuery,
    roleFilter,
    setRoleFilter,
    statusFilter,
    setStatusFilter,
    teamFilter,
    setTeamFilter,
    sortBy,
    setSortBy,
    recordPerPage,
    setRecordPerPage,
    availableTeams,
    filteredUserList,
    hasActiveFilters,
    totalFilteredPages,
    safePage,
    setCurrentPage,
    startIndex,
    pageNumbers,
    currentList,
    rangeFrom,
    rangeTo,
    handleClearFilters,
    paginateFront,
    paginateBack
  } = useUserListFilters(userList);

  const activeDeleteUser = useMemo(
    () => userList.find((u) => Boolean(isActModal["delete_" + u.objectId])),
    [userList, isActModal]
  );
  const activeResetUser = useMemo(
    () =>
      userList.find((u) => Boolean(isActModal["resetpassword_" + u.objectId])),
    [userList, isActModal]
  );
  const activeToggleUser = useMemo(
    () => userList.find((u) => Boolean(isActiveModal[u.objectId])),
    [userList, isActiveModal]
  );
  useEffect(() => {
    fetchUserList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function fetchUserList() {
    try {
      setIsLoader(true);
      const extUser =
        localStorage.getItem("Extand_Class") &&
        JSON.parse(localStorage.getItem("Extand_Class"))?.[0];

      if (extUser) {
        const admin =
          extUser?.UserRole &&
          (extUser?.UserRole === "contracts_Admin" ||
            extUser?.UserRole === "contracts_OrgAdmin")
            ? true
            : false;
        setIsAdmin(admin);
      }
      const res = await Parse.Cloud.run("getuserlistbyorg", {
        organizationId: extUser.OrganizationId.objectId
      });
      const _userRes = JSON.parse(JSON.stringify(res));
      setUserList(_userRes);
    } catch (err) {
      console.log("Err in fetch userlist", err);
      notify.error(t("something-went-wrong-mssg"));
    } finally {
      setIsLoader(false);
    }
  }
  const handleModal = (modalName) => {
    setIsModal((obj) => ({ ...obj, [modalName]: !obj[modalName] }));
  };

  const handleUserData = (userData) => {
    if (userData) {
      setUserList((prev) => [userData, ...prev]);
    }
  };
  // `formatRow` is used to show data in poper manner like
  // if data is of array type then it will join array items with ","
  // if data is of object type then it Name values will be show in row
  // if no data available it will show hyphen "-"
  const formatRow = (row) => {
    if (Array.isArray(row)) {
      let updateArr = row.map((x) => x.Name);
      return updateArr.join(", ");
    } else if (typeof row === "object" && row !== null) {
      return row?.Name || "-";
    } else {
      return "-";
    }
  };
  const handleClose = () => setIsActiveModal({});

  const handleToggleSubmit = withSessionValidation(async (user) => {
    const index = userList.findIndex((obj) => obj.objectId === user.objectId);
    if (index !== -1) {
      setIsActiveModal({});
      setIsActLoader({ [user.objectId]: true });
      const newArray = [...userList];
      const IsDisabled = newArray[index]?.IsDisabled;
      newArray[index] = { ...newArray[index], IsDisabled: !IsDisabled };
      setUserList(newArray);
      try {
        const extUser = new Parse.Object("contracts_Users");
        extUser.id = user.objectId;
        extUser.set("IsDisabled", !IsDisabled);
        await extUser.save();
        if (!IsDisabled === true) {
          notify.error(t("user-deactivated"));
        } else {
          notify.success(t("user-activated"));
        }
      } catch (err) {
        notify.error(t("something-went-wrong-mssg"));
        console.log("err in disable team", err);
      } finally {
        setIsActLoader({});
      }
    }
  });
  const handleToggleBtn = (user) => {
    setIsActiveModal({ [user.objectId]: true });
  };

  const handleDeleteAccount = withSessionValidation(async (item) => {
    setDeleting(true);
    if (item?.UserId?.objectId) {
      const url = localStorage.getItem("baseUrl")?.replace(/\/app\/?$/, "/");
      const deleteUrl = `${url}deleteuser/${item.UserId.objectId}`;
      try {
        await axios.post(deleteUrl, null, {
          headers: { sessiontoken: localStorage.getItem("accesstoken") }
        });
        setUserList((prev) =>
          prev.filter((user) => user.objectId !== item.objectId)
        );
        notify.success(t("user-deleted-successfully"));
      } catch (err) {
        const message = err?.response?.data?.message || err?.message;
        setDeleteUserRes(message);
        notify.error(message);
        console.log("Err in deleteuser acc", err);
      } finally {
        setDeleting(false);
      }
    } else {
      notify.error(t("something-went-wrong-mssg"));
      setDeleteUserRes(t("something-went-wrong-mssg"));
      setDeleting(false);
    }
  });
  const handleCloseModal = () => {
    setIsActModal({});
    setDeleteUserRes("");
    setDeleting(false);
  };

  const handleActionBtn = withSessionValidation(async (act, item) => {
      setIsActModal({ [`${act.action}_${item.objectId}`]: true });
  });
  const handleBtnVisibility = (act, item) => {
    if (act.restrictAdmin) {
      if (item?.UserRole === "contracts_Admin") {
        return false;
      } else {
        return item?.objectId !== extClass?.[0]?.objectId;
      }
    } else if (
      act.restrictBtn === true &&
      item?.objectId === extClass?.[0]?.objectId
    ) {
      return true;
    } else {
      return true;
    }
  };
  const handleActiveToggleVisibility = (item) => {
    if (item?.UserRole === "contracts_Admin") {
      return false;
    } else {
      return item?.objectId !== extClass?.[0]?.objectId;
    }
  };

  const submitPassword = withSessionValidation(async (userId, password) => {
    setIsLoader(true);
    setIsActModal({});
    try {
      const params = { userId, password };
      await Parse.Cloud.run("resetpassword", params);
      notify.success(t("password-has-been-reset"));
    } catch (err) {
      console.log("err while reset password", err);
      notify.error(t(err.message));
    } finally {
      setIsLoader(false);
    }
  });
  return (
    <div className="relative flex-1 flex flex-col">
      {isLoader && (
        <div className="absolute w-full h-[300px] md:h-[400px] flex justify-center items-center z-30 rounded-box">
          <Loader />
        </div>
      )}
      {Object.keys(isActLoader)?.length > 0 && (
        <div className="absolute w-full h-full flex justify-center items-center bg-black/30 z-30 rounded-box">
          <Loader />
        </div>
      )}

      {
          !isLoader && (
            <>
              {isAdmin ? (
                <div className="p-2 w-full bg-base-100 text-base-content op-card flex-1 flex flex-col">

                  <div className="flex flex-col gap-4 mx-3 my-2">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                          <Users size={18} aria-hidden="true" />
                        </div>
                        <div>
                          <div className="text-[20px] md:text-[23px] font-light flex items-center gap-1">
                            {t("report-name.Users")}
                            <span className="text-xs md:text-[13px] font-normal">
                              <Tooltip message={t("users-from-teams")} />
                            </span>
                          </div>
                          <p className="text-sm text-base-content/60">
                            {t("users-page-subtitle")}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="op-btn op-btn-primary shrink-0"
                        onClick={() => handleModal("form")}
                      >
                        <UserPlus size={18} aria-hidden="true" />
                        {t("add-user")}
                      </button>
                    </div>
                    <div className="bg-base-200/40 border border-base-200/80 rounded-xl p-3 flex flex-wrap items-center gap-2.5">
                      <div className="relative flex-1 min-w-[200px] max-w-sm">
                        <Search
                          size={14}
                          aria-hidden="true"
                          className="absolute left-3 top-1/2 -translate-y-1/2 text-base-content/50 pointer-events-none"
                        />
                        <input
                          type="text"
                          data-testid="user-search-input"
                          aria-label={t("search-users-placeholder")}
                          className="op-input op-input-bordered op-input-sm w-full pl-8 pr-7 text-xs focus:outline-none focus:border-primary"
                          placeholder={t("search-users-placeholder")}
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                        />
                        {searchQuery && (
                          <button
                            type="button"
                            onClick={() => setSearchQuery("")}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-base-content/40 hover:text-base-content p-0.5 rounded-full"
                            aria-label={t("clear-filters")}
                          >
                            <X size={12} />
                          </button>
                        )}
                      </div>
                      <select
                        data-testid="user-role-filter"
                        aria-label={t("report-heading.Role")}
                        className="op-select op-select-bordered op-select-sm focus:outline-none focus:border-primary text-xs"
                        value={roleFilter}
                        onChange={(e) => setRoleFilter(e.target.value)}
                      >
                        <option value="all">{t("all-roles")}</option>
                        {ROLE_OPTIONS.map((role) => (
                          <option key={role} value={role}>
                            {role}
                          </option>
                        ))}
                      </select>
                      <select
                        data-testid="user-status-filter"
                        aria-label={t("report-heading.Status")}
                        className="op-select op-select-bordered op-select-sm focus:outline-none focus:border-primary text-xs"
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                      >
                        <option value="all">{t("all-statuses")}</option>
                        <option value="active">{t("status-active")}</option>
                        <option value="inactive">{t("status-inactive")}</option>
                      </select>
                      {availableTeams.length > 0 && (
                        <select
                          data-testid="user-team-filter"
                          aria-label={t("report-heading.Team")}
                          className="op-select op-select-bordered op-select-sm focus:outline-none focus:border-primary text-xs"
                          value={teamFilter}
                          onChange={(e) => setTeamFilter(e.target.value)}
                        >
                          <option value="all">{t("all-teams")}</option>
                          <option value="none">{t("no-team")}</option>
                          {availableTeams.map((team) => (
                            <option key={team.id} value={team.id}>
                              {team.name}
                            </option>
                          ))}
                        </select>
                      )}
                      <select
                        data-testid="user-sort-filter"
                        aria-label={t("sort-by")}
                        className="op-select op-select-bordered op-select-sm focus:outline-none focus:border-primary text-xs"
                        value={sortBy}
                        onChange={(e) => setSortBy(e.target.value)}
                      >
                        <option value="default">{t("sort-default")}</option>
                        <option value="name-asc">{t("sort-name-asc")}</option>
                        <option value="name-desc">{t("sort-name-desc")}</option>
                        <option value="role">{t("sort-role")}</option>
                      </select>
                      {hasActiveFilters && (
                        <button
                          type="button"
                          data-testid="clear-filters-btn"
                          onClick={handleClearFilters}
                          className="op-btn op-btn-ghost op-btn-sm text-xs gap-1.5 text-base-content/70 hover:text-base-content hover:bg-base-200"
                          title={t("clear-filters")}
                        >
                          <RotateCcw size={13} />
                          <span>{t("clear-filters")}</span>
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="w-full overflow-x-auto flex-1 flex flex-col">
                    <table className="op-table border-collapse w-full mb-[50px]">
                      <thead className="text-[14px]">
                        <tr className="border-y-[1px]">
                          {heading?.map((item, index) => (
                            <th key={index} className="px-4 py-2">
                              {t(`report-heading.${item}`)}
                            </th>
                          ))}
                          {usersActions?.length > 0 && (
                            <th className="p-2 text-transparent pointer-events-none">
                              {t("action")}
                            </th>
                          )}
                        </tr>
                      </thead>
                      {filteredUserList?.length > 0 && (
                        <tbody className="text-[12px]">
                          {currentList.map((item, index) => (
                            <tr className="border-y-[1px]" key={item.objectId}>
                              {heading.includes("Sr.No") && (
                                <th className="px-4 py-2">
                                  {startIndex + index + 1}
                                </th>
                              )}
                              <td className="px-4 py-2 font-semibold">
                                {item?.Name}{" "}
                              </td>
                              <td className="px-4 py-2 ">
                                {item?.Email || "-"}
                              </td>
                              <td className="px-4 py-2">
                                {item?.Phone || "-"}
                              </td>
                              <td className="px-4 py-2">
                                <RoleBadge role={item?.UserRole?.split("_").pop()} />
                              </td>
                              <td className="px-4 py-2">
                                {formatRow(item.TeamIds)}
                              </td>
                              {handleActiveToggleVisibility(item) ? (
                                <td className="px-4 py-2 font-semibold">
                                  <label
                                    htmlFor={`isdisabled-${item.objectId}`}
                                    className="cursor-pointer relative block items-center mb-0"
                                  >
                                    <input
                                      id={`isdisabled-${item.objectId}`}
                                      type="checkbox"
                                      aria-label={`${t("user-status")} — ${item?.Name}`}
                                      className="op-toggle checked:[--tglbg:oklch(var(--p))] transition-all checked:text-primary-content"
                                      checked={item?.IsDisabled !== true}
                                      onChange={() => handleToggleBtn(item)}
                                    />
                                  </label>
                                </td>
                              ) : (
                                <td className="px-4 py-2 font-semibold"></td>
                              )}

                              {isAdmin && (
                                <td className="px-3 py-2">
                                  <div className="text-base-content min-w-max flex flex-row gap-x-2 gap-y-1 justify-start items-center">
                                    {usersActions?.length > 0 &&
                                      usersActions?.map((act, index) => {
                                        const ActionIcon =
                                          ACTION_ICONS[act.iconName];
                                        const label = t(
                                          `btnLabel.${act.hoverLabel}`
                                        );
                                        return (
                                          <React.Fragment key={index}>
                                            {handleBtnVisibility(act, item) && (
                                              <button
                                                type="button"
                                                data-tut={act?.selector}
                                                onClick={() =>
                                                  handleActionBtn(act, item)
                                                }
                                                title={label}
                                                aria-label={label}
                                                className={
                                                  act.action !== "option"
                                                    ? `${act?.btnColor || ""} op-btn op-btn-sm mr-1 `
                                                    : "text-base-content focus:outline-none text-lg mr-2 relative"
                                                }
                                              >
                                                {ActionIcon && (
                                                  <ActionIcon
                                                    size={14}
                                                    aria-hidden="true"
                                                  />
                                                )}
                                                {act.btnLabel && (
                                                  <span className="uppercase font-medium">
                                                    {t(
                                                      `btnLabel.${act.btnLabel}`
                                                    )}
                                                  </span>
                                                )}
                                              </button>
                                            )}
                                          </React.Fragment>
                                        );
                                      })}
                                  </div>
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      )}
                    </table>
                  </div>
                  <div className="flex flex-col sm:flex-row justify-between items-center gap-3 text-xs font-medium py-3 border-t border-base-200 mt-auto">
                    <div className="flex flex-wrap items-center gap-3">
                      {filteredUserList.length > 0 && (
                        <div
                          role="status"
                          aria-live="polite"
                          aria-atomic="true"
                          className="text-base-content/60"
                        >
                          {t("showing-range-of-total", {
                            from: rangeFrom,
                            to: rangeTo,
                            total: filteredUserList.length
                          })}
                        </div>
                      )}
                      {filteredUserList.length > 10 && (
                        <div className="flex items-center gap-1.5">
                          <span className="text-base-content/60">
                            {t("rows-per-page")}
                          </span>
                          <select
                            data-testid="rows-per-page-select"
                            aria-label={t("rows-per-page")}
                            className="op-select op-select-bordered op-select-xs focus:outline-none"
                            value={recordPerPage}
                            onChange={(e) =>
                              setRecordPerPage(Number(e.target.value))
                            }
                          >
                            <option value={10}>10</option>
                            <option value={25}>25</option>
                            <option value={50}>50</option>
                            <option value={100}>100</option>
                          </select>
                        </div>
                      )}
                    </div>
                    <div className="op-join flex flex-wrap items-center">
                      {safePage > 1 && totalFilteredPages > 2 && (
                        <button
                          type="button"
                          onClick={() => setCurrentPage(1)}
                          className="op-join-item op-btn op-btn-sm"
                          title={t("first")}
                          aria-label={t("first")}
                        >
                          <ChevronsLeft size={14} />
                        </button>
                      )}
                      {filteredUserList.length > recordPerPage && (
                        <button
                          type="button"
                          onClick={() => paginateBack()}
                          disabled={safePage <= 1}
                          className="op-join-item op-btn op-btn-sm gap-1"
                        >
                          <ChevronLeft size={14} />
                          {t("prev")}
                        </button>
                      )}
                      {pageNumbers.map((x, i) => (
                        <button
                          type="button"
                          key={i}
                          onClick={() => typeof x === "number" && setCurrentPage(x)}
                          disabled={x === "..."}
                          className={`${
                            x === safePage
                              ? "op-btn-active op-btn-primary text-primary-content"
                              : ""
                          } op-join-item op-btn op-btn-sm min-w-[34px]`}
                        >
                          {x}
                        </button>
                      ))}
                      {filteredUserList.length > recordPerPage && (
                        <button
                          type="button"
                          onClick={() => paginateFront()}
                          disabled={safePage >= totalFilteredPages}
                          className="op-join-item op-btn op-btn-sm gap-1"
                        >
                          {t("next")}
                          <ChevronRight size={14} />
                        </button>
                      )}
                      {safePage < totalFilteredPages && totalFilteredPages > 2 && (
                        <button
                          type="button"
                          onClick={() => setCurrentPage(totalFilteredPages)}
                          className="op-join-item op-btn op-btn-sm"
                          title={t("last")}
                          aria-label={t("last")}
                        >
                          <ChevronsRight size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                  {filteredUserList?.length <= 0 && (
                    <div
                      className={`${
                        isDashboard ? "h-[317px]" : "flex-1 min-h-[360px]"
                      } flex flex-col items-center justify-center w-full bg-base-100 text-base-content rounded-xl py-12 gap-3`}
                    >
                      <div className="w-[60px] h-[60px] overflow-hidden">
                        <img
                          className="w-full h-full object-contain"
                          src={pad}
                          alt="img"
                        />
                      </div>
                      {hasActiveFilters ? (
                        <>
                          <div
                            role="status"
                            aria-live="polite"
                            className="text-sm font-semibold"
                          >
                            {t("no-results-found-title")}
                          </div>
                          <p className="text-xs text-base-content/60">
                            {t("no-results-found-subtitle")}
                          </p>
                          <button
                            type="button"
                            className="op-btn op-btn-sm"
                            onClick={handleClearFilters}
                          >
                            {t("clear-filters")}
                          </button>
                        </>
                      ) : (
                        <>
                          <div
                            role="status"
                            aria-live="polite"
                            className="text-sm font-semibold"
                          >
                            {t("no-data-available")}
                          </div>
                          <button
                            type="button"
                            className="op-btn op-btn-primary op-btn-sm"
                            onClick={() => handleModal("form")}
                          >
                            <UserPlus size={16} aria-hidden="true" />
                            {t("add-user")}
                          </button>
                        </>
                      )}
                    </div>
                  )}
                  <ModalUi
                    isOpen={isModal.form}
                    title={formHeader}
                    handleClose={() => handleModal("form")}
                  >
                    <AddUser
                      handleUserData={handleUserData}
                      closePopup={() => handleModal("form")}
                      setFormHeader={setFormHeader}
                    />
                  </ModalUi>
                  {activeToggleUser && (
                    <ToggleStatusModal
                      item={activeToggleUser}
                      onConfirm={handleToggleSubmit}
                      onClose={handleClose}
                      t={t}
                    />
                  )}
                  {activeDeleteUser && (
                    <DeleteUserModal
                      title={t("delete-account")}
                      deleting={deleting}
                      userEmail={activeDeleteUser?.Email || ""}
                      isOpen={Boolean(activeDeleteUser)}
                      onConfirm={() =>
                        activeDeleteUser && handleDeleteAccount(activeDeleteUser)
                      }
                      deleteRes={deleteUserRes}
                      handleClose={handleCloseModal}
                    />
                  )}
                  {activeResetUser && (
                    <PasswordResetModal
                      isOpen={Boolean(activeResetUser)}
                      userId={activeResetUser?.UserId?.objectId}
                      onClose={handleCloseModal}
                      onSubmit={submitPassword}
                    />
                  )}
                </div>
              ) : (
                <div className="flex items-center justify-center h-screen w-full bg-base-100 text-base-content rounded-box">
                  <div className="text-center flex flex-col items-center gap-3">
                    <div className="w-16 h-16 rounded-full bg-error/10 text-error flex items-center justify-center">
                      <ShieldAlert size={32} aria-hidden="true" />
                    </div>
                    <h1 className="text-xl md:text-2xl font-semibold">
                      {t("unauthorized-access-title")}
                    </h1>
                    <p className="text-sm text-base-content/60 max-w-md">
                      {t("unauthorized-access-subtitle")}
                    </p>
                  </div>
                </div>
              )}
            </>
          )
      }
    </div>
  );
};

export default UserList;
