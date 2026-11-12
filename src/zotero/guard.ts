/** Run a UI action; show any error on screen and in Zotero's debug log. */
export function guard<A extends unknown[]>(fn: (...a: A) => unknown) {
  return async (...a: A) => {
    try {
      return await fn(...a);
    } catch (e: any) {
      Zotero.logError(e);
      new ztoolkit.ProgressWindow(addon.data.config.addonName, {
        closeOnClick: true,
        closeTime: 9000,
      })
        .createLine({
          text: String(e?.message ?? e),
          type: "error",
          progress: 100,
        })
        .show();
    }
  };
}
