import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { resendVerificationEmail } from "../services/auth.service";

export default function EmailVerificationBanner() {
  const { user } = useAuth();
  const [isSending, setIsSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!user || user.emailVerified) {
    return null;
  }

  async function handleResend() {
    setMessage(null);
    setIsSending(true);

    try {
      await resendVerificationEmail();
      setMessage("Verification email sent — check your inbox.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Failed to resend email"
      );
    } finally {
      setIsSending(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-orange-500/30 bg-orange-500/10 px-6 py-3 text-sm">
      <span className="text-orange-300">
        {message ?? "Please verify your email address to secure your account."}
      </span>

      <button
        onClick={handleResend}
        disabled={isSending}
        className="shrink-0 rounded-lg border border-orange-500/40 px-3 py-1.5 font-medium text-orange-300 transition hover:bg-orange-500/20 disabled:opacity-50"
      >
        {isSending ? "Sending..." : "Resend verification email"}
      </button>
    </div>
  );
}
