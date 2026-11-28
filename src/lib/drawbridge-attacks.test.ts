import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type Attacks = {
  score: { passed: number; total: number };
  scenarios: { id: string; title: string; expected: string; actual: string; pass: boolean }[];
};

const data = JSON.parse(
  readFileSync(new URL("../data/drawbridge-attacks.json", import.meta.url), "utf8"),
) as Attacks;

describe("drawbridge attack results", () => {
  it("has one scenario per recorded total", () => {
    expect(data.scenarios.length).toBe(data.score.total);
  });

  it("records a pass on every scenario", () => {
    for (const scenario of data.scenarios) {
      expect(scenario.pass, scenario.id).toBe(true);
      expect(scenario.title.trim().length).toBeGreaterThan(0);
      expect(scenario.expected.trim().length).toBeGreaterThan(0);
    }
  });

  it("matches the passed count to passing rows", () => {
    expect(data.score.passed).toBe(data.scenarios.filter((scenario) => scenario.pass).length);
  });
});
