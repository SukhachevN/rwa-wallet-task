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

// contracts.json chainId is 31337, but Hardhat is the wallet target only when a
// marketplace address is set. An empty marketplace keeps Pharos Devnet (50002).
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

export type WalletStatus =
  | 'idle'
  | 'no_wallet'
  | 'connecting'
  | 'connected'
  | 'wrong_network'
  | 'rejected';

const NO_WALLET_MESSAGE =
  'No wallet detected in this browser. Install MetaMask or another Web3 wallet, then try again.';
const REJECTED_MESSAGE = 'You rejected the connection request. You can try again.';

let connectAttempt = 0;
let accountsEventSeq = 0;
let accountsChangedHandler: ((...args: any[]) => void) | null = null;
let chainChangedHandler: ((...args: any[]) => void) | null = null;
let disconnectHandler: ((...args: any[]) => void) | null = null;
let activeEthereumProvider: any = null;

// MetaMask replays an empty accountsChanged / disconnect just after a fresh
// eth_requestAccounts when the site was disconnected in the extension. A second
// event with the real account usually follows within the same short window.
const STALE_WALLET_EVENT_GRACE_MS = 150;

const nextConnectAttempt = () => {
  connectAttempt += 1;
  return connectAttempt;
};

const isCurrentAttempt = (attempt: number) => attempt === connectAttempt;

export const getExpectedNetwork = () => {
  const target = getTargetNetwork();
  return {
    chainId: target.chainId,
    hexChainId: target.hexChainId,
    name: target.config.chainName,
  };
};

const KNOWN_CHAIN_NAMES: Record<number, string> = {
  1: 'Ethereum',
  11155111: 'Sepolia',
  137: 'Polygon',
  56: 'BNB Smart Chain',
  10: 'Optimism',
  42161: 'Arbitrum',
  8453: 'Base',
  43114: 'Avalanche',
  1337: 'Localhost',
  31337: 'Hardhat Local',
  50002: 'Pharos Devnet',
};

export const describeChain = (chainId?: number | null) => {
  if (!chainId) {
    return 'Network unknown';
  }
  const name = KNOWN_CHAIN_NAMES[chainId] || `Chain ${chainId}`;
  return `${name} · chain ${chainId}`;
};

const wrongNetworkMessage = () => {
  const target = getTargetNetwork();
  return `Wrong network. Switch to ${target.config.chainName} (chain ID ${target.chainId}) and try again.`;
};

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

const parseChainId = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  const text = String(value ?? '').trim();
  if (!text) {
    return 0;
  }
  const parsed = text.startsWith('0x') || text.startsWith('0X')
    ? Number.parseInt(text, 16)
    : Number(text);
  return Number.isFinite(parsed) ? parsed : 0;
};

let chainEpoch = 0;

const wait = (ms: number) =>
  new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });

const readAuthorizedAccounts = async (ethereum: any): Promise<string[]> => {
  try {
    const accounts = await requestWallet<string[]>(ethereum, 'eth_accounts');
    if (!Array.isArray(accounts)) {
      return [];
    }
    return accounts.filter((account) => typeof account === 'string' && account);
  } catch {
    return [];
  }
};

const readChainId = async (ethereum: any): Promise<number> => {
  try {
    const chainId = await requestWallet<string>(ethereum, 'eth_chainId', [], 8000);
    const parsed = parseChainId(chainId);
    if (parsed) {
      return parsed;
    }
  } catch {
    // Fall back to the synchronous property, then ethers.
  }
  const propertyChainId = parseChainId(ethereum?.chainId ?? ethereum?.networkVersion);
  if (propertyChainId) {
    return propertyChainId;
  }
  try {
    const network = await createWeb3Provider(ethereum).getNetwork();
    const chainId = Number(network.chainId);
    return Number.isFinite(chainId) ? chainId : 0;
  } catch {
    return 0;
  }
};

const isChainMissing = (error: unknown) => {
  const { code, message } = getNormalizedError(error);
  const text = message.toLowerCase();
  return (
    code === 4902 ||
    text.includes('unrecognized chain') ||
    text.includes('not been added') ||
    text.includes('add ethereum chain')
  );
};

// Wallet popups are tied to the click. A parent aggregator shows them;
// a nested provider in ethereum.providers often accepts the request and does nothing.
const walletPromptProvider = (ethereum: any) => {
  if (typeof window === 'undefined') {
    return ethereum;
  }
  const root = (window as any).ethereum;
  if (!root || root === ethereum || typeof root.request !== 'function') {
    return ethereum;
  }
  const providers = Array.isArray(root.providers) ? root.providers : [];
  if (providers.includes(ethereum)) {
    return root;
  }
  return ethereum;
};

const chainIdFromEvent = (value: unknown): number => {
  if (value && typeof value === 'object') {
    const record = value as { chainId?: unknown };
    if ('chainId' in record) {
      return parseChainId(record.chainId);
    }
  }
  return parseChainId(value);
};

const ensurePharosNetwork = async (ethereum: any): Promise<number> => {
  const target = getTargetNetwork();
  const prompt = walletPromptProvider(ethereum);
  const switchParams = [{ chainId: target.hexChainId }];
  // Issued before any other await so the wallet still treats it as the button click.
  const firstSwitch = requestWallet<void>(
    prompt,
    'wallet_switchEthereumChain',
    switchParams,
    120000
  );

  try {
    await firstSwitch;
  } catch (switchError) {
    if (!isChainMissing(switchError)) {
      throw switchError;
    }
    // 4902: this chain is not in the wallet yet.
    await requestWallet<void>(
      prompt,
      'wallet_addEthereumChain',
      [target.config],
      120000
    );
    await requestWallet<void>(
      prompt,
      'wallet_switchEthereumChain',
      switchParams,
      120000
    );
  }

  let observed = 0;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    observed = await readChainId(prompt);
    if (observed === target.chainId) {
      return observed;
    }
    await wait(250);
  }
  return observed;
};

const readBalance = async (ethereum: any, address: string): Promise<string> => {
  try {
    const balance = await createWeb3Provider(ethereum).getBalance(address);
    return ethers.utils.formatEther(balance);
  } catch {
    return '0';
  }
};

const mapWalletFailure = (error: unknown): { walletStatus: WalletStatus; error: string } => {
  const normalized = getNormalizedError(error);
  const message = normalized.message.toLowerCase();
  if (normalized.code === 4001 || message.includes('rejected') || message.includes('denied')) {
    return { walletStatus: 'rejected', error: REJECTED_MESSAGE };
  }
  if (normalized.code === -32002 || message.includes('already processing')) {
    return {
      walletStatus: 'idle',
      error: 'The wallet is already open. Confirm the pending request, then retry.',
    };
  }
  if (
    message.includes('install metamask') ||
    message.includes('no wallet detected') ||
    message.includes('wallet provider is not available')
  ) {
    return { walletStatus: 'no_wallet', error: NO_WALLET_MESSAGE };
  }
  if (message.includes('receiving end does not exist')) {
    return {
      walletStatus: 'no_wallet',
      error: 'The wallet extension is not responding. Reopen it and refresh this page.',
    };
  }
  if (message.includes('timed out')) {
    return {
      walletStatus: 'idle',
      error: 'The wallet request timed out. Open the wallet popup and try again.',
    };
  }
  return { walletStatus: 'idle', error: 'Failed to connect the wallet. Please try again.' };
};

let listenedProviders: any[] = [];

const detachWalletListeners = () => {
  for (const provider of listenedProviders) {
    safeOff(provider, 'accountsChanged', accountsChangedHandler);
    safeOff(provider, 'chainChanged', chainChangedHandler);
    safeOff(provider, 'disconnect', disconnectHandler);
  }
  listenedProviders = [];
  accountsChangedHandler = null;
  chainChangedHandler = null;
  disconnectHandler = null;
};

const publishChain = (set: any, get: () => AuthState, chainId: number) => {
  if (!chainId) {
    return;
  }
  chainEpoch += 1;
  applyObservedChain(set, get, chainId);
};

const applyObservedChain = (set: any, get: () => AuthState, chainId: number) => {
  const onExpected = chainId === getTargetNetwork().chainId;
  const keepSession = get().isAuthenticated && Boolean(get().user?.wallet?.address);
  set((state: AuthState) => ({
    isAuthenticated: Boolean(state.user?.wallet?.address) && (onExpected || keepSession),
    walletStatus: state.user?.wallet?.address
      ? onExpected
        ? 'connected'
        : 'wrong_network'
      : state.walletStatus,
    error: state.user?.wallet?.address && !onExpected ? wrongNetworkMessage() : null,
    user: state.user?.wallet
      ? {
          ...state.user,
          wallet: {
            ...state.user.wallet,
            chainId,
            isConnected: true,
          },
        }
      : state.user,
  }));
};

const walletUser = (current: User | null, wallet: WalletData): User => {
  if (current) {
    return { ...current, wallet };
  }
  return {
    id: crypto.randomUUID(),
    wallet,
    roles: { isBuyer: true, isSeller: false },
    stats: { totalPurchases: 0, totalSales: 0 },
  };
};

const attachProviderListeners = (ethereum: any, attempt: number, get: () => AuthState, set: any) => {
  detachWalletListeners();
  activeEthereumProvider = ethereum;

  accountsChangedHandler = async (updatedAccounts: string[]) => {
    const seq = ++accountsEventSeq;
    if (!isCurrentAttempt(attempt)) {
      return;
    }

    const stillCurrent = () => isCurrentAttempt(attempt) && seq === accountsEventSeq;
    let accounts = Array.isArray(updatedAccounts)
      ? updatedAccounts.filter((account) => typeof account === 'string' && account)
      : [];

    if (!accounts.length) {
      // Disconnecting the site in the extension replays accountsChanged([])
      // once the next eth_requestAccounts succeeds. eth_accounts is the
      // source of truth: an empty event with an authorized account is stale.
      accounts = await readAuthorizedAccounts(ethereum);
      if (!stillCurrent()) {
        return;
      }
      if (!accounts.length && get().user?.wallet?.address && get().walletStatus !== 'connecting') {
        await wait(STALE_WALLET_EVENT_GRACE_MS);
        if (!stillCurrent()) {
          return;
        }
        accounts = await readAuthorizedAccounts(ethereum);
        if (!stillCurrent()) {
          return;
        }
      }
      if (!accounts.length) {
        if (get().walletStatus === 'connecting') {
          return;
        }
        await get().disconnectWallet();
        return;
      }

      const currentAddress = get().user?.wallet?.address;
      if (currentAddress && currentAddress.toLowerCase() === accounts[0].toLowerCase()) {
        return;
      }
    }

    if (get().walletStatus === 'connecting' || !stillCurrent()) {
      return;
    }

    let nextAddress = '';
    try {
      nextAddress = ethers.utils.getAddress(accounts[0]);
    } catch {
      return;
    }

    const epoch = chainEpoch;
    const chainId = await readChainId(ethereum);
    const balance = await readBalance(ethereum, nextAddress);
    if (!stillCurrent()) {
      return;
    }

    set((state: AuthState) => ({
      loading: false,
      user: walletUser(state.user, {
        address: nextAddress,
        isConnected: true,
        provider: 'metamask',
        chainId: state.user?.wallet?.chainId,
        balance,
      }),
    }));
    if (epoch !== chainEpoch || !stillCurrent()) {
      return;
    }
    publishChain(set, get, chainId);
  };

  chainChangedHandler = (chainIdHex: string) => {
    if (!isCurrentAttempt(attempt)) {
      return;
    }
    const observed = chainIdFromEvent(chainIdHex);
    if (!observed) {
      void get().refreshWalletChain();
      return;
    }
    publishChain(set, get, observed);
    const connectedAddress = get().user?.wallet?.address;
    if (!connectedAddress) {
      return;
    }
    void readBalance(ethereum, connectedAddress).then((balance) => {
      if (!isCurrentAttempt(attempt)) {
        return;
      }
      set((state: AuthState) => ({
        user: state.user?.wallet
          ? {
              ...state.user,
              wallet: { ...state.user.wallet, balance },
            }
          : state.user,
      }));
    });
  };

  disconnectHandler = async () => {
    if (!isCurrentAttempt(attempt)) {
      return;
    }
    const seq = accountsEventSeq;
    const stillCurrent = () => isCurrentAttempt(attempt) && seq === accountsEventSeq;
    let live = await readAuthorizedAccounts(ethereum);
    if (!stillCurrent()) {
      return;
    }
    if (!live.length && get().user?.wallet?.address && get().walletStatus !== 'connecting') {
      await wait(STALE_WALLET_EVENT_GRACE_MS);
      if (!stillCurrent()) {
        return;
      }
      live = await readAuthorizedAccounts(ethereum);
      if (!stillCurrent()) {
        return;
      }
    }
    if (live.length || get().walletStatus === 'connecting') {
      return;
    }
    await get().disconnectWallet();
  };

  const providers = [ethereum];
  const rootProvider = typeof window !== 'undefined' ? (window as any).ethereum : null;
  if (rootProvider && rootProvider !== ethereum) {
    providers.push(rootProvider);
  }
  for (const provider of providers) {
    safeOn(provider, 'accountsChanged', accountsChangedHandler);
    safeOn(provider, 'chainChanged', chainChangedHandler);
    safeOn(provider, 'disconnect', disconnectHandler);
    listenedProviders.push(provider);
  }
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
  walletStatus: WalletStatus;
  switchingNetwork: boolean;
  walletSessionChecked: boolean;
  authModalOpen: boolean;
  openAuthModal: () => void;
  closeAuthModal: () => void;
  reconcilePersistedSession: () => Promise<void>;
  releaseWalletBindings: () => void;
  ensureWalletListeners: () => void;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  logout: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  updateProfile: (updates: Partial<User>) => Promise<void>;
  connectWallet: () => Promise<boolean>;
  refreshWalletChain: () => Promise<void>;
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
      walletStatus: 'idle',
      switchingNetwork: false,
      walletSessionChecked: false,
      authModalOpen: false,
      openAuthModal: () =>
        set((state) => ({
          authModalOpen: true,
          error: state.walletStatus === 'wrong_network' ? state.error || wrongNetworkMessage() : null,
        })),
      closeAuthModal: () => set({ authModalOpen: false }),
      releaseWalletBindings: () => {
        nextConnectAttempt();
        detachWalletListeners();
        activeEthereumProvider = null;
        if (get().walletStatus === 'connecting') {
          set({ walletStatus: 'idle', loading: false });
        }
      },
      ensureWalletListeners: () => {
        const ethereum = getEthereum();
        const address = get().user?.wallet?.address;
        if (!ethereum || typeof ethereum.request !== 'function' || !address) {
          return;
        }
        if (chainChangedHandler && activeEthereumProvider === ethereum) {
          return;
        }
        const attempt = connectAttempt || nextConnectAttempt();
        attachProviderListeners(ethereum, attempt, get, set);
      },
      reconcilePersistedSession: async () => {
        const savedAddress = get().user?.wallet?.address;
        if (!savedAddress) {
          if (get().walletStatus !== 'connecting') {
            set({ walletSessionChecked: true, loading: false });
          } else {
            set({ walletSessionChecked: true });
          }
          return;
        }

        const attempt = nextConnectAttempt();
        const ethereum = getEthereum();
        const dropUnconfirmedWallet = () => {
          if (!isCurrentAttempt(attempt)) {
            return;
          }
          const current = get().user;
          if (current?.email) {
            set({
              user: { ...current, wallet: undefined },
              walletStatus: 'idle',
              walletSessionChecked: true,
              loading: false,
              error: null,
            });
            return;
          }
          set({
            isAuthenticated: false,
            user: null,
            walletStatus: 'idle',
            walletSessionChecked: true,
            loading: false,
            error: null,
          });
        };

        if (!ethereum || typeof ethereum.request !== 'function') {
          dropUnconfirmedWallet();
          return;
        }

        let accounts: string[] = [];
        try {
          accounts = await requestWallet<string[]>(ethereum, 'eth_accounts');
        } catch {
          dropUnconfirmedWallet();
          return;
        }
        if (!isCurrentAttempt(attempt)) {
          return;
        }

        const confirmed = accounts?.some(
          (account) => account.toLowerCase() === savedAddress.toLowerCase()
        );
        if (!confirmed) {
          dropUnconfirmedWallet();
          return;
        }

        let address = savedAddress;
        try {
          address = ethers.utils.getAddress(savedAddress);
        } catch {
          dropUnconfirmedWallet();
          return;
        }

        const chainId = await readChainId(ethereum);
        const balance = await readBalance(ethereum, address);
        if (!isCurrentAttempt(attempt)) {
          return;
        }

        const onExpected = chainId === getTargetNetwork().chainId;
        attachProviderListeners(ethereum, attempt, get, set);
        set((state) => ({
          walletSessionChecked: true,
          loading: false,
          isAuthenticated: onExpected,
          walletStatus: onExpected ? 'connected' : 'wrong_network',
          error: onExpected ? null : wrongNetworkMessage(),
          user: walletUser(state.user, {
            address,
            isConnected: true,
            provider: state.user?.wallet?.provider || 'metamask',
            chainId,
            balance,
          }),
        }));
        chainEpoch += 1;
      },

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
        await get().disconnectWallet();
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
        if (get().walletStatus === 'connecting' || get().switchingNetwork) {
          return false;
        }

        const attempt = nextConnectAttempt();
        set({ loading: true, error: null, walletStatus: 'connecting' });

        const commit = (partial: Partial<AuthState>) => {
          if (!isCurrentAttempt(attempt)) {
            return false;
          }
          set(partial);
          return true;
        };

        try {
          const ethereum = getEthereum();
          if (!ethereum || typeof ethereum.request !== 'function') {
            commit({
              loading: false,
              walletStatus: 'no_wallet',
              error: NO_WALLET_MESSAGE,
              isAuthenticated: Boolean(get().user?.email),
            });
            return false;
          }

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
          if (!isCurrentAttempt(attempt)) {
            return false;
          }

          if (!accounts?.length) {
            commit({
              loading: false,
              walletStatus: 'idle',
              error: 'No account returned from the wallet. Open the wallet and try again.',
              isAuthenticated: false,
            });
            return false;
          }

          const address = ethers.utils.getAddress(accounts[0]);
          if (!isCurrentAttempt(attempt)) {
            return false;
          }

          const chainId = await readChainId(ethereum);
          const balance = await readBalance(ethereum, address);
          if (!isCurrentAttempt(attempt)) {
            return false;
          }

          const onExpected = chainId === getTargetNetwork().chainId;
          attachProviderListeners(ethereum, attempt, get, set);
          if (!isCurrentAttempt(attempt)) {
            detachWalletListeners();
            return false;
          }

          set({
            isAuthenticated: onExpected,
            user: walletUser(get().user, {
              address,
              isConnected: true,
              provider: 'metamask',
              chainId,
              balance,
            }),
            loading: false,
            walletStatus: onExpected ? 'connected' : 'wrong_network',
            error: onExpected ? null : wrongNetworkMessage(),
            walletSessionChecked: true,
            authModalOpen: onExpected ? false : get().authModalOpen,
          });
          chainEpoch += 1;
          return onExpected;
        } catch (error) {
          if (!isCurrentAttempt(attempt)) {
            return false;
          }
          detachWalletListeners();
          activeEthereumProvider = null;
          const mapped = mapWalletFailure(error);
          set((state) => ({
            error: mapped.error,
            walletStatus: mapped.walletStatus,
            loading: false,
            isAuthenticated: state.user?.email ? true : false,
            user: state.user?.email ? { ...state.user, wallet: undefined } : null,
          }));
          return false;
        }
      },

      refreshWalletChain: async () => {
        if (get().switchingNetwork) {
          return;
        }
        const ethereum = getEthereum();
        const address = get().user?.wallet?.address;
        if (!ethereum || typeof ethereum.request !== 'function' || !address) {
          return;
        }
        const epoch = chainEpoch;
        const attempt = connectAttempt;
        const chainId = await readChainId(ethereum);
        if (!isCurrentAttempt(attempt) || get().user?.wallet?.address !== address || !chainId || epoch !== chainEpoch) {
          return;
        }
        if (get().user?.wallet?.chainId === chainId && get().user?.wallet?.address === address) {
          return;
        }
        publishChain(set, get, chainId);
      },

      switchToPharos: async () => {
        if (get().switchingNetwork || get().walletStatus === 'connecting') {
          return false;
        }
        const attempt = connectAttempt;
        const target = getTargetNetwork();
        const ethereum = getEthereum();
        if (!ethereum || typeof ethereum.request !== 'function') {
          set({ error: NO_WALLET_MESSAGE, walletStatus: 'no_wallet', switchingNetwork: false });
          return false;
        }
        set({
          switchingNetwork: true,
          error: `Confirm ${target.config.chainName} in the wallet. If it is not in the list, approve adding it.`,
        });
        try {
          const chainId = await ensurePharosNetwork(ethereum);
          if (!isCurrentAttempt(attempt)) {
            return false;
          }
          const onExpected = chainId === target.chainId;
          const keepSession = get().isAuthenticated && Boolean(get().user?.wallet?.address);
          set((state) => ({
            switchingNetwork: false,
            error: onExpected
              ? null
              : `Still on ${describeChain(chainId)}. Approve adding ${target.config.chainName} in the wallet, then switch to it.`,
            walletStatus: state.user?.wallet?.address
              ? onExpected
                ? 'connected'
                : 'wrong_network'
              : state.walletStatus,
            isAuthenticated: Boolean(state.user?.wallet?.address) && (onExpected || keepSession),
            user: state.user?.wallet
              ? {
                  ...state.user,
                  wallet: { ...state.user.wallet, chainId, isConnected: true },
                }
              : state.user,
          }));
          chainEpoch += 1;
          return onExpected;
        } catch (error) {
          if (!isCurrentAttempt(attempt)) {
            return false;
          }
          const normalized = getNormalizedError(error);
          const rejected = normalized.code === 4001;
          set({
            switchingNetwork: false,
            error: rejected
              ? `Network switch was rejected. ${target.config.chainName} (chain ID ${target.chainId}) was not selected.`
              : normalized.message ||
                `Could not switch to ${target.config.chainName}. Approve the request in the wallet.`,
            walletStatus: get().user?.wallet?.address ? 'wrong_network' : get().walletStatus,
          });
          return false;
        }
      },

      disconnectWallet: async () => {
        nextConnectAttempt();
        chainEpoch += 1;
        detachWalletListeners();
        activeEthereumProvider = null;
        set({
          isAuthenticated: false,
          user: null,
          loading: false,
          error: null,
          walletStatus: 'idle',
          switchingNetwork: false,
          authModalOpen: false,
          walletSessionChecked: true,
        });
        try {
          localStorage.removeItem('auth-storage');
        } catch {
          // The in-memory session is already cleared. Storage can be unavailable in tests.
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
      merge: (persistedState, currentState) => {
        const current = currentState as AuthState;
        if (!persistedState || typeof persistedState !== 'object') {
          return {
            ...current,
            walletSessionChecked: true,
            loading: false,
            error: null,
          };
        }
        const stored = persistedState as Partial<AuthState>;
        const user = stored.user ?? null;
        const hasWallet = Boolean(user?.wallet?.address);
        if (!hasWallet) {
          return {
            ...current,
            user,
            isAuthenticated: Boolean(stored.isAuthenticated),
            walletSessionChecked: true,
            loading: false,
            error: null,
          };
        }
        return {
          ...current,
          user,
          isAuthenticated: false,
          walletStatus: current.walletStatus === 'connecting' ? 'connecting' : 'idle',
          walletSessionChecked: false,
          loading: false,
          error: null,
        };
      },
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.loading = false;
          state.error = null;
        }
      },
    }
  )
);