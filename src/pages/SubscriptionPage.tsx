import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import PageHeader from "../components/PageHeader";
import Button from "../components/ui/Button";
import {
  getSubscriptionStatus,
  startCheckout,
  startPortal,
  type SubscriptionStatus,
} from "../services/subscription.service";

const ACTIVE_STATUSES = ["active", "trialing"];

export default function SubscriptionPage() {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<SubscriptionStatus | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);

  const checkoutResult = searchParams.get("checkout");

  useEffect(() => {
    getSubscriptionStatus()
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  useEffect(() => {
    if (checkoutResult === "success") {
      setMessage("Subscription activated. It may take a few seconds to show below.");
    } else if (checkoutResult === "cancelled") {
      setMessage("Checkout was cancelled — you have not been charged.");
    }
  }, [checkoutResult]);

  const isActive = status ? ACTIVE_STATUSES.includes(status.subscriptionStatus) : false;

  async function handleSubscribe() {
    setMessage(null);
    setIsStarting(true);

    try {
      const url = await startCheckout();
      window.location.href = url;
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Failed to start checkout"
      );
      setIsStarting(false);
    }
  }

  async function handleManage() {
    setMessage(null);
    setIsStarting(true);

    try {
      const url = await startPortal();
      window.location.href = url;
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Failed to open billing portal"
      );
      setIsStarting(false);
    }
  }

  return (
    <div className="p-8">
      <PageHeader
        title="Subscription"
        subtitle="Manage your CrewFlow billing plan."
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur-xl">
          <p className="text-sm text-slate-400">Current plan</p>
          <h3 className="mt-2 text-2xl font-bold capitalize text-white">
            {status?.plan ?? "—"}
          </h3>

          <p className="mt-4 text-sm text-slate-400">Status</p>
          <p className="mt-1 capitalize text-white">
            {status?.subscriptionStatus ?? "—"}
          </p>

          <p className="mt-4 text-sm text-slate-400">Next billing date</p>
          <p className="mt-1 text-white">
            {status?.subscriptionEndsAt
              ? new Date(status.subscriptionEndsAt).toLocaleDateString()
              : "—"}
          </p>
        </div>

        <div className="rounded-3xl border border-orange-500/30 bg-white/5 p-8 backdrop-blur-xl">
          <h3 className="text-xl font-semibold text-white">CrewFlow Pro</h3>
          <p className="mt-2 text-3xl font-bold text-white">
            €30 <span className="text-base font-normal text-slate-400">/ month</span>
          </p>
          <p className="mt-3 text-sm text-slate-400">
            Unlimited employees, projects, customers, scheduling, time
            tracking and future AI features.
          </p>

          {message && (
            <p className="mt-4 rounded-lg bg-orange-500/10 px-3 py-2 text-sm text-orange-400">
              {message}
            </p>
          )}

          <div className="mt-6">
            {isActive ? (
              <Button onClick={handleManage}>
                {isStarting ? "Opening billing portal..." : "Manage Subscription"}
              </Button>
            ) : (
              <Button onClick={handleSubscribe}>
                {isStarting ? "Starting checkout..." : "Subscribe"}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
