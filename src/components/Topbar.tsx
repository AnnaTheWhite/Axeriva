import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Topbar() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  function handleLogout() {
    logout();
    navigate("/login");
  }

  return (
    <header
      className="
        flex
        items-center
        justify-between
        border-b
        border-white/10
        px-8
        py-4
      "
    >
      <div>
        <h2 className="text-lg font-semibold">
          Axeriva
        </h2>
      </div>

      <div className="flex items-center gap-4">
        {user && (
          <span className="text-sm text-white/60">{user.email}</span>
        )}

        <button
          onClick={handleLogout}
          className="
            rounded-xl
            border
            border-white/10
            bg-white/5
            px-3
            py-1.5
            text-sm
            text-white
            transition
            hover:bg-white/10
          "
        >
          Log out
        </button>

        <div
          className="
            flex
            h-10
            w-10
            items-center
            justify-center
            rounded-full
            bg-orange-500
            font-bold
          "
        >
          {user?.email?.[0]?.toUpperCase() ?? "A"}
        </div>
      </div>
    </header>
  );
}
