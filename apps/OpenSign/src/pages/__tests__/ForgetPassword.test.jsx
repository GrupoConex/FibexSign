import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ForgotPassword from "../ForgetPassword";

const requestPasswordReset = vi.fn();

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal()),
  useTranslation: () => ({ t: (key) => key })
}));

vi.mock("react-redux", () => ({ useDispatch: () => vi.fn() }));
vi.mock("react-router", () => ({ useNavigate: () => vi.fn() }));

vi.mock("parse", () => ({
  default: {
    User: {
      requestPasswordReset: (...args) => requestPasswordReset(...args),
      logOut: vi.fn().mockResolvedValue(undefined)
    }
  }
}));

vi.mock("../../redux/reducers/infoReducer", () => ({
  fetchAppInfo: () => ({ type: "info/fetch" })
}));
vi.mock("../../components/auth/AuthLayout", () => ({
  default: ({ children }) => <div>{children}</div>
}));
vi.mock("../../components/pdf/SelectLanguage", () => ({ default: () => null }));
vi.mock("../../primitives/Icon", () => ({ default: () => null }));
vi.mock("../../utils", () => ({
  notify: { success: vi.fn(), error: vi.fn(), warning: vi.fn() }
}));

const liveMessages = (container) =>
  container.querySelectorAll("[aria-live='polite']");

const submit = () =>
  userEvent.click(screen.getByRole("button", { name: "submit" }));

describe("ForgotPassword inline validation", () => {
  beforeEach(() => {
    requestPasswordReset.mockReset();
  });

  it("shows the required message and blocks the request when empty", async () => {
    render(<ForgotPassword />);
    await submit();

    const input = screen.getByLabelText("email");
    expect(screen.getByText("input-required")).toBeInTheDocument();
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", "email-error");
    expect(input).toHaveClass("op-input-error");
    expect(requestPasswordReset).not.toHaveBeenCalled();
  });

  it("shows the invalid email message and clears it once fixed", async () => {
    const { container } = render(<ForgotPassword />);
    const input = screen.getByLabelText("email");
    await userEvent.type(input, "bad@mail");
    await submit();

    expect(screen.getByText("valid-email-alert")).toBeInTheDocument();
    expect(requestPasswordReset).not.toHaveBeenCalled();

    await userEvent.type(input, ".com");
    await waitFor(() => expect(liveMessages(container)).toHaveLength(0));
    expect(input).toHaveAttribute("aria-invalid", "false");
  });

  it("does not validate on blur before the first submit", async () => {
    const { container } = render(<ForgotPassword />);
    await userEvent.click(screen.getByLabelText("email"));
    await userEvent.tab();

    expect(liveMessages(container)).toHaveLength(0);
  });

  it("validates on blur after a failed submit", async () => {
    const { container } = render(<ForgotPassword />);
    const input = screen.getByLabelText("email");
    await userEvent.type(input, "bad");
    await submit();
    await userEvent.clear(input);
    await userEvent.tab();

    expect(screen.getByText("input-required")).toBeInTheDocument();
    expect(liveMessages(container)).toHaveLength(1);
  });

  it("requests the reset when the email is valid", async () => {
    requestPasswordReset.mockResolvedValue(undefined);
    const { container } = render(<ForgotPassword />);
    await userEvent.type(screen.getByLabelText("email"), "a@b.co");
    await submit();

    await waitFor(() =>
      expect(requestPasswordReset).toHaveBeenCalledWith("a@b.co")
    );
    expect(liveMessages(container)).toHaveLength(0);
  });
});
