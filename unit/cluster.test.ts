import { describe, expect, it } from "vitest";
import { clusterDocs, nameFor, surfaceForms } from "../src/core/cluster";
import { runToEnd } from "../src/core/nearDup";

const smoke = (i: number) => ({
  id: i,
  text: `wildfire smoke exposure respiratory health study ${i} children hospital`,
});
const timber = (i: number) => ({
  id: 100 + i,
  text: `timber harvest trade flows forest products nations ${i} export`,
});

describe("clusters", () => {
  it("groups papers by topic and drops small clusters", () => {
    const docs = [
      ...[1, 2, 3, 4, 5].map(smoke),
      ...[1, 2, 3, 4, 5, 6].map(timber),
      { id: 999, text: "quantum entanglement photon detectors" },
    ];
    const out = runToEnd(clusterDocs(docs));
    expect(out).toHaveLength(2);
    expect(out[0].ids.every((i) => i >= 100)).toBe(true);
    expect(out[1].ids.sort()).toEqual([1, 2, 3, 4, 5]);
    expect(out.flatMap((c) => c.ids)).not.toContain(999);
  });
  it("names a cluster with plain words, not stems", () => {
    const docs = [1, 2, 3, 4].map(smoke);
    const [c] = runToEnd(clusterDocs(docs));
    expect(c.name).toMatch(/^[A-Z]/);
    expect(c.name.toLowerCase()).toMatch(
      /wildfire|smoke|respiratory|exposure|health/,
    );
    expect(c.name.toLowerCase()).not.toMatch(/wildfir\b/);
  });
  it("surface forms prefer the commonest spelling", () => {
    const f = surfaceForms(["forests forests forest", "forests"]);
    expect(f.get("forest")).toBe("forests");
    expect(nameFor(new Map([["forest", 2]]), f)).toBe("Forests");
  });
});
