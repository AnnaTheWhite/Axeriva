import { useEffect, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { getInviteByToken, acceptInvite } from "../services/invites.service";
import { useAuth } from "../context/AuthContext";
import Button from "../components/ui/Button";

export default function AcceptInvitePage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { setSession } = useAuth();

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
      .catch(() => setLoadError("This invitation link is invalid or has expired."));
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;

    setError(null);
    setIsSubmitting(true);

    try {
      const data = await acceptInvite(token, { firstName, lastName, password });
      setSession(data.token, data.user);
      navigate("/");
    } catch {
      setError("Failed to activate your account.");
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
            Go to login
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
          Join {invite.companyName}
        </h1>
        <p className="text-sm text-slate-400">
          Activating account for <span className="text-white">{invite.email}</span>
        </p>

        {error && (
          <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {error}
          </p>
        )}

        <div className="space-y-2">
          <label className="block text-sm text-white/70">First name</label>
          <input
            type="text"
            required
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-white outline-none focus:border-orange-500"
          />
        </div>

        <div className="space-y-2">
          <label className="block text-sm text-white/70">Last name</label>
          <input
            type="text"
            required
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-white outline-none focus:border-orange-500"
          />
        </div>

        <div className="space-y-2">
          <label className="block text-sm text-white/70">Password</label>
          <input
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-white outline-none focus:border-orange-500"
          />
        </div>

        <Button type="submit">
          {isSubmitting ? "Activating..." : "Activate account"}
        </Button>
      </form>
    </div>
  );
}
