import { useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import Button from "../components/ui/Button";
import PasswordInput from "../components/ui/PasswordInput";
import { resetPassword } from "../services/auth.service";
import { useTranslation } from "../i18n";

type Status = "form" | "success" | "error";

export default function ResetPasswordPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState<Status>("form");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError(t("auth.resetPassword.mismatch"));
      return;
    }

    if (!token) return;

    setIsSubmitting(true);

    try {
      await resetPassword(token, password);
      setStatus("success");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : t("auth.resetPassword.failed"));
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
              {t("auth.resetPassword.title")}
            </h1>

            {error && (
              <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">
                {error}
              </p>
            )}

            <div className="space-y-2">
              <label className="block text-sm text-white/70">
                {t("auth.resetPassword.newPassword")}
              </label>
              <PasswordInput
                required
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                showStrength
              />
            </div>

            <div className="space-y-2">
              <label className="block text-sm text-white/70">
                {t("auth.resetPassword.confirmPassword")}
              </label>
              <PasswordInput
                required
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>

            <Button type="submit">
              {isSubmitting ? t("auth.resetPassword.submitting") : t("auth.resetPassword.submit")}
            </Button>
          </form>
        )}

        {status === "success" && (
          <div className="space-y-4 text-center">
            <h1 className="text-xl font-semibold text-white">
              {t("auth.resetPassword.successTitle")}
            </h1>
            <p className="text-slate-400">
              {t("auth.resetPassword.successDescription")}
            </p>
            <button
              onClick={() => navigate("/login")}
              className="inline-block rounded-xl bg-orange-500 px-5 py-2 font-medium text-white hover:bg-orange-600"
            >
              {t("auth.resetPassword.goToLogin")}
            </button>
          </div>
        )}

        {status === "error" && (
          <div className="space-y-4 text-center">
            <h1 className="text-xl font-semibold text-white">
              {t("auth.resetPassword.errorTitle")}
            </h1>
            <p className="text-slate-400">{error}</p>
            <Link to="/forgot-password" className="text-orange-500 hover:underline">
              {t("auth.resetPassword.requestNewLink")}
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
