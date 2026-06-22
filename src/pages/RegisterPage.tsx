import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { register } from "../services/auth.service";
import { useAuth } from "../context/AuthContext";
import Button from "../components/ui/Button";
import PasswordInput from "../components/ui/PasswordInput";
import { useTranslation } from "../i18n";

export default function RegisterPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const { t } = useTranslation();

  const [companyName, setCompanyName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      await register(companyName, email, password);
      await login(email, password);
      navigate("/");
    } catch {
      setError(t("auth.register.failed"));
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
          {t("auth.register.title")}
        </h1>

        {error && (
          <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {error}
          </p>
        )}

        <div className="space-y-2">
          <label className="block text-sm text-white/70">{t("auth.register.companyName")}</label>
          <input
            type="text"
            required
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-white outline-none focus:border-orange-500"
          />
        </div>

        <div className="space-y-2">
          <label className="block text-sm text-white/70">{t("auth.register.email")}</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-white outline-none focus:border-orange-500"
          />
        </div>

        <div className="space-y-2">
          <label className="block text-sm text-white/70">{t("auth.register.password")}</label>
          <PasswordInput
            required
            minLength={6}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            showStrength
          />
        </div>

        <Button type="submit">
          {isSubmitting ? t("auth.register.submitting") : t("auth.register.submit")}
        </Button>

        <p className="text-center text-sm text-white/50">
          {t("auth.register.haveAccount")}{" "}
          <Link to="/login" className="text-orange-500 hover:underline">
            {t("auth.register.logIn")}
          </Link>
        </p>
      </form>
    </div>
  );
}
