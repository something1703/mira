import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import {
  Banner,
  Button,
  Dialog,
  EmptyState,
  ErrorPanel,
  Field,
  FidelityLabel,
  LabelStrip,
  Plate,
  QuoteSheet,
  Reading,
  StepRail,
  Swatch,
  SwatchList,
  Tabs,
  Toggle,
  Verdict,
  latestAnnouncement,
} from "../src";

describe("Button", () => {
  it("busy blocks presses and says so", async () => {
    const onClick = vi.fn();
    render(
      <Button busy onClick={onClick}>
        Matching your shade
      </Button>,
    );
    const btn = screen.getByRole("button", { name: "Matching your shade" });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("aria-busy", "true");
    await userEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("defaults to type=button so it never submits a form by accident", () => {
    render(<Button>Start measuring</Button>);
    expect(screen.getByRole("button")).toHaveAttribute("type", "button");
  });
});

describe("Banner, ErrorPanel, EmptyState", () => {
  it("banner is a status with a dismiss control", async () => {
    const onDismiss = vi.fn();
    render(
      <Banner kind="recorded" onDismiss={onDismiss}>
        You are viewing a recorded run.
      </Banner>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("recorded run");
    await userEvent.click(screen.getByRole("button", { name: "Dismiss for this session" }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("error panel is an alert with what, why, next and trace", () => {
    render(
      <ErrorPanel
        title="The photo is too dark to measure."
        next="Face a window or a lamp and try again."
        traceId="trc_abc123"
        actions={<Button>Retake</Button>}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Face a window");
    expect(screen.getByText("Trace ID: trc_abc123")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retake" })).toBeInTheDocument();
  });

  it("empty state offers its one action", () => {
    render(
      <EmptyState
        title="No looks yet."
        description="Pick an outfit to build your first one."
        action={<Button>Pick an outfit</Button>}
      />,
    );
    expect(screen.getByRole("heading", { name: "No looks yet." })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pick an outfit" })).toBeInTheDocument();
  });
});

describe("Field and Toggle", () => {
  it("associates label, hint and error", () => {
    render(<Field label="Product link" hint="Paste a shade-finder page." error="Enter a link." />);
    const input = screen.getByLabelText("Product link");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Paste a shade-finder page. Enter a link.");
  });

  it("checkbox variant toggles by its label", async () => {
    render(<Field type="checkbox" label="I understand and want to continue" />);
    const box = screen.getByRole("checkbox", { name: "I understand and want to continue" });
    await userEvent.click(screen.getByText("I understand and want to continue"));
    expect(box).toBeChecked();
  });

  it("toggle is a switch operable by keyboard", async () => {
    render(<Toggle label="Allow smoothing" description="Opt-in renders are labelled." />);
    const sw = screen.getByRole("switch", { name: "Allow smoothing" });
    expect(sw).toHaveAccessibleDescription("Opt-in renders are labelled.");
    sw.focus();
    await userEvent.keyboard(" ");
    expect(sw).toBeChecked();
  });
});

describe("Dialog and Tabs", () => {
  function Harness() {
    const [open, setOpen] = useState(true);
    return (
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Delete your profile?"
        description="This deletes every stored number, saved look and proof."
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button variant="critical">Delete my profile</Button>
          </>
        }
      />
    );
  }

  it("is a labelled, described modal that closes on Escape", async () => {
    render(<Harness />);
    const dialog = screen.getByRole("dialog", { name: "Delete your profile?" });
    expect(dialog).toHaveAccessibleDescription(/every stored number/);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("tabs switch with the arrow keys", async () => {
    render(
      <Tabs
        label="Profile groups"
        items={[
          { value: "skin", label: "Skin", content: "Skin readings" },
          { value: "hair", label: "Hair", content: "Hair readings" },
        ]}
      />,
    );
    await userEvent.tab();
    expect(screen.getByRole("tab", { name: "Skin" })).toHaveFocus();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Hair", selected: true })).toBeInTheDocument();
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Hair readings");
  });
});

describe("Plate and labels", () => {
  it("every plate state is exposed with an accessible name", () => {
    const { rerender } = render(<Plate state="loading" alt="Loading preview" />);
    expect(screen.getByRole("group", { name: "Loading preview" })).toHaveAttribute(
      "aria-busy",
      "true",
    );
    rerender(<Plate state="ready" alt="Unretouched preview" src="/x.png" />);
    expect(screen.getByRole("img", { name: "Unretouched preview" })).toBeInTheDocument();
    rerender(<Plate state="drift" alt="Look preview" src="/x.png" />);
    expect(screen.getByRole("img", { name: "Look preview" })).toBeInTheDocument();
    rerender(<Plate state="withheld" alt="Withheld preview" />);
    expect(screen.getByRole("status")).toHaveTextContent("MIRA did not show it");
    rerender(<Plate state="expired" alt="Expired preview" />);
    expect(screen.getByRole("status")).toHaveTextContent("expired and was deleted");
  });

  it("label strip pairs the caption with an icon-and-word label", () => {
    render(
      <LabelStrip
        caption="Unretouched preview, smoothing off"
        variant="verified"
        detail="lip colour within ΔE 2.4 of the product"
        recorded
      />,
    );
    expect(screen.getByText("Verified")).toBeInTheDocument();
    expect(screen.getByText("Recorded run")).toBeInTheDocument();
    expect(screen.getByText(/within ΔE 2.4/)).toBeInTheDocument();
  });

  it.each([
    ["verified", "Verified"],
    ["drift", "Colour drifted"],
    ["not_checked", "Not checked"],
    ["recorded", "Recorded run"],
    ["visualisation", "Visualisation"],
  ] as const)("fidelity %s always has a word", (variant, word) => {
    render(<FidelityLabel variant={variant} />);
    expect(screen.getByText(word)).toBeInTheDocument();
  });
});

describe("Reading, Swatch, StepRail, QuoteSheet, Verdict", () => {
  it("reading: value, below floor and unavailable", () => {
    const { rerender } = render(
      <Reading
        caption="Blend"
        value="1.8"
        unit="ΔE2000 from your skin"
        confidence="blends closely"
      />,
    );
    expect(screen.getByText("1.8")).toHaveClass("mira-figures");
    rerender(
      <Reading
        state="below_floor"
        caption="Visible pores"
        value="62"
        unit="raw score"
        confidence="within your day-to-day variation"
        band={{ floorStart: 0.38, floorEnd: 0.56, mark: 0.45 }}
      />,
    );
    expect(screen.getByText("within your day-to-day variation")).toBeInTheDocument();
    rerender(
      <Reading
        state="unavailable"
        caption="Hair density"
        reason="The photo was too dark to measure."
        action={<Button variant="quiet">Retry hair</Button>}
      />,
    );
    expect(screen.getByText("Not measured")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry hair" })).toBeInTheDocument();
  });

  it("swatch states carry words, not just colour", () => {
    render(
      <SwatchList label="Rendered shades">
        <Swatch colour="rgb(199 154 120)" name="320" de="1.8" state="best" />
        <Swatch colour="rgb(194 143 107)" name="330" state="selected" />
        <Swatch colour="rgb(205 165 133)" name="310" state="out_of_range" />
      </SwatchList>,
    );
    expect(screen.getByRole("list", { name: "Rendered shades" })).toBeInTheDocument();
    expect(screen.getByText("Best match")).toBeInTheDocument();
    expect(screen.getByText("Out of range")).toBeInTheDocument();
    expect(screen.getByText("ΔE 1.8")).toBeInTheDocument();
  });

  it("step rail words every state and announces the latest settled step", () => {
    const steps = [
      { id: "1", label: "Lehenga tried on", state: "done" },
      { id: "2", label: "Garment colour checked", state: "cached" },
      { id: "3", label: "Makeup", state: "running" },
      { id: "4", label: "Hair", state: "queued" },
      { id: "5", label: "Venue", state: "failed", detail: "The venue image could not be made." },
      { id: "6", label: "Video", state: "skipped" },
    ] as const;
    render(<StepRail label="Building your look" steps={steps} />);
    for (const word of ["Done", "Saved result", "Running", "Queued", "Failed", "Skipped"]) {
      expect(screen.getByText(word)).toBeInTheDocument();
    }
    expect(latestAnnouncement(steps)).toBe("Video: Skipped");
    expect(latestAnnouncement([])).toBe("");
  });

  it("step rail: a step's own word replaces the state word, on screen and when announced", () => {
    const steps = [
      { id: "face", label: "Face photo", state: "done" },
      { id: "repeats", label: "Two repeat photos", state: "running", word: "Now" },
      { id: "hair", label: "Hair photos", state: "queued", word: "Optional" },
    ] as const;
    render(<StepRail label="Capture steps" steps={steps} />);
    expect(screen.getByText("Now")).toBeInTheDocument();
    expect(screen.getByText("Optional")).toBeInTheDocument();
    expect(screen.queryByText("Running")).toBeNull();
    expect(latestAnnouncement([{ ...steps[0], word: "Taken" }])).toBe("Face photo: Taken");
  });

  it("quote sheet: ready sums the lines and confirms", async () => {
    const onConfirm = vi.fn();
    render(
      <QuoteSheet
        state="ready"
        title="Build this look?"
        lines={[
          { label: "Clothes and accessories", units: 10 },
          { label: "Motion video", units: 24 },
        ]}
        confirmLabel="Build this look"
        onConfirm={onConfirm}
      />,
    );
    expect(screen.getByRole("row", { name: /Total/ })).toHaveTextContent("34");
    await userEvent.click(screen.getByRole("button", { name: "Build this look" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("quote sheet: over cap blocks confirm and says why; quoting and confirmed states", () => {
    const { rerender } = render(
      <QuoteSheet
        state="over_cap"
        title="Build this look?"
        lines={[{ label: "Motion video", units: 24 }]}
        unitsLeft={10}
        confirmLabel="Build this look"
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("24 units and you have 10 left");
    expect(screen.getByRole("button", { name: "Build this look" })).toBeDisabled();
    rerender(<QuoteSheet state="quoting" title="Build this look?" />);
    expect(screen.getByRole("status")).toHaveTextContent("Working out the units");
    rerender(
      <QuoteSheet state="confirmed" title="Build this look?" lines={[{ label: "A", units: 1 }]} />,
    );
    expect(screen.getByText(/Confirmed/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  it("verdict renders one sentence and its evidence", () => {
    render(
      <Verdict
        state="not_yet"
        sentence="No change we can tell apart from your day-to-day variation yet."
      >
        <p>Day 12 of 28</p>
      </Verdict>,
    );
    expect(screen.getByRole("region", { name: "Verdict" })).toHaveTextContent("Day 12 of 28");
  });
});
