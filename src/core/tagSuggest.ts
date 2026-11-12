import { tokenize } from "./text";
import { TfIdf } from "./tfidf";
import { cosine } from "./vec";

export interface TItem {
  id: number;
  title: string;
  abstract?: string;
  tags: string[];
}
export interface Proposal {
  tag: string;
  source: string;
  score?: number;
}

export class LibraryTagIndex {
  private tf: TfIdf;
  private rows: { it: TItem; v: Map<string, number> }[];
  constructor(items: TItem[]) {
    const tok = items.map((i) =>
      tokenize(`${i.title} ${i.title} ${i.abstract ?? ""}`),
    );
    this.tf = new TfIdf(tok);
    this.rows = items.map((it, i) => ({ it, v: this.tf.vector(tok[i]) }));
  }
  get tagged() {
    return this.rows.filter((r) => r.it.tags.length).length;
  }
  /** 8 nearest tagged items, tags carried by >= minVotes of them */
  suggest(
    paper: TItem,
    { k = 8, minVotes = 2, minTagged = 30 } = {},
  ): Proposal[] {
    if (this.tagged < minTagged) return [];
    const v = this.tf.vector(
      tokenize(`${paper.title} ${paper.title} ${paper.abstract ?? ""}`),
    );
    const near = this.rows
      .filter((r) => r.it.id !== paper.id && r.it.tags.length)
      .map((r) => ({ r, s: cosine(v, r.v) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, k);
    const votes = new Map<string, { n: number; s: number; name: string }>();
    for (const { r, s } of near)
      for (const t of new Set(r.it.tags)) {
        const key = t.toLowerCase();
        const e = votes.get(key) ?? { n: 0, s: 0, name: t };
        e.n++;
        e.s += s;
        votes.set(key, e);
      }
    return [...votes.values()]
      .filter((e) => e.n >= minVotes)
      .sort((a, b) => b.n - a.n || b.s - a.s)
      .map((e) => ({ tag: e.name, source: "Your library", score: e.s }));
  }
}
