import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ProfessionalInfoCard from "../ProfessionalInfoCard";

const noop = () => {};
const t = (key) => key;

const renderCard = (overrides = {}) =>
  render(
    <ProfessionalInfoCard
      t={t}
      editmode={false}
      company="Acme Corp"
      onCompanyChange={noop}
      displayCompany="Acme Corp"
      jobTitle="Engineer"
      onJobTitleChange={noop}
      displayJobTitle="Engineer"
      userRole="Admin"
      roleBadgeClass="op-badge-primary"
      {...overrides}
    />
  );

describe("ProfessionalInfoCard theme-aware text color", () => {
  it("applies text-base-content to the display-company value", () => {
    renderCard();
    expect(screen.getByTestId("display-company").className).toContain(
      "text-base-content"
    );
  });

  it("applies text-base-content to the display-job-title value", () => {
    renderCard();
    expect(screen.getByTestId("display-job-title").className).toContain(
      "text-base-content"
    );
  });
});
