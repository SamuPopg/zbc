import { describe, it, expect } from "vitest";
import {
  compareValues,
  type DiffStatus,
} from "../src/reportDiff.js";

describe("compareValues", () => {
  it("string: trim and compare", () => {
    expect(compareValues("  hello  ", "hello")).toBe<DiffStatus>("unchanged");
    expect(compareValues("hello", "hello ")).toBe<DiffStatus>("unchanged");
    expect(compareValues("hello", "world")).toBe<DiffStatus>("changed");
  });

  it("object: key order does not matter", () => {
    expect(compareValues({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe<DiffStatus>("unchanged");
    expect(compareValues({ a: 1, b: 2 }, { a: 1, b: 3 })).toBe<DiffStatus>("changed");
  });

  it("array: order matters", () => {
    expect(compareValues([1, 2, 3], [1, 2, 3])).toBe<DiffStatus>("unchanged");
    expect(compareValues([1, 2, 3], [3, 2, 1])).toBe<DiffStatus>("changed");
    expect(compareValues([1, 2], [1, 2, 3])).toBe<DiffStatus>("changed");
  });

  it("undefined / null / missing all treated as missing", () => {
    expect(compareValues(undefined, undefined)).toBe<DiffStatus>("both_missing");
    expect(compareValues(null, null)).toBe<DiffStatus>("both_missing");
    expect(compareValues(undefined, null)).toBe<DiffStatus>("both_missing");
  });

  it("old missing / new value = added", () => {
    expect(compareValues(undefined, "new")).toBe<DiffStatus>("added");
    expect(compareValues(null, "new")).toBe<DiffStatus>("added");
  });

  it("old value / new missing = removed", () => {
    expect(compareValues("old", undefined)).toBe<DiffStatus>("removed");
    expect(compareValues("old", null)).toBe<DiffStatus>("removed");
  });

  it("one side missing, other has value = added/removed", () => {
    expect(compareValues(undefined, "value")).toBe<DiffStatus>("added");
    expect(compareValues(null, "value")).toBe<DiffStatus>("added");
  });

  it("both missing = both_missing", () => {
    expect(compareValues(undefined, undefined)).toBe<DiffStatus>("both_missing");
  });

  it("primitives: same = unchanged", () => {
    expect(compareValues(42, 42)).toBe<DiffStatus>("unchanged");
    expect(compareValues(true, true)).toBe<DiffStatus>("unchanged");
    expect(compareValues(false, false)).toBe<DiffStatus>("unchanged");
  });

  it("primitives: different = changed", () => {
    expect(compareValues(42, 43)).toBe<DiffStatus>("changed");
    expect(compareValues(true, false)).toBe<DiffStatus>("changed");
  });

  it("nested objects deep compare", () => {
    expect(
      compareValues({ deep: { a: [1, 2] } }, { deep: { a: [1, 2] } })
    ).toBe<DiffStatus>("unchanged");
    expect(
      compareValues({ deep: { a: [1, 2] } }, { deep: { a: [1, 3] } })
    ).toBe<DiffStatus>("changed");
  });
});