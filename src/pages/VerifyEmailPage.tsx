import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { verifyEmail } from "../services/auth.service";
import { useAuth } from "../context/AuthContext";

type Status = "verifying" | "success" | "error";

export default function VerifyEmailPage() {
  const { token } = useParams<{ token: string }>();
  const { user, token: authToken, setSession } = useAuth();
  const [status, setStatus] = useState<Status>("verifying");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;

    verifyEmail(token)
      .then(() => {
        setStatus("success");

        // If they're already logged in on this browser, update the local
        // copy so the "verify your email" banner disappears immediately
        // instead of waiting for their next login.
        if (user && authToken) {
          setSession(authToken, { ...user, emailVerified: true });
        }
      })
      .catch((err) => {
        setStatus("error");
        setError(err instanceof Error ? err.message : "Verification failed");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0f172a]">
      <div className="w-full max-w-sm space-y-4 rounded-2xl border border-white/10 bg-white/5 p-8 text-center">
        {status === "verifying" && (
          <p className="text-slate-300">Verifying your email...</p>
        )}

        {status === "success" && (
          <>
            <h1 className="text-xl font-semibold text-white">Email verified</h1>
            <p className="text-slate-400">
              Your email address has been confirmed.
            </p>
            <Link
              to="/"
              className="inline-block rounded-xl bg-orange-500 px-5 py-2 font-medium text-white hover:bg-orange-600"
            >
              Continue to Axeriva
            </Link>
          </>
        )}

        {status === "error" && (
          <>
            <h1 className="text-xl font-semibold text-white">
              Verification failed
            </h1>
            <p className="text-slate-400">{error}</p>
            <Link to="/login" className="text-orange-500 hover:underline">
              Go to login
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
