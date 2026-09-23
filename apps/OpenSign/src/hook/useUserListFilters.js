import { useEffect, useMemo, useState } from "react";

function getPaginationRange(safePage, totalPages) {
  const totalPageNumbers = 7;
  const pages = [];
  if (totalPages <= totalPageNumbers) {
    for (let i = 1; i <= totalPages; i++) {
      pages.push(i);
    }
    return pages;
  }

  const leftSiblingIndex = Math.max(safePage - 1, 1);
  const rightSiblingIndex = Math.min(safePage + 1, totalPages);

  const showLeftDots = leftSiblingIndex > 2;
  const showRightDots = rightSiblingIndex < totalPages - 2;

  const firstPageIndex = 1;
  const lastPageIndex = totalPages;

  if (!showLeftDots && showRightDots) {
    const leftItemCount = 3;
    const leftRange = Array.from({ length: leftItemCount }, (_, i) => i + 1);

    pages.push(...leftRange);
    pages.push("...");
    pages.push(totalPages);
  } else if (showLeftDots && !showRightDots) {
    const rightItemCount = 3;
    const rightRange = Array.from(
      { length: rightItemCount },
      (_, i) => totalPages - rightItemCount + i + 1
    );

    pages.push(firstPageIndex);
    pages.push("...");
    pages.push(...rightRange);
  } else if (showLeftDots && showRightDots) {
    const middleRange = Array.from(
      { length: 3 },
      (_, i) => leftSiblingIndex + i
    );

    pages.push(firstPageIndex);
    pages.push("...");
    pages.push(...middleRange);
    pages.push("...");
    pages.push(lastPageIndex);
  }

  return pages;
}

export function useUserListFilters(userList) {
  const [currentPage, setCurrentPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [teamFilter, setTeamFilter] = useState("all");
  const [sortBy, setSortBy] = useState("default");
  const [recordPerPage, setRecordPerPage] = useState(10);

  const availableTeams = useMemo(() => {
    const teamsMap = new Map();
    userList.forEach((u) => {
      const raw = u?.TeamIds;
      if (Array.isArray(raw)) {
        raw.forEach((team) => {
          const id = team?.objectId || team?.id;
          const name = team?.Name || team?.name;
          if (id && name) {
            teamsMap.set(id, name);
          }
        });
      } else if (raw && typeof raw === "object") {
        const id = raw?.objectId || raw?.id;
        const name = raw?.Name || raw?.name;
        if (id && name) {
          teamsMap.set(id, name);
        }
      }
    });
    return Array.from(teamsMap.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [userList]);

  const filteredUserList = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const result = userList.filter((item) => {
      const matchesQuery =
        !query ||
        item?.Name?.toLowerCase()?.includes(query) ||
        item?.Email?.toLowerCase()?.includes(query);
      const role = item?.UserRole?.split("_").pop();
      const matchesRole = roleFilter === "all" || role === roleFilter;
      const isActive = item?.IsDisabled !== true;
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "active" && isActive) ||
        (statusFilter === "inactive" && !isActive);

      let matchesTeam = true;
      if (teamFilter === "none") {
        const raw = item?.TeamIds;
        matchesTeam =
          !raw ||
          (Array.isArray(raw) && raw.length === 0) ||
          (typeof raw === "object" && !raw?.objectId && !raw?.Name);
      } else if (teamFilter !== "all") {
        const raw = item?.TeamIds;
        if (Array.isArray(raw)) {
          matchesTeam = raw.some(
            (team) =>
              (team?.objectId || team?.id) === teamFilter ||
              (team?.Name || team?.name) === teamFilter
          );
        } else if (raw && typeof raw === "object") {
          matchesTeam =
            (raw?.objectId || raw?.id) === teamFilter ||
            (raw?.Name || raw?.name) === teamFilter;
        } else {
          matchesTeam = false;
        }
      }

      return matchesQuery && matchesRole && matchesStatus && matchesTeam;
    });

    if (sortBy === "name-asc") {
      result.sort((a, b) => (a?.Name || "").localeCompare(b?.Name || ""));
    } else if (sortBy === "name-desc") {
      result.sort((a, b) => (b?.Name || "").localeCompare(a?.Name || ""));
    } else if (sortBy === "role") {
      result.sort((a, b) => {
        const roleA = a?.UserRole?.split("_").pop() || "";
        const roleB = b?.UserRole?.split("_").pop() || "";
        return roleA.localeCompare(roleB);
      });
    }

    return result;
  }, [userList, searchQuery, roleFilter, statusFilter, teamFilter, sortBy]);

  const hasActiveFilters =
    searchQuery.trim().length > 0 ||
    roleFilter !== "all" ||
    statusFilter !== "all" ||
    teamFilter !== "all" ||
    sortBy !== "default";

  const totalFilteredPages = Math.max(
    1,
    Math.ceil(filteredUserList.length / recordPerPage)
  );
  const safePage = Math.min(currentPage, totalFilteredPages);
  const startIndex = (safePage - 1) * recordPerPage;

  useEffect(() => {
    setCurrentPage(1);
  }, [
    searchQuery,
    roleFilter,
    statusFilter,
    teamFilter,
    sortBy,
    recordPerPage
  ]);

  const pageNumbers = useMemo(
    () =>
      getPaginationRange(
        safePage,
        Math.ceil(filteredUserList.length / recordPerPage)
      ),
    [safePage, filteredUserList.length, recordPerPage]
  );

  const indexOfLastDoc = safePage * recordPerPage;
  const indexOfFirstDoc = indexOfLastDoc - recordPerPage;
  const currentList = filteredUserList?.slice(indexOfFirstDoc, indexOfLastDoc);
  const rangeFrom = filteredUserList.length === 0 ? 0 : indexOfFirstDoc + 1;
  const rangeTo = Math.min(indexOfLastDoc, filteredUserList.length);

  const handleClearFilters = () => {
    setSearchQuery("");
    setRoleFilter("all");
    setStatusFilter("all");
    setTeamFilter("all");
    setSortBy("default");
  };

  const paginateFront = () => {
    const lastValue = pageNumbers?.[pageNumbers?.length - 1];
    if (safePage < lastValue) {
      setCurrentPage(safePage + 1);
    }
  };

  const paginateBack = () => {
    if (safePage > 1) {
      setCurrentPage(safePage - 1);
    }
  };

  return {
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
  };
}
