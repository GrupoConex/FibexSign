import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import UserProfile from "../UserProfile";

const notifySuccess = vi.fn();
const notifyError = vi.fn();
const notifyWarning = vi.fn();
const compressImageMock = vi.fn();

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
    },
    compressImage: (...args) => compressImageMock(...args)
  };
});

const getSecureUrlMock = vi.fn();
const handleSendOTPMock = vi.fn();

vi.mock("../../constant/Utils", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getSecureUrl: (...args) => getSecureUrlMock(...args),
    handleSendOTP: (...args) => handleSendOTPMock(...args)
  };
});

vi.mock("../../constant/saveFileSize", () => ({
  SaveFileSize: vi.fn()
}));

const queryGetMock = vi.fn();
const parseObjectSaveMock = vi.fn();
const parseFileSaveMock = vi.fn();
const cloudRunMock = vi.fn();
const emailVerifiedState = { current: false };

const mockUserRecord = {
  get: (key) => (key === "emailVerified" ? emailVerifiedState.current : undefined),
  set: vi.fn(),
  save: (...args) => parseObjectSaveMock(...args)
};

const currentUser = {
  objectId: "user1",
  id: "user1",
  emailVerified: false,
  getEmail: () => "user@example.com"
};

vi.mock("parse", () => ({
  default: {
    Object: { extend: vi.fn(() => function MockUserClass() {}) },
    Query: vi.fn().mockImplementation(function MockParseQuery() {
      return { get: (...args) => queryGetMock(...args) };
    }),
    User: { current: () => currentUser },
    Cloud: { run: (...args) => cloudRunMock(...args) },
    File: vi.fn().mockImplementation(function MockParseFile(name) {
      return {
        name,
        save: (...args) => parseFileSaveMock(...args)
      };
    })
  }
}));

vi.mock("axios", () => ({
  default: {
    post: vi.fn(async () => ({ data: {} })),
    put: vi.fn(async () => ({ data: {} }))
  }
}));

const baseUserInfo = {
  objectId: "user1",
  phone: "+1 555 0100",
  email: "user@example.com"
};

const baseExtUser = [
  {
    objectId: "ext1",
    Company: "Acme Corp",
    JobTitle: "Engineer",
    UserRole: "contracts_Admin",
    UserId: { objectId: "user1" }
  }
];

const renderProfile = () =>
  render(
    <MemoryRouter>
      <UserProfile />
    </MemoryRouter>
  );

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  emailVerifiedState.current = false;
  currentUser.emailVerified = false;

  localStorage.setItem("accesstoken", "token123");
  localStorage.setItem("baseUrl", "http://localhost/api/app/");
  localStorage.setItem("parseAppId", "app1");
  localStorage.setItem("TenantId", "tenant1");
  localStorage.setItem("username", "Jane Doe");
  localStorage.setItem("profileImg", "");
  localStorage.setItem("_user_role", "Admin");
  localStorage.setItem("UserInformation", JSON.stringify(baseUserInfo));
  localStorage.setItem("Extand_Class", JSON.stringify(baseExtUser));

  queryGetMock.mockResolvedValue(mockUserRecord);
  parseObjectSaveMock.mockResolvedValue({
    toJSON: () => ({
      objectId: "user1",
      name: "Jane Updated",
      phone: "+1 555 0200",
      ProfilePic: ""
    })
  });
  parseFileSaveMock.mockResolvedValue({
    url: () => "https://parse.example.com/files/avatar.png"
  });
  getSecureUrlMock.mockResolvedValue({
    url: "https://cdn.example.com/avatar.png"
  });
  compressImageMock.mockImplementation(async (file) => file);
  cloudRunMock.mockImplementation(async (name) => {
    if (name === "verifyemail") return { message: "Email is verified." };
    if (name === "senddeleterequest") return {};
    if (name === "getUserDetails") {
      return { objectId: "ext1", Company: "Acme Corp", JobTitle: "Engineer" };
    }
    return {};
  });
});

describe("UserProfile sections rendering", () => {
  it("renders personal and professional data from the user records", async () => {
    renderProfile();

    await waitFor(() =>
      expect(screen.getByTestId("personal-info-card")).toBeInTheDocument()
    );

    expect(screen.getByTestId("display-name")).toHaveTextContent("Jane Doe");
    expect(screen.getByTestId("display-phone")).toHaveTextContent(
      "+1 555 0100"
    );
    expect(screen.getByTestId("display-email")).toHaveTextContent(
      "user@example.com"
    );

    expect(screen.getByTestId("professional-info-card")).toBeInTheDocument();
    expect(screen.getByTestId("display-company")).toHaveTextContent(
      "Acme Corp"
    );
    expect(screen.getByTestId("display-job-title")).toHaveTextContent(
      "Engineer"
    );
    expect(screen.getByTestId("role-badge")).toHaveTextContent("Admin");
  });
});

describe("UserProfile avatar fallback", () => {
  it("shows initials when no profile photo is set", async () => {
    renderProfile();

    await waitFor(() =>
      expect(screen.getByTestId("personal-info-card")).toBeInTheDocument()
    );

    expect(screen.getByTestId("profile-avatar-initials")).toHaveTextContent(
      "JD"
    );
    expect(screen.queryByTestId("profile-avatar-image")).toBeNull();
  });
});

describe("UserProfile edit and save flow", () => {
  it("saves the edited profile through Parse and notifies success", async () => {
    const user = userEvent.setup();
    renderProfile();

    await waitFor(() =>
      expect(screen.getByTestId("edit-save-button")).toBeInTheDocument()
    );

    await user.click(screen.getByTestId("edit-save-button"));

    const nameInput = screen.getByTestId("input-name");
    await user.clear(nameInput);
    await user.type(nameInput, "Jane Updated");

    await user.click(screen.getByTestId("edit-save-button"));

    await waitFor(() => expect(parseObjectSaveMock).toHaveBeenCalled());
    expect(queryGetMock).toHaveBeenCalledWith("user1");
    expect(mockUserRecord.set).toHaveBeenCalledWith("name", "Jane Updated");

    await waitFor(() =>
      expect(notifySuccess).toHaveBeenCalledWith("profile-update-alert")
    );
  });

  it("shows a validation error and does not call Parse when name is cleared", async () => {
    const user = userEvent.setup();
    renderProfile();

    await waitFor(() =>
      expect(screen.getByTestId("edit-save-button")).toBeInTheDocument()
    );

    await user.click(screen.getByTestId("edit-save-button"));

    const nameInput = screen.getByTestId("input-name");
    await user.clear(nameInput);

    await user.click(screen.getByTestId("edit-save-button"));

    expect(screen.getByTestId("name-error")).toBeInTheDocument();
    expect(parseObjectSaveMock).not.toHaveBeenCalled();
  });
});

describe("UserProfile email OTP verification flow", () => {
  it("opens the OTP modal, verifies the code and updates the badge", async () => {
    const user = userEvent.setup();
    renderProfile();

    await waitFor(() =>
      expect(screen.getByTestId("verify-email-button")).toBeInTheDocument()
    );

    await user.click(screen.getByTestId("verify-email-button"));

    await waitFor(() => expect(handleSendOTPMock).toHaveBeenCalled());

    const otpInput = await screen.findByPlaceholderText("otp-placeholder");
    await user.type(otpInput, "1234");

    const dialog = document.getElementById("otp-verification-modal");
    await waitFor(() => expect(dialog).not.toBeNull());
    await user.click(within(dialog).getByText("verify"));

    await waitFor(() =>
      expect(cloudRunMock).toHaveBeenCalledWith("verifyemail", {
        otp: "1234",
        email: "user@example.com"
      })
    );

    await waitFor(() =>
      expect(notifySuccess).toHaveBeenCalledWith("Email-verified-alert-1")
    );

    await waitFor(() =>
      expect(screen.getByTestId("email-verified-badge")).toBeInTheDocument()
    );
  });
});

describe("UserProfile account deletion flow", () => {
  it("opens the delete modal and sends the delete request on confirmation", async () => {
    const user = userEvent.setup();
    renderProfile();

    await waitFor(() =>
      expect(screen.getByTestId("delete-account-button")).toBeInTheDocument()
    );

    await user.click(screen.getByTestId("delete-account-button"));

    const dialog = document.getElementById("delete-account-modal");
    await waitFor(() => expect(dialog).not.toBeNull());
    await user.click(within(dialog).getByText("yes"));

    await waitFor(() =>
      expect(cloudRunMock).toHaveBeenCalledWith("senddeleterequest", {
        userId: "user1"
      })
    );
  });
});

describe("UserProfile resilience to missing extended-user data", () => {
  it("does not crash when Extand_Class is missing from localStorage", async () => {
    localStorage.removeItem("Extand_Class");

    expect(() => renderProfile()).not.toThrow();

    await waitFor(() =>
      expect(screen.getByTestId("professional-info-card")).toBeInTheDocument()
    );
  });

  it("does not crash when Extand_Class resolves to an empty array", async () => {
    localStorage.setItem("Extand_Class", JSON.stringify([]));

    expect(() => renderProfile()).not.toThrow();

    await waitFor(() =>
      expect(screen.getByTestId("professional-info-card")).toBeInTheDocument()
    );

    expect(screen.getByTestId("display-company")).toHaveTextContent("");
    expect(screen.getByTestId("display-job-title")).toHaveTextContent("");
  });
});

describe("UserProfile avatar upload race condition", () => {
  it("keeps the most recently selected photo preview when an earlier upload finishes later", async () => {
    const user = userEvent.setup();

    let resolveFirstSave;
    let resolveSecondSave;
    const firstSavePromise = new Promise((resolve) => {
      resolveFirstSave = resolve;
    });
    const secondSavePromise = new Promise((resolve) => {
      resolveSecondSave = resolve;
    });
    parseFileSaveMock
      .mockImplementationOnce(() => firstSavePromise)
      .mockImplementationOnce(() => secondSavePromise);

    vi.spyOn(URL, "createObjectURL").mockImplementation(
      (file) => `blob:${file.name}`
    );
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

    renderProfile();
    await waitFor(() =>
      expect(screen.getByTestId("edit-save-button")).toBeInTheDocument()
    );
    await user.click(screen.getByTestId("edit-save-button"));

    const fileInput = screen.getByTestId("avatar-file-input");
    const fileA = new File(["a"], "a.png", { type: "image/png" });
    const fileB = new File(["b"], "b.png", { type: "image/png" });

    await userEvent.upload(fileInput, fileA);
    await waitFor(() =>
      expect(screen.getByTestId("profile-avatar-image")).toHaveAttribute(
        "src",
        "blob:a.png"
      )
    );

    await userEvent.upload(fileInput, fileB);
    await waitFor(() =>
      expect(screen.getByTestId("profile-avatar-image")).toHaveAttribute(
        "src",
        "blob:b.png"
      )
    );

    resolveFirstSave({
      url: () => "https://parse.example.com/files/first.png"
    });

    await waitFor(() => expect(getSecureUrlMock).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByTestId("profile-avatar-image")).toHaveAttribute(
        "src",
        "blob:b.png"
      )
    );

    resolveSecondSave({
      url: () => "https://parse.example.com/files/second.png"
    });

    await waitFor(() => expect(getSecureUrlMock).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.getByTestId("profile-avatar-image")).toHaveAttribute(
        "src",
        "https://cdn.example.com/avatar.png"
      )
    );
  });
});
