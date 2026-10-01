import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import Login from "../Login";

const cloudRun = vi.fn();
const notifyError = vi.fn();
const notifyWarning = vi.fn();
const sendOtp = vi.fn();

vi.mock("../../utils", async (importOriginal) => ({
  ...(await importOriginal()),
  notify: {
    success: vi.fn(),
    error: (...args) => notifyError(...args),
    warning: (...args) => notifyWarning(...args),
    info: vi.fn(),
    dismiss: vi.fn()
  }
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal()),
  useTranslation: () => ({
    t: (key) => key,
    i18n: { language: "en", changeLanguage: () => Promise.resolve() }
  })
}));

vi.mock("react-redux", () => ({ useDispatch: () => vi.fn() }));

vi.mock("parse", () => ({
  default: {
    Cloud: { run: (...args) => cloudRun(...args) },
    User: { become: vi.fn().mockResolvedValue({}), logOut: vi.fn() },
    Error: {
      OBJECT_NOT_FOUND: 101,
      CONNECTION_FAILED: 100,
      INTERNAL_SERVER_ERROR: 1
    }
  }
}));

vi.mock("../../constant/Utils", async (importOriginal) => ({
  ...(await importOriginal()),
  getAppLogo: vi.fn().mockResolvedValue({ user: "exist" }),
  handleSendOTP: (...args) => sendOtp(...args),
  saveLanguageInLocal: vi.fn(),
  usertimezone: "UTC"
}));

vi.mock("../../redux/reducers/infoReducer", async (importOriginal) => ({
  ...(await importOriginal()),
  fetchAppInfo: () => ({ type: "info/fetch" })
}));

vi.mock("../../components/auth/AuthLayout", () => ({
  default: ({ children }) => <div>{children}</div>
}));
vi.mock("../../components/pdf/SelectLanguage", () => ({ default: () => null }));
vi.mock("../../primitives/Icon", () => ({ default: () => null }));

const renderLogin = () =>
  render(
    <MemoryRouter>
      <Login />
    </MemoryRouter>
  );

const liveMessages = (container) =>
  container.querySelectorAll("[aria-live='polite']");

const submit = () =>
  userEvent.click(screen.getByRole("button", { name: "login" }));

describe("Login inline validation", () => {
  beforeEach(() => {
    cloudRun.mockReset();
    localStorage.clear();
  });

  it("shows required messages and blocks the request when submitted empty", async () => {
    const { container } = renderLogin();
    const emailInput = await screen.findByLabelText("email");
    const passwordInput = screen.getByLabelText("password");
    await submit();

    expect(liveMessages(container)).toHaveLength(2);
    expect(emailInput).toHaveFocus();
    expect(emailInput).toHaveAttribute("aria-invalid", "true");
    expect(emailInput).toHaveAttribute("aria-describedby", "email-error");
    expect(emailInput).toHaveClass("op-input-error");
    expect(passwordInput).toHaveAttribute("aria-invalid", "true");
    expect(passwordInput).toHaveAttribute("aria-describedby", "password-error");
    expect(cloudRun).not.toHaveBeenCalled();
  });

  it("shows the invalid email message and clears it once fixed", async () => {
    const { container } = renderLogin();
    const emailInput = await screen.findByLabelText("email");
    await userEvent.type(emailInput, "bad@mail");
    await userEvent.type(screen.getByLabelText("password"), "secret");
    await submit();

    expect(screen.getByText("valid-email-alert")).toBeInTheDocument();
    expect(emailInput).toHaveFocus();
    expect(cloudRun).not.toHaveBeenCalled();

    await userEvent.type(emailInput, ".com");
    await waitFor(() => expect(liveMessages(container)).toHaveLength(0));
    expect(emailInput).toHaveAttribute("aria-invalid", "false");
  });

  it("does not validate on blur before the first submit", async () => {
    const { container } = renderLogin();
    const emailInput = await screen.findByLabelText("email");
    await userEvent.click(emailInput);
    await userEvent.tab();

    expect(liveMessages(container)).toHaveLength(0);
    expect(emailInput).toHaveAttribute("aria-invalid", "false");
  });

  it("validates on blur and change after a failed submit", async () => {
    const { container } = renderLogin();
    const emailInput = await screen.findByLabelText("email");
    const passwordInput = screen.getByLabelText("password");
    await userEvent.type(emailInput, "a@b.co");
    await submit();
    expect(screen.getByText("input-required")).toBeInTheDocument();

    await userEvent.type(passwordInput, "x");
    await waitFor(() => expect(liveMessages(container)).toHaveLength(0));

    await userEvent.clear(emailInput);
    await userEvent.tab();
    expect(screen.getByText("input-required")).toBeInTheDocument();
  });

  it("accepts a whitespace-only password as provided", async () => {
    cloudRun.mockResolvedValue(null);
    renderLogin();
    await userEvent.type(await screen.findByLabelText("email"), "a@b.co");
    await userEvent.type(screen.getByLabelText("password"), "   ");
    await submit();

    await waitFor(() =>
      expect(cloudRun).toHaveBeenCalledWith("loginuser", {
        email: "a@b.co",
        password: "   "
      })
    );
  });

  it("calls the backend when the form is valid", async () => {
    cloudRun.mockResolvedValue(null);
    const { container } = renderLogin();
    await userEvent.type(await screen.findByLabelText("email"), "a@b.co");
    await userEvent.type(screen.getByLabelText("password"), "secret");
    await submit();

    await waitFor(() =>
      expect(cloudRun).toHaveBeenCalledWith("loginuser", {
        email: "a@b.co",
        password: "secret"
      })
    );
    expect(liveMessages(container)).toHaveLength(0);
  });
});

describe("Login additional information submission", () => {
  const SSO_USER = {
    sessionToken: "session-token",
    name: "",
    email: "sso.user@example.com"
  };

  const openAdditionalInfoModal = async () => {
    cloudRun.mockImplementation(async (name) => {
      if (name === "loginuser") return SSO_USER;
      if (name === "getUserDetails") {
        return {
          get: (key) => (key === "UserRole" ? "contracts_Unmapped" : undefined)
        };
      }
      return undefined;
    });
    renderLogin();
    await userEvent.type(await screen.findByLabelText("email"), "a@b.co");
    await userEvent.type(screen.getByLabelText("password"), "secret");
    await submit();
    const company = await screen.findByLabelText(/company/);
    await userEvent.type(company, "Acme");
    await userEvent.type(screen.getByLabelText(/job-title/), "Engineer");
  };

  const submitAdditionalInfo = () => {
    const modal = screen.getByText("additional-info").closest("dialog");
    return userEvent.click(within(modal).getByText("login"));
  };

  beforeEach(() => {
    cloudRun.mockReset();
    notifyError.mockReset();
    notifyWarning.mockReset();
    localStorage.clear();
  });

  it("sends the signup with the local part of the email when the name is empty", async () => {
    await openAdditionalInfoModal();
    cloudRun.mockImplementation(async (name) => {
      if (name === "usersignup") return { message: "User already exist" };
      return undefined;
    });

    await submitAdditionalInfo();

    await waitFor(() =>
      expect(cloudRun).toHaveBeenCalledWith(
        "usersignup",
        expect.objectContaining({
          userDetails: expect.objectContaining({
            name: "sso.user",
            email: "sso.user@example.com",
            role: "contracts_User",
            company: "Acme",
            jobTitle: "Engineer"
          })
        })
      )
    );
  });

  it("keeps the name when the user already has one", async () => {
    await openAdditionalInfoModal();
    localStorage.setItem(
      "UserInformation",
      JSON.stringify({ ...SSO_USER, name: "Real Name" })
    );
    cloudRun.mockImplementation(async () => ({
      message: "User already exist"
    }));

    await submitAdditionalInfo();

    await waitFor(() =>
      expect(cloudRun).toHaveBeenCalledWith(
        "usersignup",
        expect.objectContaining({
          userDetails: expect.objectContaining({ name: "Real Name" })
        })
      )
    );
  });

  it("shows the server message instead of failing silently when the signup is rejected", async () => {
    await openAdditionalInfoModal();
    cloudRun.mockImplementation(async (name) => {
      if (name === "usersignup") {
        throw { code: 142, message: "Invalid role." };
      }
      return undefined;
    });

    await submitAdditionalInfo();

    await waitFor(() =>
      expect(notifyError).toHaveBeenCalledWith("Invalid role.")
    );
  });

  it("falls back to the generic message when the rejection has no message", async () => {
    await openAdditionalInfoModal();
    cloudRun.mockImplementation(async (name) => {
      if (name === "usersignup") throw {};
      return undefined;
    });

    await submitAdditionalInfo();

    await waitFor(() =>
      expect(notifyError).toHaveBeenCalledWith("something-went-wrong-mssg")
    );
  });

  it("lets the user submit again after a rejected signup", async () => {
    await openAdditionalInfoModal();
    cloudRun.mockImplementation(async (name) => {
      if (name === "usersignup") throw { message: "Invalid role." };
      return undefined;
    });
    await submitAdditionalInfo();
    await waitFor(() => expect(notifyError).toHaveBeenCalledTimes(1));

    await submitAdditionalInfo();

    await waitFor(() => expect(notifyError).toHaveBeenCalledTimes(2));
  });
});

describe("Login email verification step", () => {
  const VERIFIED_USER = { sessionToken: "session-token", email: "a@b.co" };

  const unverified = () =>
    Object.assign(new Error("Email not verified."), { code: 205 });

  const reachOtpStep = async () => {
    renderLogin();
    await userEvent.type(await screen.findByLabelText("email"), "a@b.co");
    await userEvent.type(screen.getByLabelText("password"), "secret");
    await submit();
    return screen.findByLabelText(/^verification-code/);
  };

  const submitOtp = async (code) => {
    await userEvent.type(screen.getByLabelText(/^verification-code/), code);
    await userEvent.click(screen.getByRole("button", { name: "verify" }));
  };

  const requireVerification = () =>
    cloudRun.mockImplementation(async (name) => {
      if (name === "loginuser") throw unverified();
      return undefined;
    });

  beforeEach(() => {
    cloudRun.mockReset();
    notifyError.mockReset();
    sendOtp.mockReset();
    sendOtp.mockResolvedValue(true);
    localStorage.clear();
  });

  it("switches to the otp step and sends the code when the server answers 205", async () => {
    requireVerification();

    await reachOtpStep();

    expect(sendOtp).toHaveBeenCalledWith("a@b.co");
    expect(screen.queryByLabelText("password")).toBeNull();
    expect(notifyError).not.toHaveBeenCalled();
  });

  it("verifies with email, password and otp and then runs the normal success path", async () => {
    cloudRun.mockImplementation(async (name) => {
      if (name === "loginuser") throw unverified();
      if (name === "verifyloginotp") return VERIFIED_USER;
      if (name === "getUserDetails") {
        return {
          get: (key) => (key === "UserRole" ? "contracts_Unmapped" : undefined)
        };
      }
      return undefined;
    });
    await reachOtpStep();

    await submitOtp("123456");

    await waitFor(() =>
      expect(cloudRun).toHaveBeenCalledWith("verifyloginotp", {
        email: "a@b.co",
        password: "secret",
        otp: "123456"
      })
    );
    await waitFor(() =>
      expect(localStorage.getItem("accesstoken")).toBe("session-token")
    );
    expect(JSON.parse(localStorage.getItem("UserInformation"))).toEqual(
      VERIFIED_USER
    );
    await waitFor(() =>
      expect(cloudRun).toHaveBeenCalledWith("getUserDetails")
    );
  });

  it("does not call the server when the code is not 6 digits", async () => {
    requireVerification();
    await reachOtpStep();

    await submitOtp("12");

    expect(cloudRun).not.toHaveBeenCalledWith(
      "verifyloginotp",
      expect.anything()
    );
    expect(screen.getByText("verification-code-invalid")).toHaveAttribute(
      "aria-live",
      "polite"
    );
    expect(screen.getByLabelText(/^verification-code/)).toHaveAttribute(
      "aria-describedby",
      "otp-error"
    );
  });

  it("shows the generic credentials-or-code message on 101 and stays on the step", async () => {
    cloudRun.mockImplementation(async (name) => {
      if (name === "loginuser") throw unverified();
      if (name === "verifyloginotp") throw { code: 101 };
      return undefined;
    });
    await reachOtpStep();

    await submitOtp("123456");

    expect(
      await screen.findByText("invalid-credentials-or-otp")
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/^verification-code/)).toBeInTheDocument();
  });

  it("shows the lock message on 155", async () => {
    cloudRun.mockImplementation(async (name) => {
      if (name === "loginuser") throw unverified();
      if (name === "verifyloginotp") throw { code: 155 };
      return undefined;
    });
    await reachOtpStep();

    await submitOtp("123456");

    expect(
      await screen.findByText("otp-too-many-attempts")
    ).toBeInTheDocument();
  });

  it("resends the code to the same email", async () => {
    requireVerification();
    await reachOtpStep();
    sendOtp.mockClear();

    await userEvent.click(screen.getByRole("button", { name: "resend" }));

    await waitFor(() => expect(sendOtp).toHaveBeenCalledWith("a@b.co"));
  });

  it("keeps the step open with a resend option when the first send is rejected", async () => {
    sendOtp.mockResolvedValue(false);
    requireVerification();

    await reachOtpStep();

    expect(screen.getByRole("button", { name: "resend" })).toBeInTheDocument();
  });

  it("returns to the credentials form from the otp step", async () => {
    requireVerification();
    await reachOtpStep();

    await userEvent.click(
      screen.getByRole("button", { name: "back-to-login" })
    );

    expect(await screen.findByLabelText("password")).toBeInTheDocument();
    expect(screen.queryByLabelText(/^verification-code/)).toBeNull();
  });

  it("clears the password from state when going back from the otp step", async () => {
    requireVerification();
    await reachOtpStep();

    await userEvent.click(
      screen.getByRole("button", { name: "back-to-login" })
    );

    expect(await screen.findByLabelText("password")).toHaveValue("");
  });

  it("clears the password from state after a successful verification", async () => {
    cloudRun.mockImplementation(async (name) => {
      if (name === "loginuser") throw unverified();
      if (name === "verifyloginotp") return VERIFIED_USER;
      if (name === "getUserDetails") {
        return {
          get: (key) => (key === "UserRole" ? "contracts_Unmapped" : undefined)
        };
      }
      return undefined;
    });
    await reachOtpStep();
    await submitOtp("123456");
    await waitFor(() =>
      expect(localStorage.getItem("accesstoken")).toBe("session-token")
    );

    await userEvent.click(
      screen.getByRole("button", { name: "back-to-login", hidden: true })
    );

    expect(await screen.findByLabelText("password")).toHaveValue("");
  });

  it("disables resend while a code is being sent", async () => {
    requireVerification();
    await reachOtpStep();
    let finishSend;
    sendOtp.mockClear();
    sendOtp.mockReturnValue(
      new Promise((resolve) => {
        finishSend = resolve;
      })
    );
    const resend = screen.getByRole("button", { name: "resend" });

    await userEvent.click(resend);
    await userEvent.click(resend);

    expect(sendOtp).toHaveBeenCalledTimes(1);
    expect(resend).toBeDisabled();
    finishSend(true);
    await waitFor(() => expect(resend).not.toBeDisabled());
  });

  it("maps a 429 during verification like the normal login", async () => {
    cloudRun.mockImplementation(async (name) => {
      if (name === "loginuser") throw unverified();
      if (name === "verifyloginotp") throw { code: 429 };
      return undefined;
    });
    await reachOtpStep();

    await submitOtp("123456");

    await waitFor(() =>
      expect(notifyError).toHaveBeenCalledWith("too-many-login-attempts")
    );
  });

  it("maps a connection failure during verification like the normal login", async () => {
    cloudRun.mockImplementation(async (name) => {
      if (name === "loginuser") throw unverified();
      if (name === "verifyloginotp") throw { code: 100 };
      return undefined;
    });
    await reachOtpStep();

    await submitOtp("123456");

    await waitFor(() =>
      expect(notifyError).toHaveBeenCalledWith("server-error")
    );
  });

  it("shows an inline hint when the first code could not be sent and clears it after a resend", async () => {
    sendOtp.mockResolvedValue(false);
    requireVerification();
    await reachOtpStep();

    expect(screen.getByText("otp-send-failed-hint")).toHaveAttribute(
      "aria-live",
      "polite"
    );

    sendOtp.mockResolvedValue(true);
    await userEvent.click(screen.getByRole("button", { name: "resend" }));

    await waitFor(() =>
      expect(screen.queryByText("otp-send-failed-hint")).toBeNull()
    );
  });

  it("leaves a normal login untouched", async () => {
    cloudRun.mockResolvedValue(null);
    renderLogin();
    await userEvent.type(await screen.findByLabelText("email"), "a@b.co");
    await userEvent.type(screen.getByLabelText("password"), "secret");
    await submit();

    await waitFor(() =>
      expect(cloudRun).toHaveBeenCalledWith("loginuser", expect.anything())
    );
    expect(sendOtp).not.toHaveBeenCalled();
    expect(screen.queryByLabelText(/^verification-code/)).toBeNull();
  });
});
