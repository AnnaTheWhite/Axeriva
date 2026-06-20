import PageHeader from "../components/PageHeader";
import { useAuth } from "../context/AuthContext";

export default function ProfilePage() {
  const { user } = useAuth();

  return (
    <div className="p-8">
      <PageHeader title="Profile" subtitle="Your account details." />

      <div className="max-w-md rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur-xl">
        <p className="text-sm text-slate-400">Email</p>
        <p className="mt-1 text-white">{user?.email}</p>

        <p className="mt-6 text-sm text-slate-400">Role</p>
        <p className="mt-1 text-white">{user?.role}</p>
      </div>
    </div>
  );
}
