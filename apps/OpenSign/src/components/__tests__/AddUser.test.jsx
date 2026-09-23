import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AddUser from "../AddUser";

vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key) => key
    })
  };
});

const notifySuccess = vi.fn();
const notifyError = vi.fn();
const notifyWarning = vi.fn();

vi.mock("../../utils", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    notify: {
      success: (...args) => notifySuccess(...args),
      error: (...args) => notifyError(...args),
      warning: (...args) => notifyWarning(...args),
      info: vi.fn(),
      dismiss: vi.fn()
    }
  };
});

const cloudRun = vi.fn();

vi.mock("parse", () => ({
  default: {
    Cloud: { run: (...args) => cloudRun(...args) }
  }
}));

const teamListFixture = [
  { objectId: "team-all-users", Name: "All Users" },
  { objectId: "team-sales", Name: "Sales" },
  { objectId: "team-support", Name: "Support" }
];

beforeEach(() => {
  vi.clearAllMocks();
  cloudRun.mockImplementation(async (name) => {
    if (name === "getteams") return teamListFixture;
    return {};
  });
});

describe("AddUser team selection", () => {
  it("renders a team select populated from teamList with All Users selected by default", async () => {
    render(<AddUser />);

    const teamSelect = await screen.findByLabelText("team");

    await waitFor(() => {
      expect(
        screen.getAllByRole("option", { name: "Sales" })
      ).toHaveLength(1);
    });

    expect(
      screen.getByRole("option", { name: "All Users" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Support" })
    ).toBeInTheDocument();
    expect(teamSelect.value).toBe("team-all-users");
  });

  it("provides a placeholder option for the team select before the team list has loaded", async () => {
    let resolveTeams;
    cloudRun.mockImplementation(
      (name) =>
        new Promise((resolve) => {
          if (name === "getteams") {
            resolveTeams = () => resolve(teamListFixture);
          } else {
            resolve({});
          }
        })
    );

    render(<AddUser />);

    const teamSelect = await screen.findByLabelText("team");
    expect(
      within(teamSelect).getByRole("option", { name: "Select" })
    ).toBeInTheDocument();
    expect(teamSelect.value).toBe("");

    resolveTeams();

    await waitFor(() => expect(teamSelect.value).toBe("team-all-users"));
  });

  it("updates the selected team when the user picks a different option", async () => {
    const user = userEvent.setup();
    render(<AddUser />);

    const teamSelect = await screen.findByLabelText("team");
    await waitFor(() =>
      expect(
        screen.getByRole("option", { name: "Sales" })
      ).toBeInTheDocument()
    );

    await user.selectOptions(teamSelect, "team-sales");

    expect(teamSelect.value).toBe("team-sales");
  });
});
