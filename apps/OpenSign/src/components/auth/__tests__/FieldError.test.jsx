import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import FieldError from "../FieldError";

describe("FieldError", () => {
  it("renders nothing without a message", () => {
    const { container } = render(<FieldError id="email-error" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for an empty message", () => {
    const { container } = render(<FieldError id="email-error" message="" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a polite live region with id and message", () => {
    render(<FieldError id="email-error" message="Required" />);
    const message = screen.getByText("Required");
    expect(message).toHaveAttribute("id", "email-error");
    expect(message).toHaveAttribute("aria-live", "polite");
    expect(message).not.toHaveAttribute("role");
    expect(message).toHaveClass("text-xs", "text-red-500", "mt-1");
  });
});
