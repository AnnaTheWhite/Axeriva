import { useEffect, useState } from "react";
import PageHeader from "../components/PageHeader";
import Button from "../components/ui/Button";
import { useAuth } from "../context/AuthContext";
import { getMyCompany, updateMyCompany } from "../services/company.service";

export default function SettingsPage() {
  const { user } = useAuth();
  const [name, setName] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.companyId) return;

    getMyCompany(user.companyId)
      .then((company) => setName(company.name))
      .finally(() => setIsLoading(false));
  }, [user?.companyId]);

  async function handleSave() {
    if (!user?.companyId) return;

    setMessage(null);

    try {
      await updateMyCompany(user.companyId, { name });
      setMessage("Saved.");
    } catch {
      setMessage("Failed to save changes.");
    }
  }

  if (isLoading) {
    return null;
  }

  return (
    <div className="p-8">
      <PageHeader title="Settings" subtitle="Manage your company profile." />

      <div className="max-w-md rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur-xl">
        <label className="block text-sm text-white/70">Company name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-2 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-white outline-none focus:border-orange-500"
        />

        {message && (
          <p className="mt-4 text-sm text-slate-400">{message}</p>
        )}

        <div className="mt-6">
          <Button onClick={handleSave}>Save</Button>
        </div>
      </div>
    </div>
  );
}
