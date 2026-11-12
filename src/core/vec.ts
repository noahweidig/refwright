export type SVec = Map<string, number>;

export function dot(a: SVec, b: SVec): number {
  if (a.size > b.size) [a, b] = [b, a];
  let s = 0;
  for (const [k, v] of a) {
    const w = b.get(k);
    if (w) s += v * w;
  }
  return s;
}
export function norm(a: SVec): number {
  let s = 0;
  for (const v of a.values()) s += v * v;
  return Math.sqrt(s);
}
export function cosine(a: SVec, b: SVec): number {
  const d = norm(a) * norm(b);
  return d ? dot(a, b) / d : 0;
}
export function addTo(into: SVec, v: SVec, scale = 1) {
  for (const [k, x] of v) {
    const n = (into.get(k) ?? 0) + x * scale;
    if (Math.abs(n) < 1e-12) into.delete(k);
    else into.set(k, n);
  }
}
export function denseCosine(a: number[], b: number[]): number {
  let d = 0,
    na = 0,
    nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    d += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? d / Math.sqrt(na * nb) : 0;
}
