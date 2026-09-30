import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AddAdmin from "../AddAdmin";

const cloudRun = vi.fn();
const requestPasswordReset = vi.fn();
const notifySuccess = vi.fn();
const notifyError = vi.fn();

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal()),
  useTranslation: () => ({
    t: (key) => key,
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
  container.querySelectorAll("[aria-live='polite']");

const submit = () =>
  userEvent.click(screen.getByRole("button", { name: "next" }));

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
    expect(screen.getByRole("checkbox")).toHaveAttribute("aria-invalid", "true");
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
    await submit();

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
    await submit();

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
    await submit();

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
    await submit();

    await waitFor(() => expect(notifyError).toHaveBeenCalledWith("boom"));
    expect(await screen.findByLabelText(/^name/)).toBeInTheDocument();
    expect(requestPasswordReset).not.toHaveBeenCalled();
  });
});
