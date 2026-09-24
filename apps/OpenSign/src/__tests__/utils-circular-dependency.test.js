describe("Utils.js module-level circular dependency with appinfo.js", () => {
  it("loads without throwing a TDZ ReferenceError when imported before appinfo.js", async () => {
    const loadUtils = () => import("../constant/Utils.js");

    await expect(loadUtils()).resolves.toBeDefined();
  }, 20000);

  it("resolves defaultMailBody without depending on the appinfo.js circular import", async () => {
    const utilsModule = await import("../constant/Utils.js");

    expect(utilsModule.defaultMailBody).toContain("Team Firma");
  });
});
