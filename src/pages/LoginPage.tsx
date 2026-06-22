import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import Button from "../components/ui/Button";
import { useTranslation } from "../i18n";

export default function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const { t } = useTranslation();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      await login(email, password);
      navigate("/");
    } catch {
      setError(t("auth.login.invalidCredentials"));
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
        <h1 className="text-xl font-semibold text-white">
          {t("auth.login.title")}
        </h1>

        {error && (
          <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {error}
          </p>
        )}

        <div className="space-y-2">
          <label className="block text-sm text-white/70">{t("auth.login.email")}</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-white outline-none focus:border-orange-500"
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="block text-sm text-white/70">{t("auth.login.password")}</label>
            <Link
              to="/forgot-password"
              className="text-sm text-orange-500 hover:underline"
            >
              {t("auth.login.forgotPassword")}
            </Link>
          </div>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-white outline-none focus:border-orange-500"
          />
        </div>

        <Button type="submit">
          {isSubmitting ? t("auth.login.submitting") : t("auth.login.submit")}
        </Button>

        <p className="text-center text-sm text-white/50">
          {t("auth.login.noAccount")}{" "}
          <Link to="/register" className="text-orange-500 hover:underline">
            {t("auth.login.signUp")}
          </Link>
        </p>
      </form>
    </div>
  );
}
