import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import PersonalInfoCard from "../PersonalInfoCard";

const noop = () => {};
const t = (key) => key;

const renderCard = (overrides = {}) =>
  render(
    <PersonalInfoCard
      t={t}
      editmode={false}
      name="Jane Doe"
      onNameChange={noop}
      nameError=""
      displayName="Jane Doe"
      phone="+1 555 0100"
      onPhoneChange={noop}
      phoneError=""
      savedPhone="+1 555 0100"
      email="user@example.com"
      isEmailVerified={false}
      onVerifyEmail={noop}
      {...overrides}
    />
  );

describe("PersonalInfoCard theme-aware text color", () => {
  it("applies text-base-content to the display-name value", () => {
    renderCard();
    expect(screen.getByTestId("display-name").className).toContain(
      "text-base-content"
    );
  });

  it("applies text-base-content to the display-phone value", () => {
    renderCard();
    expect(screen.getByTestId("display-phone").className).toContain(
      "text-base-content"
    );
  });

  it("applies text-base-content to the display-email value", () => {
    renderCard();
    expect(screen.getByTestId("display-email").className).toContain(
      "text-base-content"
    );
  });

  it("applies prominent primary button styling to the verify email button", () => {
    renderCard();
    expect(screen.getByTestId("verify-email-button").className).toContain(
      "op-btn-primary"
    );
  });
});
