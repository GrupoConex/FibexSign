import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import UserList from "../UserList";

const notifySuccess = vi.fn();
const notifyError = vi.fn();

vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key, options) => {
        if (key === "showing-range-of-total" && options) {
          return `Showing ${options.from}-${options.to} of ${options.total}`;
        }
        return key;
      }
    })
  };
});

vi.mock("../../utils", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    notify: {
      success: (...args) => notifySuccess(...args),
      error: (...args) => notifyError(...args),
      warning: vi.fn(),
      info: vi.fn(),
      dismiss: vi.fn()
    }
  };
});

vi.mock("../../components/AddUser", () => ({
  default: () => <div data-testid="add-user-stub" />
}));

vi.mock("axios", () => ({
  default: { post: vi.fn(async () => ({ data: {} })) }
}));

const { cloudRun, saveMock, MockParseObject } = vi.hoisted(() => {
  const saveMock = vi.fn(async () => {});
  class MockParseObject {
    constructor(className) {
      this.className = className;
      this.id = undefined;
      this.attrs = {};
    }
    set(key, value) {
      this.attrs[key] = value;
    }
    save = saveMock;
  }
  return { cloudRun: vi.fn(), saveMock, MockParseObject };
});

vi.mock("parse", () => ({
  default: {
    Cloud: { run: (...args) => cloudRun(...args) },
    User: {
      current: () => ({
        id: "admin-session-user",
        getSessionToken: () => "session-token"
      })
    },
    Object: MockParseObject
  }
}));

const adminUsers = [
  {
    objectId: "u-admin",
    Name: "Ada Admin",
    Email: "ada@example.com",
    Phone: "111",
    UserRole: "contracts_Admin",
    TeamIds: [],
    IsDisabled: false,
    UserId: { objectId: "parseuser-admin" }
  },
  {
    objectId: "u-org",
    Name: "Oscar OrgAdmin",
    Email: "oscar@example.com",
    Phone: "222",
    UserRole: "contracts_OrgAdmin",
    TeamIds: [],
    IsDisabled: false,
    UserId: { objectId: "parseuser-org" }
  },
  {
    objectId: "u-editor",
    Name: "Eva Editor",
    Email: "eva@example.com",
    Phone: "333",
    UserRole: "contracts_Editor",
    TeamIds: [],
    IsDisabled: true,
    UserId: { objectId: "parseuser-editor" }
  },
  {
    objectId: "u-user",
    Name: "Uma User",
    Email: "uma@example.com",
    Phone: "444",
    UserRole: "contracts_User",
    TeamIds: [],
    IsDisabled: false,
    UserId: { objectId: "parseuser-user" }
  }
];

const manyActiveUsers = Array.from({ length: 12 }, (_, i) => {
  const num = String(i + 1).padStart(2, "0");
  return {
    objectId: `u-many-${num}`,
    Name: `Many User ${num}`,
    Email: `many${num}@example.com`,
    Phone: `5550000${num}`,
    UserRole: "contracts_User",
    TeamIds: [],
    IsDisabled: false,
    UserId: { objectId: `parseuser-many-${num}` }
  };
});

function setAdminSession() {
  localStorage.setItem(
    "Extand_Class",
    JSON.stringify([
      {
        objectId: "current-admin",
        UserRole: "contracts_Admin",
        OrganizationId: { objectId: "org1" }
      }
    ])
  );
}

function setNonAdminSession() {
  localStorage.setItem(
    "Extand_Class",
    JSON.stringify([
      {
        objectId: "current-user",
        UserRole: "contracts_User",
        OrganizationId: { objectId: "org1" }
      }
    ])
  );
}

function renderUserList() {
  return render(
    <MemoryRouter>
      <UserList />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  localStorage.setItem("TenantId", "tenant1");
  localStorage.setItem("accesstoken", "token123");
  localStorage.setItem("baseUrl", "http://localhost/api/app/");
  cloudRun.mockImplementation(async (name) => {
    if (name === "getuserlistbyorg") return adminUsers;
    if (name === "resetpassword") return {};
    return {};
  });
});

describe("UserList page", () => {
  it("renders the user table with role badges reflecting each user's role", async () => {
    setAdminSession();
    renderUserList();

    await waitFor(() => expect(screen.getByText("Ada Admin")).toBeInTheDocument());

    const adminRow = screen.getByText("Ada Admin").closest("tr");
    const adminBadge = within(adminRow).getByText("Admin");
    expect(adminBadge.className).toMatch(/op-badge-primary/);

    const orgAdminRow = screen.getByText("Oscar OrgAdmin").closest("tr");
    const orgAdminBadge = within(orgAdminRow).getByText("OrgAdmin");
    expect(orgAdminBadge.className).toMatch(/op-badge/);
    expect(orgAdminBadge.className).not.toMatch(/op-badge-primary\b/);

    const editorRow = screen.getByText("Eva Editor").closest("tr");
    const editorBadge = within(editorRow).getByText("Editor");
    expect(editorBadge.className).toMatch(/op-badge-secondary/);

    const userRow = screen.getByText("Uma User").closest("tr");
    const userBadge = within(userRow).getByText("User");
    expect(userBadge.className).toMatch(/op-badge/);
  });

  it("filters the table by name or email as the search input changes", async () => {
    setAdminSession();
    const user = userEvent.setup();
    renderUserList();

    await waitFor(() => expect(screen.getByText("Ada Admin")).toBeInTheDocument());

    const searchInput = screen.getByTestId("user-search-input");
    await user.type(searchInput, "eva");

    await waitFor(() => {
      expect(screen.queryByText("Ada Admin")).not.toBeInTheDocument();
      expect(screen.queryByText("Oscar OrgAdmin")).not.toBeInTheDocument();
      expect(screen.queryByText("Uma User")).not.toBeInTheDocument();
      expect(screen.getByText("Eva Editor")).toBeInTheDocument();
    });

    await user.clear(searchInput);
    await user.type(searchInput, "uma@example.com");

    await waitFor(() => {
      expect(screen.getByText("Uma User")).toBeInTheDocument();
      expect(screen.queryByText("Eva Editor")).not.toBeInTheDocument();
    });
  });

  it("activates/deactivates a user through the confirmation modal and notifies the result", async () => {
    setAdminSession();
    const user = userEvent.setup();
    renderUserList();

    await waitFor(() => expect(screen.getByText("Eva Editor")).toBeInTheDocument());

    const editorRow = screen.getByText("Eva Editor").closest("tr");
    const toggle = within(editorRow).getByRole("checkbox");
    expect(toggle.checked).toBe(false);

    await user.click(toggle);

    await waitFor(() => expect(screen.getByText(/are-you-sure/)).toBeInTheDocument());

    const confirmButton = screen.getByText("yes");
    await user.click(confirmButton);

    await waitFor(() => expect(saveMock).toHaveBeenCalled());
    await waitFor(() =>
      expect(notifySuccess).toHaveBeenCalledWith("user-activated")
    );
    expect(notifyError).not.toHaveBeenCalled();
  });

  it("opens the reset-password and delete modals from the row actions", async () => {
    setAdminSession();
    const user = userEvent.setup();
    renderUserList();

    await waitFor(() => expect(screen.getByText("Uma User")).toBeInTheDocument());

    const userRow = screen.getByText("Uma User").closest("tr");

    const resetBtn = within(userRow).getByRole("button", {
      name: "btnLabel.Reset password"
    });
    await user.click(resetBtn);

    await waitFor(() =>
      expect(screen.getByText("reset-password")).toBeInTheDocument()
    );
    expect(screen.getByText("new-password")).toBeInTheDocument();

    await user.click(screen.getByText("cancel"));

    const deleteBtn = within(userRow).getByRole("button", {
      name: "btnLabel.Delete"
    });
    await user.click(deleteBtn);

    await waitFor(() =>
      expect(screen.getByText("delete-account")).toBeInTheDocument()
    );
  });

  it("keeps showing rows after a data mutation shrinks the filtered list below the current page's range", async () => {
    setAdminSession();
    const user = userEvent.setup();
    cloudRun.mockImplementation(async (name) => {
      if (name === "getuserlistbyorg") return manyActiveUsers;
      if (name === "resetpassword") return {};
      return {};
    });
    renderUserList();

    await waitFor(() =>
      expect(screen.getByText("Many User 01")).toBeInTheDocument()
    );

    await user.selectOptions(screen.getByTestId("user-status-filter"), "active");

    await waitFor(() =>
      expect(screen.getByText("Many User 10")).toBeInTheDocument()
    );
    expect(screen.queryByText("Many User 11")).not.toBeInTheDocument();

    await user.click(screen.getByText("next"));

    await waitFor(() =>
      expect(screen.getByText("Many User 11")).toBeInTheDocument()
    );
    expect(screen.getByText("Many User 12")).toBeInTheDocument();

    const deactivateUser = async (name) => {
      const row = screen.getByText(name).closest("tr");
      const toggle = within(row).getByRole("checkbox");
      await user.click(toggle);
      await waitFor(() =>
        expect(screen.getByText(/are-you-sure/)).toBeInTheDocument()
      );
      await user.click(screen.getByText("yes"));
      await waitFor(() => expect(saveMock).toHaveBeenCalled());
    };

    await deactivateUser("Many User 11");
    await waitFor(() =>
      expect(screen.queryByText("Many User 11")).not.toBeInTheDocument()
    );
    expect(screen.getByText("Many User 12")).toBeInTheDocument();

    await deactivateUser("Many User 12");

    await waitFor(() =>
      expect(screen.queryByText("Many User 12")).not.toBeInTheDocument()
    );
    expect(screen.getByText("Many User 01")).toBeInTheDocument();
    const pageOneBtn = screen.getByRole("button", { name: "1" });
    expect(pageOneBtn.className).toMatch(/op-btn-active/);
  });

  it("re-acots the current page to a valid range when a filter change shrinks the results while on page 2+", async () => {
    setAdminSession();
    const user = userEvent.setup();
    cloudRun.mockImplementation(async (name) => {
      if (name === "getuserlistbyorg") return manyActiveUsers;
      return {};
    });
    renderUserList();

    await waitFor(() =>
      expect(screen.getByText("Many User 01")).toBeInTheDocument()
    );

    await user.click(screen.getByText("next"));

    await waitFor(() =>
      expect(screen.getByText("Many User 11")).toBeInTheDocument()
    );

    const searchInput = screen.getByTestId("user-search-input");
    await user.type(searchInput, "Many User 03");

    await waitFor(() => {
      expect(screen.getByText("Many User 03")).toBeInTheDocument();
      expect(screen.queryByText("Many User 11")).not.toBeInTheDocument();
    });

    expect(screen.queryByText("next")).not.toBeInTheDocument();
    const pageOneBtn = screen.getByRole("button", { name: "1" });
    expect(pageOneBtn.className).toMatch(/op-btn-active/);
  });

  it("filters users by team, sorts users, and clears all filters with clear button", async () => {
    setAdminSession();
    const user = userEvent.setup();
    const teamA = { objectId: "team-a", Name: "Team Alpha" };
    const teamB = { objectId: "team-b", Name: "Team Beta" };

    const usersWithTeams = [
      {
        objectId: "u-1",
        Name: "Zara Admin",
        Email: "zara@example.com",
        Phone: "111",
        UserRole: "contracts_Admin",
        TeamIds: [teamA],
        IsDisabled: false,
        UserId: { objectId: "p-1" }
      },
      {
        objectId: "u-2",
        Name: "Alan User",
        Email: "alan@example.com",
        Phone: "222",
        UserRole: "contracts_User",
        TeamIds: [teamB],
        IsDisabled: false,
        UserId: { objectId: "p-2" }
      },
      {
        objectId: "u-3",
        Name: "Bella Solo",
        Email: "bella@example.com",
        Phone: "333",
        UserRole: "contracts_Editor",
        TeamIds: [],
        IsDisabled: false,
        UserId: { objectId: "p-3" }
      }
    ];

    cloudRun.mockImplementation(async (name) => {
      if (name === "getuserlistbyorg") return usersWithTeams;
      return {};
    });

    renderUserList();

    await waitFor(() =>
      expect(screen.getByText("Zara Admin")).toBeInTheDocument()
    );
    expect(screen.getByText("Alan User")).toBeInTheDocument();
    expect(screen.getByText("Bella Solo")).toBeInTheDocument();

    // Team filter: Team Alpha
    const teamFilter = screen.getByTestId("user-team-filter");
    await user.selectOptions(teamFilter, "team-a");

    await waitFor(() => {
      expect(screen.getByText("Zara Admin")).toBeInTheDocument();
      expect(screen.queryByText("Alan User")).not.toBeInTheDocument();
      expect(screen.queryByText("Bella Solo")).not.toBeInTheDocument();
    });

    // Clear filters button should be visible
    const clearBtn = screen.getByTestId("clear-filters-btn");
    await user.click(clearBtn);

    await waitFor(() => {
      expect(screen.getByText("Alan User")).toBeInTheDocument();
      expect(screen.getByText("Bella Solo")).toBeInTheDocument();
    });

    // Sort by name A-Z
    const sortFilter = screen.getByTestId("user-sort-filter");
    await user.selectOptions(sortFilter, "name-asc");

    // Table rows should be ordered: Alan User, Bella Solo, Zara Admin
    const rows = screen.getAllByRole("row");
    // Row 0 is header, row 1 is Alan User
    expect(within(rows[1]).getByText("Alan User")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Bella Solo")).toBeInTheDocument();
    expect(within(rows[3]).getByText("Zara Admin")).toBeInTheDocument();
  });

  it("changes rows per page using the rows-per-page selector", async () => {
    setAdminSession();
    const user = userEvent.setup();
    cloudRun.mockImplementation(async (name) => {
      if (name === "getuserlistbyorg") return manyActiveUsers;
      return {};
    });

    renderUserList();

    await waitFor(() =>
      expect(screen.getByText("Many User 01")).toBeInTheDocument()
    );

    // Default 10 rows: Many User 11 is on page 2
    expect(screen.queryByText("Many User 11")).not.toBeInTheDocument();

    // Select 25 rows per page
    const rppSelect = screen.getByTestId("rows-per-page-select");
    await user.selectOptions(rppSelect, "25");

    await waitFor(() => {
      expect(screen.getByText("Many User 11")).toBeInTheDocument();
      expect(screen.getByText("Many User 12")).toBeInTheDocument();
    });
  });

  it("shows an unauthorized access state instead of a 404 for non-admin users", async () => {
    setNonAdminSession();
    renderUserList();

    await waitFor(() =>
      expect(screen.getByText("unauthorized-access-title")).toBeInTheDocument()
    );
    expect(screen.getByText("unauthorized-access-subtitle")).toBeInTheDocument();
    expect(screen.queryByText("404")).not.toBeInTheDocument();
    expect(screen.queryByText("page-not-found")).not.toBeInTheDocument();
  });
});
