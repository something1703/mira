import { render, screen } from "@testing-library/react";
import { Ring, ringState } from "../src";

describe("Ring semantics", () => {
  const none = { lighting: false, distance: false, angle: false, steadiness: false };

  it("a capture Ring that holds the live camera is a group, so what is inside stays reachable", () => {
    render(
      <Ring mode="capture" label="Face photo" checks={none}>
        <button type="button">Camera control</button>
      </Ring>,
    );
    expect(screen.getByRole("group", { name: "Face photo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Camera control" })).toBeInTheDocument();
  });

  it("a progress Ring is a progressbar with its percentage", () => {
    render(<Ring mode="reading" progress value={0.4} label="Uploading" />);
    const bar = screen.getByRole("progressbar", { name: "Uploading" });
    expect(bar).toHaveAttribute("aria-valuenow", "40");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
  });

  it("a run Ring can leave announcing to the StepRail beside it", () => {
    const steps = [{ id: "a", label: "Measuring", state: "done" as const }];
    const { rerender } = render(<Ring mode="run" label="Run" steps={steps} />);
    expect(screen.getByText("Measuring: Done")).toBeInTheDocument();
    rerender(<Ring mode="run" label="Run" steps={steps} announce={false} />);
    expect(screen.queryByText("Measuring: Done")).toBeNull();
  });
});

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

describe("Ring states (DESIGN_SYSTEM §6)", () => {
  const none = { lighting: false, distance: false, angle: false, steadiness: false };
  const all = { lighting: true, distance: true, angle: true, steadiness: true };

  it.each([
    ["idle", { mode: "capture", checks: none }],
    [
      "checking",
      { mode: "capture", checks: { ...none, lighting: true }, instruction: "Move a little closer" },
    ],
    ["ready", { mode: "capture", checks: all }],
    ["capturing", { mode: "capture", checks: all, capturing: true, countdown: 2 }],
    ["blocked", { mode: "capture", checks: all, blockedReason: "Camera access is off." }],
    ["measuring", { mode: "run", steps: [{ id: "a", label: "A", state: "running" }] }],
    ["done", { mode: "reading", value: 0.5 }],
  ] as const)("%s", (state, props) => {
    const { container } = render(
      <Ring {...(props as Parameters<typeof Ring>[0])} label={`Ring ${state}`} />,
    );
    expect(ringState(props as Parameters<typeof ringState>[0])).toBe(state);
    expect(container.querySelector("figure")).toHaveAttribute("data-state", state);
  });

  it("capturing lights every tick and counts down, then says hold still", () => {
    const { container, rerender } = render(
      <Ring mode="capture" label="Capturing" checks={none} capturing countdown={2} />,
    );
    expect(container.querySelectorAll(".mira-ring__tick.is-done")).toHaveLength(4);
    expect(screen.getByText("Hold still. Taking the photo in 2")).toBeInTheDocument();
    rerender(<Ring mode="capture" label="Capturing" checks={none} capturing countdown={0} />);
    expect(screen.getByText("Hold still")).toBeInTheDocument();
  });

  it("idle shows no caption and no reading tick", () => {
    const { container } = render(<Ring mode="capture" label="At rest" checks={none} />);
    expect(container.querySelector("figcaption")).toBeNull();
    expect(container.querySelector(".mira-ring__reading")).toBeNull();
  });
});
