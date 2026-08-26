import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { StatusCell, StatusSelect } from "./StatusCell";

describe("StatusSelect persistence contract", () => {
  it("submits the owning server-action form when an option changes", () => {
    const requestSubmit = vi.fn();
    const element = StatusSelect({
      name: "value",
      value: null,
      options: [{ id: "opt-doing", label: "진행중", order: 0 }],
    });

    element.props.onChange({ currentTarget: { form: { requestSubmit } } });

    expect(requestSubmit).toHaveBeenCalledOnce();
  });

  it("uses theme tokens instead of a light-only hardcoded empty chip", () => {
    const html = renderToStaticMarkup(<StatusCell value={null} options={[]} />);
    expect(html).toContain("bg-mw-bg");
    expect(html).toContain("text-mw-sub");
    expect(html).not.toContain("background-color:#c4c4c4");
  });

  it("does not paint an unknown select value as a populated gray status", () => {
    const element = StatusSelect({
      name: "value",
      value: "legacy-value",
      options: [{ id: "known", label: "알려진 값", order: 0 }],
    });
    expect(element.props.style).toBeUndefined();
  });
});
