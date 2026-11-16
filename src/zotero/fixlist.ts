/** What the "fix list" window shows and runs. Used by the library health report and the preprint upgrade. */
export interface FixRow {
  key: string;
  title: string;
  /** Zotero item type, for the row icon */
  itemType?: string;
  lines: string[];
  fixable: boolean;
}
export interface FixSection {
  id: string;
  label: string;
  rows: FixRow[];
}
export interface FixOption {
  id: string;
  label: string;
  on: boolean;
}
export interface Job {
  sections: FixSection[];
  options?: FixOption[];
  run(
    keys: string[],
    opts: Record<string, boolean>,
    report: (key: string, ok: boolean, text: string) => void,
    signal: AbortSignal,
  ): Promise<void>;
}

export const count = (sections: FixSection[]) =>
  sections.reduce((n, s) => n + s.rows.length, 0);
