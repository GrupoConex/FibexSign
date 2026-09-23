import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import userReducer from "../../redux/reducers/userReducer";
import Preferences from "../Preferences";
import WidgetsTab from "../../components/preferences/tabs/Widgets";
import CardSection from "../../components/preferences/CardSection";
import { Globe } from "lucide-react";

const notifySuccess = vi.fn();
const notifyError = vi.fn();
const notifyWarning = vi.fn();

vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key) => key,
      i18n: { language: "en", changeLanguage: () => Promise.resolve() }
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
      warning: (...args) => notifyWarning(...args),
      info: vi.fn(),
      dismiss: vi.fn()
    }
  };
});

const cloudRun = vi.fn();

const currentUser = {
  id: "user1",
  get: (key) => (key === "email" ? "user@example.com" : undefined),
  getSessionToken: () => "token123"
};

vi.mock("parse", () => ({
  default: {
    Cloud: { run: (...args) => cloudRun(...args) },
    User: { current: () => currentUser },
    File: vi.fn()
  }
}));

const fakeUserRecord = {
  objectId: "user1",
  SignatureType: [],
  NotifyOnSignatures: true,
  SendinOrder: true,
  IsTourEnabled: false,
  DateFormat: "MM/DD/YYYY",
  Is12HourTime: false,
  IsLTVEnabled: false,
  DownloadFilenameFormat: "DOCNAME",
  UseNameAsSender: false,
  Timezone: "UTC",
  WidgetPreferences: []
};

vi.mock("axios", () => ({
  default: {
    post: vi.fn(async () => ({ data: { result: fakeUserRecord } }))
  }
}));

function renderWithStore(ui, preloadedState) {
  const store = configureStore({
    reducer: { user: userReducer },
    preloadedState
  });
  return render(<Provider store={store}>{ui}</Provider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  localStorage.setItem("TenantId", "tenant1");
  localStorage.setItem("parseAppId", "app1");
  localStorage.setItem("accesstoken", "token123");
  localStorage.setItem("baseUrl", "http://localhost/api/app/");
  localStorage.setItem(
    "Parse/app1/currentUser",
    JSON.stringify({ objectId: "user1" })
  );
  cloudRun.mockImplementation(async (name) => {
    if (name === "updatepreferences") return true;
    if (name === "setwidgetpreferences") return {};
    if (name === "getUserDetails") return { get: () => undefined };
    return {};
  });
});

describe("Preferences page", () => {
  it("renders the boolean preference controls as toggle checkboxes, not radios", async () => {
    renderWithStore(<Preferences />);

    await waitFor(() =>
      expect(screen.getByTestId("toggle-send-in-order")).toBeInTheDocument()
    );

    expect(screen.getByTestId("toggle-send-in-order")).toHaveAttribute(
      "type",
      "checkbox"
    );
    expect(
      screen.getByTestId("toggle-notify-on-signatures")
    ).toHaveAttribute("type", "checkbox");
    expect(screen.getByTestId("toggle-tour-enabled")).toHaveAttribute(
      "type",
      "checkbox"
    );
    expect(screen.getByTestId("toggle-use-name-as-sender")).toHaveAttribute(
      "type",
      "checkbox"
    );

    const signatureFlowCard = screen
      .getByTestId("toggle-send-in-order")
      .closest(".op-card");
    const notificationsCard = screen
      .getByTestId("toggle-notify-on-signatures")
      .closest(".op-card");

    expect(
      signatureFlowCard.querySelectorAll('input[type="radio"]')
    ).toHaveLength(0);
    expect(
      notificationsCard.querySelectorAll('input[type="radio"]')
    ).toHaveLength(0);
  });

  it("saves successfully via notify.success and never touches the legacy Alert flow", async () => {
    const user = userEvent.setup();
    renderWithStore(<Preferences />);

    await waitFor(() =>
      expect(screen.getByTestId("general-save-button")).toBeInTheDocument()
    );

    await user.click(screen.getByTestId("general-save-button"));

    await waitFor(() => expect(notifySuccess).toHaveBeenCalled());

    expect(cloudRun).toHaveBeenCalledWith(
      "updatepreferences",
      expect.any(Object)
    );
    expect(document.querySelector(".op-alert")).toBeNull();
  });

  it("notifies the error and re-enables the save button when updatepreferences rejects", async () => {
    const user = userEvent.setup();
    cloudRun.mockImplementation(async (name) => {
      if (name === "updatepreferences") {
        throw new Error("network down");
      }
      if (name === "getUserDetails") return { get: () => undefined };
      return {};
    });

    renderWithStore(<Preferences />);

    await waitFor(() =>
      expect(screen.getByTestId("general-save-button")).toBeInTheDocument()
    );

    await user.click(screen.getByTestId("general-save-button"));

    await waitFor(() =>
      expect(notifyError).toHaveBeenCalledWith("network down")
    );
    expect(notifySuccess).not.toHaveBeenCalled();

    await waitFor(() =>
      expect(screen.getByTestId("general-save-button")).not.toBeDisabled()
    );
  });
});

describe("CardSection layout", () => {
  it("does not lay out children as flex-column siblings, so h-full controls inside cannot stretch to the tallest sibling", () => {
    render(
      <CardSection icon={Globe} title="preferences-localization-title">
        <div data-testid="card-child-one">One</div>
        <div data-testid="card-child-two">Two</div>
      </CardSection>
    );

    const childrenWrapper = screen.getByTestId("card-child-one").parentElement;

    expect(childrenWrapper.className).not.toMatch(/\bflex\b/);
    expect(childrenWrapper.className).toMatch(/\bspace-y-5\b/);
  });
});

describe("Preferences widgets tab", () => {
  const widgetsPreloadedState = {
    user: {
      userInfo: fakeUserRecord,
      isValidSession: true,
      isLoader: false,
      isTopLoader: false,
      tenantInfo: {}
    }
  };

  it("saves without throwing a ReferenceError and notifies success", async () => {
    const user = userEvent.setup();
    renderWithStore(<WidgetsTab />, widgetsPreloadedState);

    const saveButton = screen.getByTestId("widgets-save-button");
    await user.click(saveButton);

    await waitFor(() =>
      expect(cloudRun).toHaveBeenCalledWith(
        "setwidgetpreferences",
        expect.any(Object)
      )
    );
    await waitFor(() => expect(notifySuccess).toHaveBeenCalled());
  });

  it("notifies the error and re-enables the save button when setwidgetpreferences rejects", async () => {
    const user = userEvent.setup();
    cloudRun.mockImplementation(async (name) => {
      if (name === "setwidgetpreferences") {
        throw new Error("widget save failed");
      }
      return {};
    });

    renderWithStore(<WidgetsTab />, widgetsPreloadedState);

    const saveButton = screen.getByTestId("widgets-save-button");
    await user.click(saveButton);

    await waitFor(() =>
      expect(notifyError).toHaveBeenCalledWith("widget save failed")
    );
    expect(notifySuccess).not.toHaveBeenCalled();

    await waitFor(() => expect(saveButton).not.toBeDisabled());
  });
});
