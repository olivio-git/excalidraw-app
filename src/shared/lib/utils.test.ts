import { cn } from "./utils";

describe("cn()", () => {
  it("returns empty string when called with no arguments", () => {
    expect(cn()).toBe("");
  });

  it("returns a single class unchanged", () => {
    expect(cn("font-bold")).toBe("font-bold");
  });

  it("merges multiple string classes into a single string", () => {
    expect(cn("flex", "items-center", "gap-4")).toBe("flex items-center gap-4");
  });

  it("handles falsy values: undefined, null, false are ignored", () => {
    expect(cn("flex", undefined, null, false, "gap-2")).toBe("flex gap-2");
  });

  it("resolves conflicting Tailwind padding classes — last one wins", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
  });

  it("includes class when object syntax value is true", () => {
    expect(cn({ "font-semibold": true })).toBe("font-semibold");
  });

  it("excludes class when object syntax value is false", () => {
    expect(cn({ "font-semibold": false })).toBe("");
  });

  it("handles array syntax", () => {
    expect(cn(["flex", "flex-col"])).toBe("flex flex-col");
  });

  it("handles mixed input: strings, objects, and arrays together", () => {
    expect(cn("block", { hidden: false, "text-sm": true }, ["mt-2", "px-4"])).toBe(
      "block text-sm mt-2 px-4"
    );
  });

  it("resolves conflicting text color classes — last one wins", () => {
    expect(cn("text-red-500", "text-blue-700")).toBe("text-blue-700");
  });

  it("resolves conflicting bg color classes — last one wins", () => {
    expect(cn("bg-white", "bg-gray-900")).toBe("bg-gray-900");
  });

  it("handles a complex real-world case: conditional classes combined with Tailwind conflicts", () => {
    const isActive = true;
    const isDisabled = false;

    expect(
      cn(
        "rounded px-4 py-2",
        "text-sm text-base", // tw conflict: text-base wins
        { "bg-blue-500": isActive, "bg-gray-300": isDisabled },
        isDisabled && "cursor-not-allowed",
        ["font-medium", "font-bold"] // tw conflict: font-bold wins
      )
    ).toBe("rounded px-4 py-2 text-base bg-blue-500 font-bold");
  });
});
