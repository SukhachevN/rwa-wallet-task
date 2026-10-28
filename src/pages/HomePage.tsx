import { HeroSection } from '../components/HeroSection';
import { FeaturedAssets } from '../components/FeaturedAssets';
import { HowItWorks } from '../components/HowItWorks';
import { StatsSection } from '../components/StatsSection';
import { ValidatorCard } from '../components/ValidatorCard';
import { Button } from '../components/ui/Button';
import { Header } from '../components/layout/Header';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { useValidatorStore } from '@/store/validatorStore';

const HomePage = () => {
  const navigate = useNavigate();
  const { isAuthenticated, openAuthModal } = useAuthStore();
  const { validators } = useValidatorStore();

  const featuredValidators = validators.slice(0, 3);

  return (
    <div>
      <Header />
      <HeroSection />
      <StatsSection />
      <FeaturedAssets />
      <HowItWorks />
      
      <section className="py-16 bg-gradient-to-b from-neutral-50 to-white">
        <div className="container-custom">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-primary-800">Trusted Validators</h2>
            <p className="mt-3 text-neutral-600 max-w-2xl mx-auto">
              Our network of validators ensures the authenticity and quality of every tokenized asset
            </p>
          </div>
          
          {featuredValidators.length === 0 ? (
            <p className="text-center text-neutral-500">No validators available yet.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {featuredValidators.map((validator) => (
                <ValidatorCard key={validator.id} validator={validator as any} />
              ))}
            </div>
          )}
          
          <div className="mt-10 text-center">
            <Button
              variant="secondary"
              onClick={() => (isAuthenticated ? navigate('/validators') : openAuthModal())}
            >
              View All Validators
            </Button>
          </div>
        </div>
      </section>
      
      <section className="py-16 bg-primary-800 text-white">
        <div className="container-custom">
          <div className="max-w-3xl mx-auto text-center">
            <h2 className="text-3xl font-bold mb-4">Ready to Tokenize Your Asset?</h2>
            <p className="text-lg text-neutral-300 mb-8">
              Join our growing community of asset owners and traders in the decentralized marketplace.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button
                variant="primary"
                className="bg-secondary-500 hover:bg-secondary-600 text-white"
                size="lg"
                onClick={() => (isAuthenticated ? navigate('/asset-creation') : openAuthModal())}
              >
                Start Tokenizing
              </Button>
              <Button
                variant="outline"
                className="border-white text-white hover:bg-white/10"
                size="lg"
                onClick={() => navigate('/marketplace')}
              >
                Explore Marketplace
              </Button>
              <Button
                variant="outline"
                className="border-white text-white hover:bg-white/10"
                size="lg"
                onClick={() => (isAuthenticated ? navigate('/dashboard') : openAuthModal())}
              >
                Dashboard
              </Button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

export default HomePage;
