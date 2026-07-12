import PlanCard from "./PlanCard";
import { PLAN_LIST } from "../../config/pricing";

// Responsive grid of the four public plan cards. Stacks on mobile
// (recommended plan first, see PlanCard ordering), two-up on tablet, four-up
// on desktop.
export default function PricingCards() {
  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4">
      {PLAN_LIST.map((plan) => (
        <PlanCard key={plan.id} plan={plan} />
      ))}
    </div>
  );
}
