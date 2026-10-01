import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import OtpCodeField from "../OtpCodeField";

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal()),
  useTranslation: () => ({ t: (key) => key })
}));

describe("OtpCodeField", () => {
  it("exposes a labelled numeric one-time-code input", () => {
    render(<OtpCodeField value="" onChange={vi.fn()} />);

    const input = screen.getByLabelText("verification-code");
    expect(input).not.toHaveAttribute("maxlength");
    expect(input).toHaveAttribute("pattern", "[0-9]{6}");
    expect(input).toHaveAttribute("inputmode", "numeric");
    expect(input).toHaveAttribute("autocomplete", "one-time-code");
    expect(input).toHaveAttribute("aria-invalid", "false");
    expect(input).not.toHaveAttribute("aria-describedby");
  });

  it("strips non digit characters before notifying the change", async () => {
    const onChange = vi.fn();
    render(<OtpCodeField value="" onChange={onChange} />);

    await userEvent.type(screen.getByLabelText("verification-code"), "a");
    expect(onChange).not.toHaveBeenCalledWith("a");

    await userEvent.paste("1b2");
    expect(onChange).toHaveBeenLastCalledWith("12");
  });

  it.each(["123 456", "123-456", "123456789"])(
    "normalizes the pasted code %s to six digits",
    async (pasted) => {
      const onChange = vi.fn();
      render(<OtpCodeField value="" onChange={onChange} />);

      await userEvent.click(screen.getByLabelText("verification-code"));
      await userEvent.paste(pasted);

      expect(onChange).toHaveBeenLastCalledWith(
        pasted.replace(/\D/g, "").slice(0, 6)
      );
    }
  );

  it("announces the translated error and links it to the input", () => {
    render(
      <OtpCodeField
        value="12"
        onChange={vi.fn()}
        errorKey="verification-code-invalid"
      />
    );

    const input = screen.getByLabelText("verification-code");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", "otp-error");
    expect(input).toHaveClass("op-input-error");
    expect(screen.getByText("verification-code-invalid")).toHaveAttribute(
      "id",
      "otp-error"
    );
  });
});
