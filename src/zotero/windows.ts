import { getString } from "../utils/locale";

type Ctrl = Record<string, any>;

/** Open one of refwright's chrome windows with a controller object. */
export function openRefwrightWindow(file: string, ctrl: Ctrl, size = "") {
  const main = Zotero.getMainWindow();
  return main.openDialog(
    `chrome://${addon.data.config.addonRef}/content/${file}`,
    "",
    `chrome,centerscreen,resizable,dialog=no${size}`,
    { wrappedJSObject: ctrl },
  ) as Window;
}

export const reviewLabels = () => ({
  title: getString("review-title"),
  apply: getString("review-apply"),
  cancel: getString("review-cancel"),
  tags: getString("lbl-tags"),
  collections: getString("lbl-collections"),
  source: getString("lbl-source"),
  remove: getString("lbl-remove"),
  addTag: getString("review-add-tag"),
  you: getString("lbl-you"),
  noTags: getString("tags-none"),
  noCollections: getString("lbl-no-collections"),
  matched: getString("lbl-matched"),
  score: getString("lbl-score"),
  retry: getString("lbl-retry"),
  empty: getString("review-no-items"),
  toggleAll: getString("lbl-toggle-all"),
});
