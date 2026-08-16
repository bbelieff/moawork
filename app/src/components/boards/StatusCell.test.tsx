import { describe, expect, it, vi } from "vitest";
import { StatusSelect } from "./StatusCell";

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
});
