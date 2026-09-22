import { act, renderHook } from "@testing-library/react";
import { useIsDarkTheme } from "../useIsDarkTheme";

function setDataTheme(theme) {
  if (theme === null) {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", theme);
  }
}

describe("useIsDarkTheme", () => {
  afterEach(() => {
    setDataTheme(null);
  });

  it("returns false when data-theme is not opensigndark", () => {
    setDataTheme("opensignlight");
    const { result } = renderHook(() => useIsDarkTheme());
    expect(result.current).toBe(false);
  });

  it("returns true when data-theme is opensigndark on mount", () => {
    setDataTheme("opensigndark");
    const { result } = renderHook(() => useIsDarkTheme());
    expect(result.current).toBe(true);
  });

  it("returns false when data-theme attribute is absent", () => {
    setDataTheme(null);
    const { result } = renderHook(() => useIsDarkTheme());
    expect(result.current).toBe(false);
  });

  it("updates when data-theme changes after mount", async () => {
    setDataTheme("opensignlight");
    const { result } = renderHook(() => useIsDarkTheme());
    expect(result.current).toBe(false);

    await act(async () => {
      setDataTheme("opensigndark");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(result.current).toBe(true);
  });

  it("updates back to false when data-theme changes away from opensigndark", async () => {
    setDataTheme("opensigndark");
    const { result } = renderHook(() => useIsDarkTheme());
    expect(result.current).toBe(true);

    await act(async () => {
      setDataTheme("opensignlight");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(result.current).toBe(false);
  });

  it("disconnects the observer on unmount without throwing", () => {
    setDataTheme("opensigndark");
    const { unmount } = renderHook(() => useIsDarkTheme());
    expect(() => unmount()).not.toThrow();
  });
});
