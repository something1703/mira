import type { ReactNode } from "react";

export interface EmptyStateProps {
  title: string;
  description?: string;
  /** One primary action. An empty screen invites exactly one thing. */
  action: ReactNode;
  headingLevel?: 2 | 3;
}

export function EmptyState({ title, description, action, headingLevel = 2 }: EmptyStateProps) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <section className="mira-empty">
      <Heading className="mira-title">{title}</Heading>
      {description ? <p className="mira-empty__text">{description}</p> : null}
      <div className="mira-empty__action">{action}</div>
    </section>
  );
}
