"use client";

import { Button, Dialog, Tabs, Toggle } from "@mira/ui";
import { useState } from "react";

/** The gallery's stateful parts: toggle, dialog and tabs. */
export function GalleryInteractive() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <h3>Toggle</h3>
      <Toggle
        label="Allow skin smoothing"
        description="Off by default. Previews that use it are labelled."
      />
      <h3>Dialog</h3>
      <Button
        variant="secondary"
        onClick={() => {
          setOpen(true);
        }}
      >
        Open the confirm dialog
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Delete your profile?"
        description="This deletes every stored number, saved look and progress check. It cannot be undone."
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
            <Button
              variant="critical"
              onClick={() => {
                setOpen(false);
              }}
            >
              Delete my profile
            </Button>
          </>
        }
      />
      <h3>Tabs</h3>
      <Tabs
        label="Profile groups"
        items={[
          { value: "skin", label: "Skin", content: "Skin readings appear here." },
          { value: "colouring", label: "Colouring", content: "Colouring readings appear here." },
          { value: "face", label: "Face", content: "Face readings appear here." },
          { value: "hair", label: "Hair", content: "Hair readings appear here." },
        ]}
      />
    </>
  );
}
