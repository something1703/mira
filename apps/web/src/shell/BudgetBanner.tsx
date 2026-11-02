import { CONFIG } from "@mira/schemas";
import { Banner } from "@mira/ui";
import { currentBudget } from "../budget";

/**
 * "Session budget low" (docs/UX_FLOWS.md §0): shown under 20% of the session's cap. At the cap
 * the next QuoteSheet shows its over-cap state instead.
 */
export async function BudgetBanner() {
  const budget = await currentBudget();
  if (!budget || budget.cap === 0) return null;
  if (budget.left >= CONFIG.budget.lowShare.value * budget.cap) return null;
  return <Banner kind="budget">Units left in this session: {budget.left}.</Banner>;
}
