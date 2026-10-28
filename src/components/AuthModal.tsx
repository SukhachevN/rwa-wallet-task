import React, { useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Wallet, Loader } from 'lucide-react';
import { Button } from './ui/Button';
import { describeChain, useAuthStore } from '@/store/authStore';
import { AnimatedLogo } from './AnimatedLogo';
import { useNavigate } from 'react-router-dom';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose }) => {
  const {
    connectWallet,
    error,
    clearError,
    isAuthenticated,
    walletStatus,
    switchingNetwork,
    user,
    switchToPharos,
  } = useAuthStore();
  const navigate = useNavigate();
  const address = user?.wallet?.address;
  const isConnecting = walletStatus === 'connecting';

  const goToDashboard = useCallback(() => {
    onClose();
    useAuthStore.getState().closeAuthModal();
    navigate('/dashboard', { replace: true });
  }, [navigate, onClose]);

  useEffect(() => {
    if (isOpen && isAuthenticated && walletStatus === 'connected') {
      goToDashboard();
    }
  }, [isOpen, isAuthenticated, walletStatus, goToDashboard]);

  // Handle escape key press
  const handleEscapeKey = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    },
    [onClose]
  );

  // Add/remove event listeners
  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleEscapeKey);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleEscapeKey);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, handleEscapeKey]);

  // Handle Web3 wallet connection
  const handleWeb3Connect = async () => {
    if (useAuthStore.getState().walletStatus === 'connecting') {
      return;
    }
    clearError();
    const ok = await connectWallet();
    if (ok && useAuthStore.getState().walletStatus === 'connected') {
      goToDashboard();
    }
  };

  const handleSwitchNetwork = async () => {
    if (
      useAuthStore.getState().walletStatus === 'connecting' ||
      useAuthStore.getState().switchingNetwork
    ) {
      return;
    }
    const ok = await switchToPharos();
    if (ok && useAuthStore.getState().walletStatus === 'connected') {
      goToDashboard();
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div
          className="fixed inset-0 z-50"
          aria-labelledby="modal-title"
          role="dialog"
          aria-modal="true"
        >
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/30 backdrop-blur-[2px]"
            onClick={onClose}
            aria-hidden="true"
          />

          {/* Modal Container */}
          <div className="fixed inset-0 z-50 overflow-y-auto">
            <div className="flex min-h-full items-center justify-center p-4 text-center">
              {/* Modal Content */}
              <motion.div
                initial={{ opacity: 0, y: 20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 20, scale: 0.95 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                className="relative w-full max-w-[456px] transform overflow-hidden rounded-2xl bg-white text-left align-middle shadow-xl"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="p-6">
                  {/* Close button */}
                  <button
                    onClick={onClose}
                    className="absolute top-4 right-4 p-2 text-neutral-400 hover:text-neutral-600 transition-colors rounded-full hover:bg-neutral-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    aria-label="Close modal"
                  >
                    <X size={20} />
                  </button>

                  {/* Header */}
                  <div className="flex flex-col items-center space-y-4">
                    <div className="w-[180px]" aria-hidden="true">
                      <AnimatedLogo />
                    </div>
                    <h2
                      id="modal-title"
                      className="text-[28px] font-bold text-blue-700"
                    >
                      Connect Wallet
                    </h2>
                    <p className="text-base text-neutral-600">
                      Connect your wallet to access the platform
                    </p>
                  </div>

                  {/* Form Content */}
                  <div className="mt-8 space-y-5" aria-live="polite">
                    <Button
                      fullWidth
                      disabled={isConnecting}
                      icon={
                        isConnecting ? (
                          <Loader size={16} className="animate-spin" />
                        ) : (
                          <Wallet size={16} />
                        )
                      }
                      iconPosition="left"
                      onClick={handleWeb3Connect}
                      className="bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white"
                    >
                      {isConnecting ? 'Connecting...' : 'Continue with Wallet'}
                    </Button>
                    {address && (
                      <p className="text-sm text-neutral-600 break-all">
                        <span className="block text-neutral-500">Wallet address</span>
                        <span className="font-mono text-neutral-900">{address}</span>
                        <span className="mt-1 block text-neutral-700">{describeChain(user?.wallet?.chainId)}</span>
                      </p>
                    )}
                    {isConnecting && (
                      <p className="text-sm text-neutral-600 flex items-center gap-2">
                        <Loader size={16} className="animate-spin" />
                        Waiting for the wallet...
                      </p>
                    )}
                    {error && (
                      <div
                        className="bg-red-50 border border-red-200 text-red-600 p-3 rounded-lg text-sm flex items-center justify-between gap-3"
                        role="alert"
                      >
                        <span>{error}</span>
                        {walletStatus === 'wrong_network' ? (
                          <button
                            type="button"
                            onClick={handleSwitchNetwork}
                            disabled={switchingNetwork}
                            className="shrink-0 text-red-600 hover:text-red-800 font-medium disabled:opacity-50"
                          >
                            {switchingNetwork ? 'Waiting for wallet...' : 'Switch network'}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={handleWeb3Connect}
                            disabled={isConnecting}
                            className="shrink-0 text-red-600 hover:text-red-800 font-medium disabled:opacity-50"
                          >
                            Retry
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            </div>
          </div>
        </div>
      )}
    </AnimatePresence>
  );
};