import { useState, useEffect, type MouseEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Menu, X, LogOut, ExternalLink } from 'lucide-react';
import { Button } from '../ui/Button';
import { motion, AnimatePresence } from 'framer-motion';
import { AnimatedLogo } from '../AnimatedLogo';
import { useAuthStore } from '@/store/authStore';
import { truncateAddress } from '@/utils/formatters';
import { describeChain } from '@/store/authStore';

// Assuming AnimatedLogoProps is defined elsewhere and includes className
interface AnimatedLogoProps {
  className?: string;
}

export const Header = () => {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { isAuthenticated, logout, openAuthModal, user, walletStatus, disconnectWallet } = useAuthStore();
  const walletAddress = user?.wallet?.address;

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 10);
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [location]);

  const handleOpenAuthModal = () => {
    openAuthModal();
    setIsMobileMenuOpen(false);
  };

  const handleDashboardClick = (event: MouseEvent) => {
    if (!isAuthenticated) {
      event.preventDefault();
      handleOpenAuthModal();
    }
  };

  const handleLogout = async () => {
    try {
      setIsLoggingOut(true);
      await logout();
      navigate('/');
    } catch (error) {
      console.error('Logout failed:', error);
    } finally {
      setIsLoggingOut(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      setIsLoggingOut(true);
      await disconnectWallet();
      navigate('/');
    } catch (error) {
      console.error('Disconnect failed:', error);
    } finally {
      setIsLoggingOut(false);
    }
  };

  const renderAuthButton = () => {
    if (walletStatus === 'connecting') {
      return (
        <Button disabled className="flex items-center gap-2">
          Connecting...
        </Button>
      );
    }

    if (walletAddress && (walletStatus === 'connected' || walletStatus === 'wrong_network')) {
      return (
        <div className="flex items-center gap-4">
          {isAuthenticated && (
            <Link to="/dashboard" className="text-sm text-neutral-600 hover:text-blue-600">
              Dashboard
            </Link>
          )}
          <span className="text-sm font-mono text-neutral-700" title={walletAddress}>
            <span className="sr-only">{walletAddress}</span>
            <span aria-hidden="true">{truncateAddress(walletAddress)}</span>
          </span>
          <span className={`text-xs ${walletStatus === 'wrong_network' ? 'text-amber-700' : 'text-neutral-500'}`}>
            {describeChain(user?.wallet?.chainId)}
          </span>
          {walletStatus === 'wrong_network' && (
            <button
              type="button"
              onClick={handleOpenAuthModal}
              className="text-xs font-medium text-amber-700 hover:text-amber-800"
            >
              Wrong network
            </button>
          )}
          <span title="Disconnects this app only. Wallet permissions stay unchanged.">
            <Button
              variant="outline"
              onClick={handleDisconnect}
              disabled={isLoggingOut}
              className="flex items-center gap-2"
            >
              <LogOut size={16} />
              {isLoggingOut ? 'Disconnecting...' : 'Disconnect'}
            </Button>
          </span>
        </div>
      );
    }

    if (isAuthenticated) {
      return (
        <div className="flex items-center gap-4">
          <Link to="/dashboard" className="text-sm text-neutral-600 hover:text-blue-600">
            Dashboard
          </Link>
          <Button
            variant="outline"
            onClick={handleLogout}
            disabled={isLoggingOut}
            className="flex items-center gap-2"
          >
            <LogOut size={16} />
            {isLoggingOut ? 'Logging out...' : 'Logout'}
          </Button>
        </div>
      );
    }

    return <Button onClick={handleOpenAuthModal}>Sign In</Button>;
  };

  const navItems = [
    { name: 'Marketplace', path: '/marketplace', isExternal: false },
    { name: 'Dashboard', path: '/dashboard', isExternal: false },
    { name: 'Join Waitlist', path: 'https://form.typeform.com/to/vcGRVShj', isExternal: true },
  ];

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-40 transition-all duration-200 ${
        isScrolled ? 'bg-white shadow-sm' : 'bg-transparent'
      }`}
    >
      <div className="container-custom">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <div className="flex items-center">
            <Link to="/" className="flex items-center">
              <AnimatedLogo className="w-32" />
            </Link>
          </div>

          {/* Desktop Navigation - Centered */}
          <nav className="hidden md:flex flex-1 justify-center items-center">
            <div className="flex items-center gap-8">
              {navItems.map((item) =>
                item.isExternal ? (
                  <a
                    key={item.path}
                    href={item.path}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-neutral-600 hover:text-blue-600 flex items-center gap-1"
                  >
                    {item.name}
                    <ExternalLink size={14} />
                  </a>
                ) : (
                  <Link
                    key={item.path}
                    to={item.path}
                    onClick={item.path === '/dashboard' ? handleDashboardClick : undefined}
                    className={`text-sm ${
                      location.pathname === item.path
                        ? 'text-blue-600 font-medium'
                        : 'text-neutral-600 hover:text-blue-600'
                    }`}
                  >
                    {item.name}
                  </Link>
                )
              )}
            </div>
          </nav>

          {/* Right Actions */}
          <div className="flex items-center gap-4">
            <div className="hidden md:block">{renderAuthButton()}</div>

            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="md:hidden p-2 text-neutral-600 hover:text-blue-600"
              aria-label={isMobileMenuOpen ? 'Close menu' : 'Open menu'}
            >
              {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Menu */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="md:hidden bg-white border-t"
          >
            <div className="container-custom py-4">
              <nav className="flex flex-col gap-4 text-center">
                {navItems.map((item) =>
                  item.isExternal ? (
                    <a
                      key={item.path}
                      href={item.path}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-neutral-600 hover:text-blue-600 flex items-center gap-1 justify-center"
                    >
                      {item.name}
                      <ExternalLink size={14} />
                    </a>
                  ) : (
                    <Link
                      key={item.path}
                      to={item.path}
                      onClick={item.path === '/dashboard' ? handleDashboardClick : undefined}
                      className={`text-sm ${
                        location.pathname === item.path
                          ? 'text-blue-600 font-medium'
                          : 'text-neutral-600 hover:text-blue-600'
                      }`}
                    >
                      {item.name}
                    </Link>
                  )
                )}
                <div className="pt-4 border-t">{renderAuthButton()}</div>
              </nav>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

    </header>
  );
};