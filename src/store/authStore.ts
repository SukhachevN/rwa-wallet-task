import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { ethers } from 'ethers';
import deployed from '@/config/contracts.json';

const PHAROS_DEVNET_CHAIN_ID = 50002;
const PHAROS_DEVNET_HEX_CHAIN_ID = ethers.utils.hexValue(PHAROS_DEVNET_CHAIN_ID);
const PHAROS_NETWORK_CONFIG = {
  chainId: PHAROS_DEVNET_HEX_CHAIN_ID,
  chainName: 'Pharos Devnet',
  rpcUrls: ['https://devnet.dplabs-internal.com'],
  nativeCurrency: { name: 'Pharos', symbol: 'PHAROS', decimals: 18 },
  blockExplorerUrls: ['https://pharosscan.xyz'],
};

const HARDHAT_CHAIN_ID = 31337;
const HARDHAT_HEX_CHAIN_ID = ethers.utils.hexValue(HARDHAT_CHAIN_ID);
const HARDHAT_NETWORK_CONFIG = {
  chainId: HARDHAT_HEX_CHAIN_ID,
  chainName: 'Hardhat Local',
  rpcUrls: ['http://127.0.0.1:8545'],
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
};

const getTargetNetwork = () => {
  if (deployed.marketplace && Number(deployed.chainId) === HARDHAT_CHAIN_ID) {
    return {
      chainId: HARDHAT_CHAIN_ID,
      hexChainId: HARDHAT_HEX_CHAIN_ID,
      config: HARDHAT_NETWORK_CONFIG,
    };
  }
  return {
    chainId: PHAROS_DEVNET_CHAIN_ID,
    hexChainId: PHAROS_DEVNET_HEX_CHAIN_ID,
    config: PHAROS_NETWORK_CONFIG,
  };
};

let accountsChangedHandler: ((accounts: string[]) => Promise<void>) | null = null;
let chainChangedHandler: ((chainId: string) => Promise<void>) | null = null;
let activeEthereumProvider: any = null;

/** Prefer MetaMask / a single provider when multiple wallets inject (reduces extension messaging errors). */
const getEip1193Provider = () => {
  if (typeof window === 'undefined') {
    return null;
  }
  const win = window as any;
  const e = win.ethereum;
  if (!e) {
    return null;
  }
  if (Array.isArray(e.providers) && e.providers.length > 0) {
    const withRequest = (p: any) => typeof p?.request === 'function';
    return (
      e.providers.find((p: any) => p.isMetaMask && withRequest(p)) ||
      e.providers.find((p: any) => p.isOkxWallet && withRequest(p)) ||
      e.providers.find((p: any) => p.isRabby && withRequest(p)) ||
      e.providers.find(withRequest) ||
      e.providers[0]
    );
  }
  return e;
};

const getEthereum = () => getEip1193Provider();

const getNormalizedError = (error: unknown): { code?: number; message: string } => {
  if (typeof error === 'object' && error !== null) {
    const maybeError = error as {
      code?: number | string;
      message?: string;
      error?: { code?: number | string; message?: string };
      data?: { originalError?: { code?: number | string } };
    };
    const rawCode =
      maybeError.code ??
      maybeError.error?.code ??
      maybeError.data?.originalError?.code;
    const code = rawCode === undefined ? undefined : Number(rawCode);
    return {
      code: Number.isFinite(code) ? code : undefined,
      message: maybeError.message ?? maybeError.error?.message ?? 'Unknown wallet error',
    };
  }

  if (error instanceof Error) {
    return { message: error.message };
  }

  return { message: 'Unknown wallet error' };
};

const createWeb3Provider = (ethereum: any) =>
  new ethers.providers.Web3Provider(ethereum, 'any');

const safeOn = (ethereum: any, event: string, handler: (...args: any[]) => void) => {
  if (typeof ethereum?.on === 'function') {
    ethereum.on(event, handler);
  } else if (typeof ethereum?.addListener === 'function') {
    ethereum.addListener(event, handler);
  }
};

const safeOff = (ethereum: any, event: string, handler: ((...args: any[]) => void) | null) => {
  if (!ethereum || !handler) {
    return;
  }
  if (typeof ethereum.removeListener === 'function') {
    ethereum.removeListener(event, handler);
    return;
  }
  if (typeof ethereum.off === 'function') {
    ethereum.off(event, handler);
  }
};

const requestWallet = async <T>(
  ethereum: any,
  method: string,
  params?: any[],
  timeoutMs = 120000
): Promise<T> => {
  if (!ethereum || typeof ethereum.request !== 'function') {
    throw new Error('Wallet provider is not available. Please refresh the page and try again.');
  }

  const requestPromise = ethereum.request(
    params ? { method, params } : { method }
  ) as Promise<T>;

  if (method === 'eth_requestAccounts') {
    return requestPromise;
  }

  let timerId = 0;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timerId = window.setTimeout(() => {
      reject(new Error(`Wallet request timed out: ${method}`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([requestPromise, timeoutPromise]);
  } finally {
    window.clearTimeout(timerId);
  }
};

const ensurePharosNetwork = async (ethereum: any): Promise<number> => {
  const target = getTargetNetwork();
  const provider = createWeb3Provider(ethereum);
  let chainId = 0;
  try {
    const network = await provider.getNetwork();
    chainId = Number(network.chainId);
  } catch {
    chainId = 0;
  }

  if (chainId === target.chainId) {
    return chainId;
  }

  try {
    await requestWallet<void>(
      ethereum,
      'wallet_switchEthereumChain',
      [{ chainId: target.hexChainId }],
      30000
    );
    return target.chainId;
  } catch (switchError) {
    const { code } = getNormalizedError(switchError);
    if (code !== 4902) {
      throw switchError;
    }
  }

  await requestWallet<void>(
    ethereum,
    'wallet_addEthereumChain',
    [target.config],
    30000
  );
  return target.chainId;
};

interface KYCData {
  status: 'pending' | 'verified' | 'rejected';
  idVerified: boolean;
  addressVerified: boolean;
  documents: {
    governmentId?: string;
    proofOfAddress?: string;
    additionalDocs?: string[];
  };
  verificationDate?: Date;
}

interface WalletData {
  address: string;
  isConnected: boolean;
  provider?: string;
  chainId?: number;
  balance?: string;
}

interface User {
  id: string;
  email?: string;
  name?: string;
  avatar_url?: string;
  bio?: string;
  preferences?: {
    assetCategories: string[];
    notifications: boolean;
    language: string;
  };
  kyc?: KYCData;
  wallet?: WalletData;
  roles: {
    isBuyer: boolean;
    isSeller: boolean;
  };
  stats: {
    buyerRating?: number;
    sellerRating?: number;
    totalPurchases: number;
    totalSales: number;
  };
  bankAccount?: {
    isVerified: boolean;
    last4: string;
    type: string;
  };
}

interface AuthState {
  isAuthenticated: boolean;
  user: User | null;
  loading: boolean;
  error: string | null;
  authModalOpen: boolean;
  openAuthModal: () => void;
  closeAuthModal: () => void;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  logout: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  updateProfile: (updates: Partial<User>) => Promise<void>;
  connectWallet: () => Promise<boolean>;
  switchToPharos: () => Promise<boolean>;
  disconnectWallet: () => Promise<void>;
  submitKYC: (documents: KYCData['documents']) => Promise<void>;
  updateKYCStatus: (status: KYCData['status']) => Promise<void>;
  toggleRole: (role: 'buyer' | 'seller', enabled: boolean) => Promise<void>;
  connectBankAccount: (accountDetails: any) => Promise<void>;
  clearError: () => void; // Added clearError to the interface
}

const mockUsers = [
  {
    id: '1',
    email: 'demo@example.com',
    password: 'password123',
    name: 'Demo User',
    roles: {
      isBuyer: true,
      isSeller: false,
    },
    stats: {
      totalPurchases: 0,
      totalSales: 0,
    },
  },
];

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      isAuthenticated: false,
      user: null,
      loading: false,
      error: null,
      authModalOpen: false,
      openAuthModal: () => set({ authModalOpen: true, error: null }),
      closeAuthModal: () => set({ authModalOpen: false }),

      login: async (email: string, password: string) => {
        try {
          set({ loading: true, error: null });
          await new Promise((resolve) => setTimeout(resolve, 1000));
          const user = mockUsers.find(
            (u) => u.email === email && u.password === password
          );
          if (!user) {
            throw new Error('Invalid email or password');
          }
          const { password: _, ...userData } = user;
          set({
            isAuthenticated: true,
            user: userData as User,
            loading: false,
          });
        } catch (error) {
          set({
            error: (error as Error).message,
            loading: false,
          });
        }
      },

      register: async (email: string, password: string, name: string) => {
        try {
          set({ loading: true, error: null });
          await new Promise((resolve) => setTimeout(resolve, 1000));
          const newUser = {
            id: crypto.randomUUID(),
            email,
            name,
            roles: {
              isBuyer: true,
              isSeller: false,
            },
            stats: {
              totalPurchases: 0,
              totalSales: 0,
            },
          };
          set({
            isAuthenticated: true,
            user: newUser,
            loading: false,
          });
        } catch (error) {
          set({
            error: (error as Error).message,
            loading: false,
          });
        }
      },

      logout: async () => {
        try {
          console.log('Starting logout process...');
          set({ loading: true, error: null });
          const currentUser = get().user;
          if (currentUser?.wallet?.isConnected) {
            console.log('Wallet connected, disconnecting...');
            await get().disconnectWallet();
          } else {
            console.log('No wallet connected, clearing state...');
            set({
              isAuthenticated: false,
              user: null,
              error: null,
              loading: false,
            });
            localStorage.removeItem('auth-storage');
            sessionStorage.clear();
            console.log('State cleared, redirecting to /');
            window.location.href = '/';
          }
        } catch (error) {
          console.error('Logout error:', error);
          set({
            error: (error as Error).message,
            loading: false,
          });
        }
      },

      resetPassword: async (email: string) => {
        try {
          set({ loading: true, error: null });
          await new Promise((resolve) => setTimeout(resolve, 1000));
          set({ loading: false });
        } catch (error) {
          set({
            error: (error as Error).message,
            loading: false,
          });
        }
      },

      updateProfile: async (updates: Partial<User>) => {
        try {
          set({ loading: true, error: null });
          await new Promise((resolve) => setTimeout(resolve, 1000));
          set((state) => ({
            user: state.user ? { ...state.user, ...updates } : null,
            loading: false,
          }));
        } catch (error) {
          set({
            error: (error as Error).message,
            loading: false,
          });
        }
      },

      connectWallet: async () => {
        if (get().loading) {
          return false;
        }
        try {
          set({ loading: true, error: null });

          const ethereum = getEthereum();
          if (!ethereum) {
            throw new Error('Please install MetaMask or another Web3 wallet.');
          }
          if (typeof ethereum.request !== 'function') {
            throw new Error('Wallet provider is not available. Please refresh the page and try again.');
          }

          activeEthereumProvider = ethereum;

          let accounts: string[] = [];
          try {
            accounts = await requestWallet<string[]>(ethereum, 'eth_requestAccounts');
          } catch (requestError) {
            const { code, message } = getNormalizedError(requestError);
            if (code === -32002 || message.toLowerCase().includes('already processing')) {
              accounts = await requestWallet<string[]>(ethereum, 'eth_accounts');
            } else {
              throw requestError;
            }
          }

          if (!accounts?.length) {
            throw new Error('No account returned from the wallet. Open MetaMask and try again.');
          }
          const address = ethers.utils.getAddress(accounts[0]);

          let chainId = 0;
          try {
            chainId = await ensurePharosNetwork(ethereum);
          } catch {
            try {
              const network = await createWeb3Provider(ethereum).getNetwork();
              chainId = Number(network.chainId);
            } catch {
              chainId = 0;
            }
          }

          let formattedBalance = '0';
          try {
            const balance = await createWeb3Provider(ethereum).getBalance(address);
            formattedBalance = ethers.utils.formatEther(balance);
          } catch {
            formattedBalance = '0';
          }

          const currentUser = get().user;
          const wallet = {
            address,
            isConnected: true,
            provider: 'metamask',
            chainId,
            balance: formattedBalance,
          };
          const nextUser: User = currentUser
            ? { ...currentUser, wallet }
            : {
                id: crypto.randomUUID(),
                wallet,
                roles: { isBuyer: true, isSeller: false },
                stats: { totalPurchases: 0, totalSales: 0 },
              };

          safeOff(activeEthereumProvider, 'accountsChanged', accountsChangedHandler);
          safeOff(activeEthereumProvider, 'chainChanged', chainChangedHandler);

          accountsChangedHandler = async (updatedAccounts: string[]) => {
            if (!updatedAccounts?.length) {
              await get().disconnectWallet();
              return;
            }

            const nextAddress = ethers.utils.getAddress(updatedAccounts[0]);
            const e = getEthereum() || activeEthereumProvider;
            let nextBalance = '0';
            let nextChainId = get().user?.wallet?.chainId || 0;
            try {
              const nextProvider = createWeb3Provider(e);
              nextBalance = ethers.utils.formatEther(await nextProvider.getBalance(nextAddress));
              nextChainId = Number((await nextProvider.getNetwork()).chainId);
            } catch {
              // Keep the connected account even if RPC reads fail.
            }

            set((state) => ({
              user: state.user
                ? {
                    ...state.user,
                    wallet: {
                      address: nextAddress,
                      isConnected: true,
                      provider: 'metamask',
                      chainId: nextChainId,
                      balance: nextBalance,
                    },
                  }
                : state.user,
            }));
          };

          chainChangedHandler = async (chainIdHex: string) => {
            const parsedChainId = Number.parseInt(chainIdHex, 16);
            const connectedAddress = get().user?.wallet?.address;
            let nextBalance = get().user?.wallet?.balance || '0';
            if (connectedAddress) {
              try {
                const e = getEthereum() || activeEthereumProvider;
                nextBalance = ethers.utils.formatEther(
                  await createWeb3Provider(e).getBalance(connectedAddress)
                );
              } catch {
                // Ignore RPC read failures after a network change.
              }
            }

            set((state) => ({
              error:
                parsedChainId === getTargetNetwork().chainId
                  ? null
                  : 'Wallet connected. Switch network to send transactions.',
              user: state.user
                ? {
                    ...state.user,
                    wallet: {
                      ...state.user.wallet!,
                      chainId: parsedChainId,
                      balance: nextBalance,
                    },
                  }
                : state.user,
            }));
          };

          safeOn(ethereum, 'accountsChanged', accountsChangedHandler);
          safeOn(ethereum, 'chainChanged', chainChangedHandler);

          set({
            isAuthenticated: true,
            user: nextUser,
            loading: false,
            error:
              chainId === getTargetNetwork().chainId
                ? null
                : 'Wallet connected. Switch network to send transactions.',
          });
          return true;
        } catch (error) {
          const normalized = getNormalizedError(error);
          const message = normalized.message.toLowerCase();
          let errorMessage = 'Failed to connect wallet. Please try again.';
          if (normalized.code === 4001 || message.includes('rejected') || message.includes('denied')) {
            errorMessage = 'Wallet connection was rejected.';
          } else if (normalized.code === -32002 || message.includes('already processing')) {
            errorMessage = 'MetaMask is already open. Confirm the pending request, then retry.';
          } else if (message.includes('install metamask') || message.includes('wallet provider is not available')) {
            errorMessage = 'Please install MetaMask or unlock it and refresh this page.';
          } else if (message.includes('receiving end does not exist')) {
            errorMessage = 'Wallet extension is not responding. Reopen MetaMask and refresh this page.';
          } else if (message.includes('timed out')) {
            errorMessage = 'Wallet request timed out. Open your wallet popup and try again.';
          }
          set({ error: errorMessage, loading: false });
          return false;
        }
      },

      switchToPharos: async () => {
        try {
          const ethereum = getEthereum();
          if (!ethereum) {
            set({ error: 'Please install MetaMask or another Web3 wallet.' });
            return false;
          }
          const chainId = await ensurePharosNetwork(ethereum);
          set((state) => ({
            error: null,
            user: state.user?.wallet
              ? {
                  ...state.user,
                  wallet: { ...state.user.wallet, chainId },
                }
              : state.user,
          }));
          return chainId === getTargetNetwork().chainId;
        } catch {
          set({ error: 'Could not switch to Pharos Devnet. Approve the request in MetaMask.' });
          return false;
        }
      },
      
      disconnectWallet: async () => {
        try {
          set({ loading: true, error: null });
          if (activeEthereumProvider) {
            safeOff(activeEthereumProvider, 'accountsChanged', accountsChangedHandler);
            safeOff(activeEthereumProvider, 'chainChanged', chainChangedHandler);
          }
          accountsChangedHandler = null;
          chainChangedHandler = null;
          activeEthereumProvider = null;
          set({
            isAuthenticated: false,
            user: null,
            loading: false,
            error: null,
          });
          localStorage.removeItem('auth-storage');
          sessionStorage.clear();
          window.location.href = '/';
        } catch (error) {
          set({
            error: (error as Error).message,
            loading: false,
          });
        }
      },

      submitKYC: async (documents: KYCData['documents']) => {
        try {
          set({ loading: true, error: null });
          await new Promise((resolve) => setTimeout(resolve, 1000));
          set((state) => ({
            user: state.user
              ? {
                  ...state.user,
                  kyc: {
                    status: 'pending',
                    idVerified: false,
                    addressVerified: false,
                    documents,
                    verificationDate: new Date(),
                  },
                }
              : null,
            loading: false,
          }));
        } catch (error) {
          set({
            error: (error as Error).message,
            loading: false,
          });
        }
      },

      updateKYCStatus: async (status: KYCData['status']) => {
        try {
          set({ loading: true, error: null });
          await new Promise((resolve) => setTimeout(resolve, 1000));
          set((state) => ({
            user: state.user && state.user.kyc
              ? {
                  ...state.user,
                  kyc: {
                    ...state.user.kyc,
                    status,
                    idVerified: status === 'verified',
                    addressVerified: status === 'verified',
                  },
                }
              : null,
            loading: false,
          }));
        } catch (error) {
          set({
            error: (error as Error).message,
            loading: false,
          });
        }
      },

      toggleRole: async (role: 'buyer' | 'seller', enabled: boolean) => {
        try {
          set({ loading: true, error: null });
          await new Promise((resolve) => setTimeout(resolve, 1000));
          set((state) => ({
            user: state.user
              ? {
                  ...state.user,
                  roles: {
                    ...state.user.roles,
                    [role === 'buyer' ? 'isBuyer' : 'isSeller']: enabled,
                  },
                }
              : null,
            loading: false,
          }));
        } catch (error) {
          set({
            error: (error as Error).message,
            loading: false,
          });
        }
      },

      connectBankAccount: async (accountDetails: any) => {
        try {
          set({ loading: true, error: null });
          await new Promise((resolve) => setTimeout(resolve, 1000));
          set((state) => ({
            user: state.user
              ? {
                  ...state.user,
                  bankAccount: {
                    isVerified: true,
                    last4: accountDetails.last4,
                    type: accountDetails.type,
                  },
                }
              : null,
            loading: false,
          }));
        } catch (error) {
          set({
            error: (error as Error).message,
            loading: false,
          });
        }
      },

      clearError: () => set({ error: null }), // Implementation of clearError
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        isAuthenticated: state.isAuthenticated,
        user: state.user,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.loading = false;
          state.error = null;
        }
      },
    }
  )
);