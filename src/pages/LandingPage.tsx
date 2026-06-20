import LandingNavbar from "../components/landing/LandingNavbar";
import HeroSection from "../components/landing/HeroSection";
import BenefitsSection from "../components/landing/BenefitsSection";
import FeaturesSection from "../components/landing/FeaturesSection";
import PricingSection from "../components/landing/PricingSection";
import LandingFooter from "../components/landing/LandingFooter";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#0f172a]">
      <LandingNavbar />
      <HeroSection />
      <BenefitsSection />
      <FeaturesSection />
      <PricingSection />
      <LandingFooter />
    </div>
  );
}
