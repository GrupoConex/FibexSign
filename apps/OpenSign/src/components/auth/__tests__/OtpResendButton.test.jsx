import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import OtpResendButton from "../OtpResendButton";

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal()),
  useTranslation: () => ({
    t: (key, options) =>
      options?.seconds === undefined ? key : `${key}:${options.seconds}`
  })
}));

describe("OtpResendButton", () => {
  it("shows the resend label and fires onClick when idle", async () => {
    const onClick = vi.fn();
    render(
      <OtpResendButton onClick={onClick} isDisabled={false} secondsLeft={0} />
    );
    await userEvent.click(screen.getByRole("button", { name: "resend" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("shows the countdown and is disabled during the cooldown", () => {
    render(<OtpResendButton onClick={vi.fn()} isDisabled secondsLeft={42} />);
    const button = screen.getByRole("button", { name: "resend-in-seconds:42" });
    expect(button).toBeDisabled();
  });

  it("keeps the resend label while disabled by an in-flight request", () => {
    render(<OtpResendButton onClick={vi.fn()} isDisabled secondsLeft={0} />);
    expect(screen.getByRole("button", { name: "resend" })).toBeDisabled();
  });

  it("renders as a non-submit button with the given class", () => {
    render(
      <OtpResendButton
        onClick={vi.fn()}
        isDisabled={false}
        secondsLeft={0}
        className="op-btn op-btn-ghost"
      />
    );
    const button = screen.getByRole("button", { name: "resend" });
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveClass("op-btn-ghost");
  });

  it("shows the loading label while sending", () => {
    render(
      <OtpResendButton onClick={vi.fn()} isDisabled isSending secondsLeft={0} />
    );
    expect(screen.getByRole("button", { name: "loading" })).toBeDisabled();
  });

  it("calls onClick without forwarding the click event", async () => {
    const onClick = vi.fn();
    render(
      <OtpResendButton onClick={onClick} isDisabled={false} secondsLeft={0} />
    );
    await userEvent.click(screen.getByRole("button", { name: "resend" }));
    expect(onClick).toHaveBeenCalledWith();
  });

  it("describes the full cooldown with static screen reader text", () => {
    const { rerender } = render(
      <OtpResendButton onClick={vi.fn()} isDisabled secondsLeft={60} />
    );
    const button = screen.getByRole("button", { name: "resend-in-seconds:60" });
    const hint = screen.getByText("resend-available-in-seconds:60");
    expect(hint).toHaveClass("sr-only");
    expect(button).toHaveAttribute("aria-describedby", hint.id);
    rerender(<OtpResendButton onClick={vi.fn()} isDisabled secondsLeft={41} />);
    expect(
      screen.getByText("resend-available-in-seconds:60")
    ).toBeInTheDocument();
  });

  it("renders no screen reader hint outside the cooldown", () => {
    render(
      <OtpResendButton onClick={vi.fn()} isDisabled={false} secondsLeft={0} />
    );
    expect(screen.queryByText(/resend-available-in-seconds/)).toBeNull();
  });

  it("returns the focus to the given element once the send settles", async () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    const onClick = vi.fn().mockResolvedValue(true);
    render(
      <OtpResendButton
        onClick={onClick}
        isDisabled={false}
        secondsLeft={0}
        returnFocusTo={() => input}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: "resend" }));
    await waitFor(() => expect(input).toHaveFocus());
    input.remove();
  });
});
