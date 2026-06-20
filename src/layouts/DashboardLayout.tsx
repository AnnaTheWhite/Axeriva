import Topbar from "../components/Topbar";
import Sidebar from "../components/Sidebar";
import EmailVerificationBanner from "../components/EmailVerificationBanner";

type DashboardLayoutProps = {
  children: React.ReactNode;
};

export default function DashboardLayout({
  children,
}: DashboardLayoutProps) {
  return (
    <div className="flex min-h-screen">
      <Sidebar />

      <div className="flex flex-1 flex-col">
        <Topbar />
        <EmailVerificationBanner />

        <main className="flex-1">
          {children}
        </main>
      </div>
    </div>
  );
}