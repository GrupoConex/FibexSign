import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import AuthLayout from "../AuthLayout";

vi.mock("../../ThemeToggle", () => ({ default: () => null }));

describe("AuthLayout root width", () => {
  it("spans the full width so split columns do not collapse inside a flex parent", () => {
    const { container } = render(
      <div className="min-h-screen flex justify-center">
        <AuthLayout>
          <span>content</span>
        </AuthLayout>
      </div>
    );

    const layoutRoot = container.firstChild.firstChild;

    expect(layoutRoot).toHaveClass("w-full");
  });
});
