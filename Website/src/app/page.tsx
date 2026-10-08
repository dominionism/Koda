import Navbar from "@/components/nav/Navbar";
import Hero from "@/components/hero/Hero";
import Stats from "@/components/stats/Stats";
import Features from "@/components/features/Features";
import HowItWorks from "@/components/how-it-works/HowItWorks";
import DevWorkflows from "@/components/dev-workflows/DevWorkflows";
import CTASection from "@/components/cta/CTASection";
import Footer from "@/components/footer/Footer";
import Divider from "@/components/ui/Divider";

/** Homepage composing all landing-page sections.
 *
 * Renders Navbar, Hero, Stats, Features, HowItWorks, DevWorkflows,
 * CTASection, and Footer in sequence with Dividers between major sections.
 *
 * @returns The full marketing homepage
 */
export default function Home() {
  return (
    <>
      <Navbar />
      <main className="overflow-x-hidden">
        <Hero />
        <Stats />
        <Divider />
        <Features />
        <Divider />
        <HowItWorks />
        <Divider />
        <DevWorkflows />
        <CTASection />
      </main>
      <Footer />
    </>
  );
}
