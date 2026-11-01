import { EventPlan, WEDDING_FUNCTIONS, type EventFunction } from "@mira/schemas";

/**
 * Event Mode keeps its plan in the person's own browser (localStorage): the event's name, its
 * functions and which saved look belongs to each. It holds no image and no measurement, so there
 * is nothing on a server to delete; clearing site data clears the plan. The saved looks themselves
 * live in the person's saved storage, deleted with "Delete my profile".
 */
export const EVENT_KEY = "mira-event";

export const newFunctionId = (): string =>
  `fn_${Math.random().toString(36).slice(2, 10).padEnd(4, "0")}`;

export function defaultEvent(): EventPlan {
  return {
    name: "My wedding",
    functions: WEDDING_FUNCTIONS.map((f) => ({ ...f, id: newFunctionId() })),
  };
}

export function loadEvent(): EventPlan | undefined {
  try {
    const raw = localStorage.getItem(EVENT_KEY);
    if (raw === null) return undefined;
    const parsed = EventPlan.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export function saveEvent(plan: EventPlan): boolean {
  try {
    localStorage.setItem(EVENT_KEY, JSON.stringify(plan));
    return true;
  } catch {
    return false;
  }
}

export function clearEvent(): void {
  try {
    localStorage.removeItem(EVENT_KEY);
  } catch {
    // Storage blocked: there was nothing kept to clear.
  }
}

/** Records the saved look for a function; returns the plan as stored, or undefined if it is gone. */
export function attachLook(functionId: string, lookId: string): EventPlan | undefined {
  const plan = loadEvent();
  if (!plan?.functions.some((f) => f.id === functionId)) return undefined;
  const next: EventPlan = {
    ...plan,
    functions: plan.functions.map((f) => (f.id === functionId ? { ...f, lookId } : f)),
  };
  return saveEvent(next) ? next : undefined;
}

export const findFunction = (plan: EventPlan | undefined, id: string | undefined) =>
  id === undefined ? undefined : plan?.functions.find((f): f is EventFunction => f.id === id);
