import { useEffect, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { getInviteByToken, acceptInvite } from "../services/invites.service";
import { useAuth } from "../context/AuthContext";
import Button from "../components/ui/Button";
import PasswordInput from "../components/ui/PasswordInput";
import PasswordRequirements from "../components/ui/PasswordRequirements";
import { meetsPasswordPolicy, PASSWORD_MIN_LENGTH } from "../utils/passwordPolicy";
import { useTranslation } from "../i18n";

export default function AcceptInvitePage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { setSession } = useAuth();
  const { t } = useTranslation();

  const [invite, setInvite] = useState<{
    email: string;
    companyName: string;
  } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!token) return;

    getInviteByToken(token)
      .then(setInvite)
      .catch(() => setLoadError(t("auth.acceptInvite.invalidLink")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;

    setError(null);

    // Client-side mirror of the server's password policy (B3) — instant,
    // localized feedback only; the server stays the authority. Must run
    // BEFORE setIsSubmitting(true): this early return skips the finally
    // block, so flipping the flag first would strand the button on
    // "Activating...".
    if (!meetsPasswordPolicy(password)) {
      setError(t("common.passwordPolicyError", { min: PASSWORD_MIN_LENGTH }));
      return;
    }

    setIsSubmitting(true);

    try {
      const data = await acceptInvite(token, { firstName, lastName, password });
      setSession(data.token, data.user);
      navigate("/");
    } catch (err) {
      // The service surfaces the server's { error } text (e.g. the exact
      // password-policy message) — the i18n key is only the fallback.
      setError(err instanceof Error ? err.message : t("auth.acceptInvite.failed"));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (loadError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0f172a]">
        <div className="max-w-sm rounded-2xl border border-white/10 bg-white/5 p-8 text-center text-white">
          <p>{loadError}</p>
          <Link to="/login" className="mt-4 inline-block text-orange-500 hover:underline">
            {t("auth.acceptInvite.goToLogin")}
          </Link>
        </div>
      </div>
    );
  }

  if (!invite) {
    return null;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0f172a]">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-5 rounded-2xl border border-white/10 bg-white/5 p-8"
      >
        <h1 className="text-xl font-semibold text-white">
          {t("auth.acceptInvite.join", { companyName: invite.companyName })}
        </h1>
        <p className="text-sm text-slate-400">
          {t("auth.acceptInvite.activatingFor")}{" "}
          <span className="text-white">{invite.email}</span>
        </p>

        {error && (
          <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {error}
          </p>
        )}

        <div className="space-y-2">
          <label className="block text-sm text-white/70">{t("auth.acceptInvite.firstName")}</label>
          <input
            type="text"
            required
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-white outline-none focus:border-orange-500"
          />
        </div>

        <div className="space-y-2">
          <label className="block text-sm text-white/70">{t("auth.acceptInvite.lastName")}</label>
          <input
            type="text"
            required
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-white outline-none focus:border-orange-500"
          />
        </div>

        <div className="space-y-2">
          <label className="block text-sm text-white/70">{t("auth.acceptInvite.password")}</label>
          <PasswordInput
            required
            minLength={PASSWORD_MIN_LENGTH}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            showStrength
          />
          <PasswordRequirements />
        </div>

        <Button type="submit">
          {isSubmitting ? t("auth.acceptInvite.submitting") : t("auth.acceptInvite.submit")}
        </Button>
      </form>
    </div>
  );
}
