import { render, screen } from "@testing-library/react";
import { Ring } from "../src";

describe("Ring", () => {
  it("capture mode: ticks reflect the four checks and the caption names the failing one", () => {
    const { container } = render(
      <Ring
        mode="capture"
        label="Capture checks: 2 of 4 passed"
        checks={{ lighting: true, distance: false, angle: true, steadiness: false }}
        instruction="Move a little closer"
      />,
    );
    expect(screen.getByRole("img", { name: /2 of 4/ })).toBeInTheDocument();
    expect(screen.getByText("Move a little closer")).toBeInTheDocument();
    expect(container.querySelectorAll(".mira-ring__tick.is-done")).toHaveLength(2);
    expect(container.querySelector(".mira-ring__reading")).toBeNull();
  });

  it("capture mode: all checks passing completes the ring with the reading tick", () => {
    const { container } = render(
      <Ring
        mode="capture"
        label="All four capture checks passed"
        checks={{ lighting: true, distance: true, angle: true, steadiness: true }}
      />,
    );
    expect(screen.getByText("Ready to capture")).toBeInTheDocument();
    expect(container.querySelectorAll(".mira-ring__tick.is-done")).toHaveLength(4);
    expect(container.querySelector(".mira-ring__reading")).not.toBeNull();
  });

  it("capture mode: a blocked reason replaces the instruction", () => {
    render(
      <Ring
        mode="capture"
        label="Capture blocked"
        checks={{ lighting: false, distance: false, angle: false, steadiness: false }}
        instruction="Move a little closer"
        blockedReason="Camera access is off. Turn it on in your browser settings, or upload a photo."
      />,
    );
    expect(screen.getByText(/Camera access is off/)).toBeInTheDocument();
    expect(screen.queryByText("Move a little closer")).toBeNull();
  });

  it("run mode: a progressbar with one tick per node and a polite announcement", () => {
    const { container } = render(
      <Ring
        mode="run"
        label="Building your look"
        steps={[
          { id: "a", label: "Lehenga tried on", state: "done" },
          { id: "b", label: "Garment colour checked", state: "cached" },
          { id: "c", label: "Makeup", state: "running" },
          { id: "d", label: "Hair colour", state: "queued" },
        ]}
      />,
    );
    const bar = screen.getByRole("progressbar", { name: "Building your look" });
    expect(bar).toHaveAttribute("aria-valuemax", "4");
    expect(bar).toHaveAttribute("aria-valuenow", "2");
    expect(bar).toHaveAttribute("aria-valuetext", "2 of 4 steps settled");
    expect(container.querySelectorAll(".mira-ring__tick")).toHaveLength(4);
    expect(container.querySelectorAll(".is-running")).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent("Garment colour checked: Saved result");
  });

  it("reading mode: the tick sweeps to the reading's position", () => {
    const { container, rerender } = render(<Ring mode="reading" label="Reading" value={0} />);
    const at = (v: number) => {
      rerender(<Ring mode="reading" label="Reading" value={v} />);
      const g = container.querySelector<SVGGElement>(".mira-ring__reading");
      expect(g).toHaveClass("is-sweeping");
      return g?.style.getPropertyValue("--r");
    };
    // The tick is drawn at +20°; the scale runs +60° (0) to −60° (1).
    expect(at(0)).toBe("-40deg");
    expect(at(1 / 3)).toBe("0deg");
    expect(at(1)).toBe("80deg");
  });
});
