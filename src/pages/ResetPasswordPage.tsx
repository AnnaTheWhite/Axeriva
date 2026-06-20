import { useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import Button from "../components/ui/Button";
import { resetPassword } from "../services/auth.service";

type Status = "form" | "success" | "error";

export default function ResetPasswordPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState<Status>("form");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords don't match");
      return;
    }

    if (!token) return;

    setIsSubmitting(true);

    try {
      await resetPassword(token, password);
      setStatus("success");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Reset failed");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0b0b0f]">
      <div className="w-full max-w-sm space-y-5 rounded-2xl border border-white/10 bg-white/5 p-8">
        {status === "form" && (
          <form onSubmit={handleSubmit} className="space-y-5">
            <h1 className="text-xl font-semibold text-white">
              Reset password
            </h1>

            {error && (
              <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">
                {error}
              </p>
            )}

            <div className="space-y-2">
              <label className="block text-sm text-white/70">
                New password
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-white outline-none focus:border-orange-500"
              />
            </div>

            <div className="space-y-2">
              <label className="block text-sm text-white/70">
                Confirm new password
              </label>
              <input
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-white outline-none focus:border-orange-500"
              />
            </div>

            <Button type="submit">
              {isSubmitting ? "Resetting..." : "Reset password"}
            </Button>
          </form>
        )}

        {status === "success" && (
          <div className="space-y-4 text-center">
            <h1 className="text-xl font-semibold text-white">
              Password reset
            </h1>
            <p className="text-slate-400">
              Your password has been changed. You can now log in.
            </p>
            <button
              onClick={() => navigate("/login")}
              className="inline-block rounded-xl bg-orange-500 px-5 py-2 font-medium text-white hover:bg-orange-600"
            >
              Go to login
            </button>
          </div>
        )}

        {status === "error" && (
          <div className="space-y-4 text-center">
            <h1 className="text-xl font-semibold text-white">
              Reset failed
            </h1>
            <p className="text-slate-400">{error}</p>
            <Link to="/forgot-password" className="text-orange-500 hover:underline">
              Request a new link
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
