import LandingNavbar from "../components/landing/LandingNavbar";
import PricingSection from "../components/landing/PricingSection";
import LandingFooter from "../components/landing/LandingFooter";

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-[#0f172a]">
      <LandingNavbar />

      <div className="pt-12">
        <PricingSection />
      </div>

      <LandingFooter />
    </div>
  );
}
