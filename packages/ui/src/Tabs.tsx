"use client";

import * as RadixTabs from "@radix-ui/react-tabs";
import type { ReactNode } from "react";

export interface TabItem {
  value: string;
  label: string;
  content: ReactNode;
}

export interface TabsProps {
  items: readonly TabItem[];
  defaultValue?: string;
  /** Names the tab group for screen readers. */
  label: string;
}

export function Tabs({ items, defaultValue, label }: TabsProps) {
  const first = items[0]?.value;
  return (
    <RadixTabs.Root className="mira-tabs" defaultValue={defaultValue ?? first}>
      <RadixTabs.List className="mira-tabs__list" aria-label={label}>
        {items.map((item) => (
          <RadixTabs.Trigger key={item.value} value={item.value} className="mira-tabs__tab">
            {item.label}
          </RadixTabs.Trigger>
        ))}
      </RadixTabs.List>
      {items.map((item) => (
        <RadixTabs.Content key={item.value} value={item.value} className="mira-tabs__panel">
          {item.content}
        </RadixTabs.Content>
      ))}
    </RadixTabs.Root>
  );
}
