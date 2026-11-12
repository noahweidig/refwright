import { SVec } from "./vec";

/** Sublinear TF x smoothed IDF, over a fixed document set. */
export class TfIdf {
  private df = new Map<string, number>();
  private n = 0;
  constructor(docs: string[][] = []) {
    for (const d of docs) this.add(d);
  }
  add(tokens: string[]) {
    this.n++;
    for (const t of new Set(tokens)) this.df.set(t, (this.df.get(t) ?? 0) + 1);
  }
  get size() {
    return this.n;
  }
  idf(t: string): number {
    return Math.log((this.n + 1) / ((this.df.get(t) ?? 0) + 1)) + 1;
  }
  vector(tokens: string[]): SVec {
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    const v: SVec = new Map();
    for (const [t, c] of tf) v.set(t, (1 + Math.log(c)) * this.idf(t));
    return v;
  }
}
