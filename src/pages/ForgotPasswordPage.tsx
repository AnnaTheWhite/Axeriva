import { useState } from "react";
import { Link } from "react-router-dom";
import Button from "../components/ui/Button";
import { forgotPassword } from "../services/auth.service";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const { message } = await forgotPassword(email);
      setMessage(message);
    } catch {
      // forgot-password always returns a generic success message, but
      // guard against network errors with the same generic copy so we
      // never reveal whether the email is registered.
      setMessage(
        "If an account with that email exists, a reset link has been sent."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0b0b0f]">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-5 rounded-2xl border border-white/10 bg-white/5 p-8"
      >
        <h1 className="text-xl font-semibold text-white">Forgot password</h1>

        {message ? (
          <p className="rounded-lg bg-green-500/10 px-3 py-2 text-sm text-green-400">
            {message}
          </p>
        ) : (
          <>
            <p className="text-sm text-white/50">
              Enter your email and we'll send you a link to reset your
              password.
            </p>

            <div className="space-y-2">
              <label className="block text-sm text-white/70">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-white outline-none focus:border-orange-500"
              />
            </div>

            <Button type="submit">
              {isSubmitting ? "Sending..." : "Send reset link"}
            </Button>
          </>
        )}

        <p className="text-center text-sm text-white/50">
          <Link to="/login" className="text-orange-500 hover:underline">
            Back to login
          </Link>
        </p>
      </form>
    </div>
  );
}
