import { describe, expect, it } from "vitest";
import { niceTicks } from "./charts";

describe("niceTicks", () => {
  it("picks round steps", () => {
    expect(niceTicks(0.27, 4)).toEqual({ top: 0.3, ticks: [0, 0.1, 0.2, 0.3] });
    expect(niceTicks(135, 4)).toEqual({ top: 150, ticks: [0, 50, 100, 150] });
    expect(niceTicks(4, 4).ticks).toEqual([0, 1, 2, 3, 4]);
  });
});
