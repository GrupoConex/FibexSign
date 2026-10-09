import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AddAdmin from "../AddAdmin";

const cloudRun = vi.fn();
const requestPasswordReset = vi.fn();
const notifySuccess = vi.fn();
const notifyError = vi.fn();
const sendOtp = vi.fn();

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal()),
  useTranslation: () => ({
    t: (key, options) =>
      options?.seconds === undefined ? key : `${key}:${options.seconds}`,
    i18n: { language: "en", changeLanguage: () => Promise.resolve() }
  })
}));

vi.mock("react-redux", () => ({ useDispatch: () => vi.fn() }));
vi.mock("react-router", () => ({ useNavigate: () => vi.fn() }));

vi.mock("parse", () => ({
  default: {
    Cloud: { run: (...args) => cloudRun(...args) },
    User: {
      become: vi.fn(),
      logOut: vi.fn(),
      requestPasswordReset: (...args) => requestPasswordReset(...args)
    }
  }
}));

vi.mock("../../constant/Utils", async (importOriginal) => ({
  ...(await importOriginal()),
  getAppLogo: vi.fn().mockResolvedValue({ user: "not_exist" }),
  handleSendOTP: (...args) => sendOtp(...args),
  saveLanguageInLocal: vi.fn(),
  usertimezone: "UTC"
}));
vi.mock("../../components/auth/AuthLayout", () => ({
  default: ({ children }) => <div>{children}</div>
}));
vi.mock("../../primitives/Icon", () => ({ default: () => null }));
vi.mock("../../utils", () => ({
  notify: {
    success: (...args) => notifySuccess(...args),
    error: (...args) => notifyError(...args),
    warning: vi.fn()
  }
}));

const liveMessages = (container) =>
  container.querySelectorAll("[aria-live='polite']:not([role='status'])");

const submit = () =>
  userEvent.click(
    screen.getByRole("button", { name: /^(next|send-verification-code)$/ })
  );

const requestCode = () =>
  userEvent.click(
    screen.getByRole("button", { name: "send-verification-code" })
  );

const submitWithOtp = async (code = "123456") => {
  await requestCode();
  await userEvent.type(
    await screen.findByLabelText(/^verification-code/),
    code
  );
  await submit();
};

const fillValidForm = async () => {
  await userEvent.type(await screen.findByLabelText(/^name/), "Ada");
  await userEvent.type(screen.getByLabelText(/^email/), "ada@example.com");
  await userEvent.type(screen.getByLabelText(/^phone/), "0412");
  await userEvent.type(screen.getByLabelText(/^company/), "Fibex");
  await userEvent.type(screen.getByLabelText(/^job-title/), "CTO");
  await userEvent.type(screen.getByLabelText(/^password/), "Abcdef1!");
  await userEvent.click(screen.getByRole("checkbox"));
};

describe("AddAdmin inline validation", () => {
  beforeEach(() => {
    cloudRun.mockReset();
    requestPasswordReset.mockReset();
    notifySuccess.mockReset();
    notifyError.mockReset();
    sendOtp.mockReset();
    sendOtp.mockResolvedValue(true);
    localStorage.clear();
  });

  it("shows a message for every field, focuses the first and blocks the request when empty", async () => {
    const { container } = render(<AddAdmin />);
    await screen.findByLabelText(/^name/);
    await submit();

    expect(liveMessages(container)).toHaveLength(7);
    expect(screen.getByLabelText(/^name/)).toHaveFocus();
    expect(screen.getByLabelText(/^name/)).toHaveAttribute(
      "aria-invalid",
      "true"
    );
    expect(screen.getByLabelText(/^email/)).toHaveAttribute(
      "aria-describedby",
      "email-error"
    );
    expect(screen.getByLabelText(/^email/)).toHaveClass("op-input-error");
    expect(screen.getByLabelText(/^password/)).toHaveAttribute(
      "aria-invalid",
      "true"
    );
    expect(screen.getByRole("checkbox")).toHaveAttribute(
      "aria-invalid",
      "true"
    );
    expect(screen.getByText("accept-terms-required")).toBeInTheDocument();
    expect(cloudRun).not.toHaveBeenCalled();
  });

  it("focuses the first invalid field when earlier fields are valid", async () => {
    render(<AddAdmin />);
    await fillValidForm();
    await userEvent.clear(screen.getByLabelText(/^company/));
    await submit();

    expect(screen.getByLabelText(/^company/)).toHaveFocus();
    expect(cloudRun).not.toHaveBeenCalled();
  });

  it("does not validate on blur before the first submit", async () => {
    const { container } = render(<AddAdmin />);
    await userEvent.click(await screen.findByLabelText(/^name/));
    await userEvent.tab();

    expect(liveMessages(container)).toHaveLength(0);
  });

  it("validates on blur after a failed submit", async () => {
    const { container } = render(<AddAdmin />);
    const name = await screen.findByLabelText(/^name/);
    await submit();
    await userEvent.type(name, "Ada");
    await waitFor(() => expect(liveMessages(container)).toHaveLength(6));

    await userEvent.clear(name);
    await userEvent.tab();
    expect(liveMessages(container)).toHaveLength(7);
  });

  it("shows the invalid email message and clears it once fixed", async () => {
    render(<AddAdmin />);
    const email = await screen.findByLabelText(/^email/);
    await userEvent.type(email, "bad@mail");
    await submit();

    expect(screen.getByText("valid-email-alert")).toBeInTheDocument();

    await userEvent.type(email, ".com");
    await waitFor(() =>
      expect(screen.queryByText("valid-email-alert")).toBeNull()
    );
    expect(email).toHaveAttribute("aria-invalid", "false");
  });

  it("shows the requirements message for a weak password", async () => {
    render(<AddAdmin />);
    await fillValidForm();
    const password = screen.getByLabelText(/^password/);
    await userEvent.clear(password);
    await userEvent.type(password, "weak");
    await submit();

    expect(
      screen.getByText("password-requirements-not-met")
    ).toBeInTheDocument();
    expect(password).toHaveFocus();
    expect(cloudRun).not.toHaveBeenCalled();
  });

  it("calls addadmin and stores userDetails when the form is valid", async () => {
    cloudRun.mockResolvedValue({});
    render(<AddAdmin />);
    await fillValidForm();
    await submitWithOtp();

    await waitFor(() =>
      expect(cloudRun).toHaveBeenCalledWith(
        "addadmin",
        expect.objectContaining({
          userDetails: expect.objectContaining({
            email: "ada@example.com",
            password: "Abcdef1!"
          })
        })
      )
    );
    expect(JSON.parse(localStorage.getItem("userDetails"))).toEqual({
      name: "Ada",
      email: "ada@example.com",
      phone: "0412",
      company: "Fibex",
      jobTitle: "CTO"
    });
  });
});

describe("AddAdmin backend error handling", () => {
  beforeEach(() => {
    cloudRun.mockReset();
    requestPasswordReset.mockReset();
    notifySuccess.mockReset();
    notifyError.mockReset();
    sendOtp.mockReset();
    sendOtp.mockResolvedValue(true);
    localStorage.clear();
  });

  it("notifies and restores the form when the user already exists", async () => {
    cloudRun.mockImplementation((name) =>
      name === "addadmin"
        ? Promise.reject({ code: 202 })
        : Promise.resolve({ exists: true })
    );
    render(<AddAdmin />);
    await fillValidForm();
    await submitWithOtp();

    await waitFor(() =>
      expect(notifyError).toHaveBeenCalledWith("already-exists-this-username")
    );
    expect(cloudRun).toHaveBeenCalledWith("getUserDetails", {
      email: "ada@example.com"
    });
    expect(requestPasswordReset).not.toHaveBeenCalled();
    expect(await screen.findByLabelText(/^name/)).toBeInTheDocument();
    expect(screen.queryByText("loading")).toBeNull();
  });

  it("requests a password reset when code 202 and the user does not exist", async () => {
    cloudRun.mockImplementation((name) =>
      name === "addadmin"
        ? Promise.reject({ code: 202 })
        : Promise.resolve({ exists: false })
    );
    requestPasswordReset.mockResolvedValue({});
    render(<AddAdmin />);
    await fillValidForm();
    await submitWithOtp();

    await waitFor(() =>
      expect(requestPasswordReset).toHaveBeenCalledWith("ada@example.com")
    );
    await waitFor(() =>
      expect(notifySuccess).toHaveBeenCalledWith("verification-code-sent")
    );
    expect(await screen.findByLabelText(/^name/)).toBeInTheDocument();
  });

  it("notifies the server message on a generic error", async () => {
    cloudRun.mockRejectedValue({ code: 500, message: "boom" });
    render(<AddAdmin />);
    await fillValidForm();
    await submitWithOtp();

    await waitFor(() => expect(notifyError).toHaveBeenCalledWith("boom"));
    expect(await screen.findByLabelText(/^name/)).toBeInTheDocument();
    expect(requestPasswordReset).not.toHaveBeenCalled();
  });
});

describe("AddAdmin email ownership step", () => {
  beforeEach(() => {
    cloudRun.mockReset();
    requestPasswordReset.mockReset();
    notifySuccess.mockReset();
    notifyError.mockReset();
    sendOtp.mockReset();
    sendOtp.mockResolvedValue(true);
    localStorage.clear();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const endCooldown = () =>
    act(() => {
      vi.advanceTimersByTime(60000);
    });

  it("requests the code for the typed email and does not call addadmin yet", async () => {
    render(<AddAdmin />);
    await fillValidForm();
    await requestCode();

    await waitFor(() =>
      expect(sendOtp).toHaveBeenCalledWith("ada@example.com")
    );
    expect(cloudRun).not.toHaveBeenCalled();
    expect(
      await screen.findByLabelText(/^verification-code/)
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "next" })).toBeInTheDocument();
  });

  it("does not show the code step when the code could not be sent", async () => {
    sendOtp.mockResolvedValue(false);
    render(<AddAdmin />);
    await fillValidForm();
    await requestCode();

    await waitFor(() => expect(sendOtp).toHaveBeenCalled());
    expect(screen.queryByLabelText(/^verification-code/)).toBeNull();
  });

  it("sends userDetails together with the otp", async () => {
    cloudRun.mockResolvedValue({});
    render(<AddAdmin />);
    await fillValidForm();
    await submitWithOtp("654321");

    await waitFor(() =>
      expect(cloudRun).toHaveBeenCalledWith("addadmin", {
        userDetails: expect.objectContaining({
          email: "ada@example.com",
          password: "Abcdef1!",
          role: "contracts_Admin"
        }),
        otp: "654321"
      })
    );
  });

  it("blocks the request and announces an error when the code is not 6 digits", async () => {
    render(<AddAdmin />);
    await fillValidForm();
    await submitWithOtp("12");

    expect(cloudRun).not.toHaveBeenCalled();
    const otp = screen.getByLabelText(/^verification-code/);
    expect(otp).toHaveAttribute("aria-invalid", "true");
    expect(otp).toHaveAttribute("aria-describedby", "otp-error");
    expect(screen.getByText("verification-code-invalid")).toHaveAttribute(
      "aria-live",
      "polite"
    );
  });

  it("shows the invalid code message and stays on the step for error 142", async () => {
    cloudRun.mockRejectedValue({ code: 142, message: "OTP is invalid." });
    render(<AddAdmin />);
    await fillValidForm();
    await submitWithOtp();

    expect(
      await screen.findByText("verification-code-invalid")
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/^verification-code/)).toHaveValue("123456");
    expect(screen.getByRole("button", { name: "next" })).toBeInTheDocument();
    expect(notifyError).not.toHaveBeenCalledWith("OTP is invalid.");
  });

  it("shows the lock message for error 155", async () => {
    cloudRun.mockRejectedValue({
      code: 155,
      message: "Too many OTP attempts."
    });
    render(<AddAdmin />);
    await fillValidForm();
    await submitWithOtp();

    expect(
      await screen.findByText("otp-too-many-attempts")
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/^verification-code/)).toBeInTheDocument();
  });

  it("resends the code to the same email", async () => {
    render(<AddAdmin />);
    await fillValidForm();
    await requestCode();
    await screen.findByLabelText(/^verification-code/);
    sendOtp.mockClear();
    endCooldown();

    await userEvent.click(screen.getByRole("button", { name: "resend" }));

    await waitFor(() =>
      expect(sendOtp).toHaveBeenCalledWith("ada@example.com")
    );
  });

  it("confirms the first send in a persistent polite status region without a toast", async () => {
    render(<AddAdmin />);
    await fillValidForm();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    await requestCode();

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("otp-sent-to-email")
    );
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
    expect(notifySuccess).not.toHaveBeenCalled();
  });

  it("keeps the status region in the accessibility tree when it is empty", async () => {
    render(<AddAdmin />);
    await fillValidForm();

    const status = screen.getByRole("status");
    expect(status).toHaveClass("empty:sr-only");
    expect(status).not.toHaveClass("empty:hidden");
  });

  it("empties the notice while resending and then announces the resent text", async () => {
    render(<AddAdmin />);
    await fillValidForm();
    await requestCode();
    await screen.findByLabelText(/^verification-code/);
    endCooldown();
    let finishResend;
    sendOtp.mockReturnValueOnce(
      new Promise((resolve) => {
        finishResend = resolve;
      })
    );

    await userEvent.click(screen.getByRole("button", { name: "resend" }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toBeEmptyDOMElement()
    );
    await act(async () => {
      finishResend(true);
    });
    expect(screen.getByRole("status")).toHaveTextContent("otp-resent-to-email");
  });

  it("returns the focus to the code input after a resend", async () => {
    render(<AddAdmin />);
    await fillValidForm();
    await requestCode();
    await screen.findByLabelText(/^verification-code/);
    endCooldown();

    await userEvent.click(screen.getByRole("button", { name: "resend" }));

    await waitFor(() =>
      expect(screen.getByLabelText(/^verification-code/)).toHaveFocus()
    );
  });

  it("does not mark the new email as sent when it changes while a send is in flight", async () => {
    let finishFirst;
    sendOtp.mockReturnValueOnce(
      new Promise((resolve) => {
        finishFirst = resolve;
      })
    );
    render(<AddAdmin />);
    await fillValidForm();
    await requestCode();
    await waitFor(() => expect(sendOtp).toHaveBeenCalledTimes(1));
    await userEvent.type(screen.getByLabelText(/^email/), "x");

    await act(async () => {
      finishFirst(true);
    });

    expect(screen.queryByLabelText(/^verification-code/)).toBeNull();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(screen.queryByText(/resend-in-seconds/)).toBeNull();
    await requestCode();
    await waitFor(() => expect(sendOtp).toHaveBeenCalledTimes(2));
    expect(sendOtp).toHaveBeenLastCalledWith("ada@example.comx");
  });

  it("disables resend with a countdown after a send and keeps next enabled", async () => {
    render(<AddAdmin />);
    await fillValidForm();
    await requestCode();

    const resend = await screen.findByRole("button", {
      name: "resend-in-seconds:60"
    });
    expect(resend).toBeDisabled();
    expect(screen.getByRole("button", { name: "next" })).toBeEnabled();
    act(() => {
      vi.advanceTimersByTime(7000);
    });
    expect(
      await screen.findByRole("button", { name: "resend-in-seconds:53" })
    ).toBeDisabled();
  });

  it("confirms each resend and restarts the cooldown", async () => {
    render(<AddAdmin />);
    await fillValidForm();
    await requestCode();
    await screen.findByLabelText(/^verification-code/);
    endCooldown();
    notifySuccess.mockClear();

    await userEvent.click(screen.getByRole("button", { name: "resend" }));

    await waitFor(() => expect(sendOtp).toHaveBeenCalledTimes(2));
    expect(notifySuccess).not.toHaveBeenCalled();
    expect(
      await screen.findByRole("button", { name: "resend-in-seconds:60" })
    ).toBeDisabled();
  });

  it("does not start a cooldown nor confirm when the send fails", async () => {
    sendOtp.mockResolvedValue(false);
    render(<AddAdmin />);
    await fillValidForm();

    await requestCode();

    await waitFor(() => expect(sendOtp).toHaveBeenCalledTimes(1));
    expect(notifySuccess).not.toHaveBeenCalled();
    expect(screen.queryByText(/resend-in-seconds/)).toBeNull();
    expect(
      screen.getByRole("button", { name: "send-verification-code" })
    ).toBeEnabled();
  });

  it("sends only once on a double click of resend", async () => {
    render(<AddAdmin />);
    await fillValidForm();
    await requestCode();
    await screen.findByLabelText(/^verification-code/);
    endCooldown();
    sendOtp.mockClear();

    await userEvent.dblClick(screen.getByRole("button", { name: "resend" }));

    expect(sendOtp).toHaveBeenCalledTimes(1);
  });

  it("lets a new email request a code right away after editing", async () => {
    render(<AddAdmin />);
    await fillValidForm();
    await requestCode();
    await screen.findByLabelText(/^verification-code/);

    await userEvent.type(screen.getByLabelText(/^email/), "x");

    expect(screen.queryByText(/resend-in-seconds/)).toBeNull();
    expect(
      screen.getByRole("button", { name: "send-verification-code" })
    ).toBeEnabled();
  });

  it("discards the code step when the email is edited", async () => {
    render(<AddAdmin />);
    await fillValidForm();
    await requestCode();
    await screen.findByLabelText(/^verification-code/);

    await userEvent.type(screen.getByLabelText(/^email/), "x");

    expect(screen.queryByLabelText(/^verification-code/)).toBeNull();
    expect(
      screen.getByRole("button", { name: "send-verification-code" })
    ).toBeInTheDocument();
  });
});
