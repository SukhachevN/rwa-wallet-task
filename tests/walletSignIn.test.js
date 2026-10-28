const assert = require('node:assert/strict');
const { before, beforeEach, test } = require('node:test');
const Module = require('module');
const path = require('path');
const esbuild = require('esbuild');

const ADDRESS = '0x0000000000000000000000000000000000000001';

function installGlobals() {
  const memory = new Map();
  const storage = {
    getItem: (key) => (memory.has(key) ? memory.get(key) : null),
    setItem: (key, value) => {
      memory.set(String(key), String(value));
    },
    removeItem: (key) => {
      memory.delete(String(key));
    },
    clear: () => {
      memory.clear();
    },
    key: (index) => Array.from(memory.keys())[index] ?? null,
    get length() {
      return memory.size;
    },
  };
  global.localStorage = storage;
  global.sessionStorage = storage;
  global.window = global;
  return storage;
}

function loadStore() {
  const result = esbuild.buildSync({
    entryPoints: [path.join(__dirname, '../src/store/authStore.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
    alias: {
      '@': path.join(__dirname, '../src'),
    },
    logLevel: 'silent',
  });
  const mod = new Module(path.join(__dirname, 'authStore.bundle.cjs'));
  mod.filename = path.join(__dirname, 'authStore.bundle.cjs');
  mod.paths = module.paths;
  mod._compile(result.outputFiles[0].text, mod.filename);
  return mod.exports;
}

function createProvider(options) {
  const listeners = new Map();
  const calls = [];
  const provider = {
    isMetaMask: true,
    calls,
    async request({ method, params }) {
      calls.push(method);
      if (method === 'eth_requestAccounts') {
        if (options.onRequestAccounts) {
          return options.onRequestAccounts();
        }
        if (options.requestAccountsError) {
          throw options.requestAccountsError;
        }
        return options.accounts || [];
      }
      if (method === 'eth_accounts') {
        return options.accounts || [];
      }
      if (method === 'eth_chainId') {
        return options.chainId;
      }
      if (method === 'net_version') {
        return String(Number.parseInt(options.chainId, 16));
      }
      if (method === 'eth_getBalance') {
        return '0x0';
      }
      if (method === 'wallet_switchEthereumChain') {
        if (options.switchError) {
          throw options.switchError;
        }
        options.chainId = params[0].chainId;
        return null;
      }
      if (method === 'wallet_addEthereumChain') {
        options.chainId = params[0].chainId;
        if (Number(options.switchError?.code) === 4902) {
          options.switchError = null;
        }
        return null;
      }
      throw new Error(`Unexpected method ${method}`);
    },
    on(event, handler) {
      const list = listeners.get(event) || [];
      list.push(handler);
      listeners.set(event, list);
    },
    removeListener(event, handler) {
      const list = listeners.get(event) || [];
      listeners.set(
        event,
        list.filter((item) => item !== handler)
      );
    },
    off(event, handler) {
      this.removeListener(event, handler);
    },
    async emit(event, payload) {
      const list = [...(listeners.get(event) || [])];
      for (const handler of list) {
        await handler(payload);
      }
    },
    listenerCount(event) {
      return (listeners.get(event) || []).length;
    },
  };
  return provider;
}

let useAuthStore;
let getExpectedNetwork;

before(async () => {
  installGlobals();
  const loaded = loadStore();
  useAuthStore = loaded.useAuthStore;
  getExpectedNetwork = loaded.getExpectedNetwork;
  for (let attempt = 0; attempt < 50 && !useAuthStore.persist.hasHydrated(); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(useAuthStore.persist.hasHydrated(), true);
});

beforeEach(() => {
  delete window.ethereum;
  localStorage.clear();
  useAuthStore.getState().releaseWalletBindings();
  useAuthStore.setState({
    isAuthenticated: false,
    user: null,
    loading: false,
    error: null,
    authModalOpen: false,
    walletStatus: 'idle',
    walletSessionChecked: true,
  });
});

function walletFixture(chainId) {
  return {
    id: 'saved-user',
    wallet: {
      address: ADDRESS,
      isConnected: true,
      chainId,
    },
    roles: { isBuyer: true, isSeller: false },
    stats: { totalPurchases: 0, totalSales: 0 },
  };
}

test('reports no wallet without requesting accounts', async () => {
  const ok = await useAuthStore.getState().connectWallet();
  const state = useAuthStore.getState();
  assert.equal(ok, false);
  assert.equal(state.walletStatus, 'no_wallet');
  assert.equal(state.isAuthenticated, false);
  assert.match(state.error, /No wallet detected/);
});

test('blocks a second request while connecting', async () => {
  const expected = getExpectedNetwork();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let requests = 0;
  window.ethereum = createProvider({
    accounts: [ADDRESS],
    chainId: expected.hexChainId,
    onRequestAccounts: () => {
      requests += 1;
      return gate.then(() => [ADDRESS]);
    },
  });

  const first = useAuthStore.getState().connectWallet();
  const second = await useAuthStore.getState().connectWallet();
  assert.equal(useAuthStore.getState().walletStatus, 'connecting');
  assert.equal(second, false);
  assert.equal(requests, 1);
  release();
  assert.equal(await first, true);
  assert.equal(requests, 1);
  assert.equal(useAuthStore.getState().walletStatus, 'connected');
});

test('connects on the configured network and keeps the full address', async () => {
  const expected = getExpectedNetwork();
  window.ethereum = createProvider({
    accounts: [ADDRESS],
    chainId: expected.hexChainId,
  });

  const ok = await useAuthStore.getState().connectWallet();
  const state = useAuthStore.getState();
  assert.equal(ok, true);
  assert.equal(state.walletStatus, 'connected');
  assert.equal(state.isAuthenticated, true);
  assert.equal(state.user.wallet.address, ADDRESS);
  assert.equal(state.user.wallet.chainId, expected.chainId);
  assert.equal(state.error, null);
});

test('keeps a rejected request retryable', async () => {
  const expected = getExpectedNetwork();
  const options = {
    accounts: [ADDRESS],
    chainId: expected.hexChainId,
    requestAccountsError: { code: 4001, message: 'User rejected the request.' },
  };
  window.ethereum = createProvider(options);

  const rejected = await useAuthStore.getState().connectWallet();
  assert.equal(rejected, false);
  assert.equal(useAuthStore.getState().walletStatus, 'rejected');
  assert.equal(useAuthStore.getState().isAuthenticated, false);
  assert.equal(useAuthStore.getState().user, null);
  assert.match(useAuthStore.getState().error, /rejected/);

  options.requestAccountsError = null;
  const retried = await useAuthStore.getState().connectWallet();
  assert.equal(retried, true);
  assert.equal(useAuthStore.getState().walletStatus, 'connected');
});

test('keeps the address when the network does not match', async () => {
  const expected = getExpectedNetwork();
  const provider = createProvider({
    accounts: [ADDRESS],
    chainId: '0xaa36a7',
    switchError: { code: 4001, message: 'User rejected the request.' },
  });
  window.ethereum = provider;

  const ok = await useAuthStore.getState().connectWallet();
  const state = useAuthStore.getState();
  assert.equal(ok, false);
  assert.equal(state.walletStatus, 'wrong_network');
  assert.equal(state.isAuthenticated, false);
  assert.equal(state.user.wallet.address, ADDRESS);
  assert.equal(state.user.wallet.chainId, 11155111);
  assert.equal(provider.calls.includes('wallet_switchEthereumChain'), false);
  assert.match(state.error, new RegExp(String(expected.chainId)));
});

test('refresh follows the chain currently reported by the wallet', async () => {
  const options = {
    accounts: [ADDRESS],
    chainId: '0x1',
  };
  window.ethereum = createProvider(options);
  await useAuthStore.getState().connectWallet();
  assert.equal(useAuthStore.getState().user.wallet.chainId, 1);

  options.chainId = '0xaa36a7';
  await useAuthStore.getState().refreshWalletChain();
  const state = useAuthStore.getState();
  assert.equal(state.user.wallet.chainId, 11155111);
  assert.equal(state.walletStatus, 'wrong_network');
  assert.equal(state.isAuthenticated, false);
});

test('adds the expected network when the wallet does not have it', async () => {
  const expected = getExpectedNetwork();
  const options = {
    accounts: [ADDRESS],
    chainId: '0xaa36a7',
    switchError: { code: 4902, message: 'Unrecognized chain ID. Try adding the chain.' },
  };
  const provider = createProvider(options);
  window.ethereum = provider;
  await useAuthStore.getState().connectWallet();

  const ok = await useAuthStore.getState().switchToPharos();
  const state = useAuthStore.getState();
  assert.equal(ok, true);
  assert.equal(provider.calls.filter((method) => method === 'wallet_addEthereumChain').length, 1);
  assert.equal(state.walletStatus, 'connected');
  assert.equal(state.isAuthenticated, true);
  assert.equal(state.user.wallet.chainId, expected.chainId);
  assert.equal(state.switchingNetwork, false);
});

test('a rejected switch does not add the network', async () => {
  const options = {
    accounts: [ADDRESS],
    chainId: '0xaa36a7',
    switchError: { code: 4001, message: 'User rejected the request.' },
  };
  const provider = createProvider(options);
  window.ethereum = provider;
  await useAuthStore.getState().connectWallet();

  const ok = await useAuthStore.getState().switchToPharos();
  assert.equal(ok, false);
  assert.equal(provider.calls.includes('wallet_addEthereumChain'), false);
  assert.equal(useAuthStore.getState().user.wallet.chainId, 11155111);
  assert.match(useAuthStore.getState().error, /rejected/i);
});

test('switching network updates the stored chain id', async () => {
  const expected = getExpectedNetwork();
  const options = {
    accounts: [ADDRESS],
    chainId: '0xaa36a7',
    switchError: { code: 4001, message: 'User rejected the request.' },
  };
  window.ethereum = createProvider(options);
  await useAuthStore.getState().connectWallet();
  assert.equal(useAuthStore.getState().user.wallet.chainId, 11155111);

  options.switchError = null;
  const ok = await useAuthStore.getState().switchToPharos();
  const state = useAuthStore.getState();
  assert.equal(ok, true);
  assert.equal(state.walletStatus, 'connected');
  assert.equal(state.isAuthenticated, true);
  assert.equal(state.user.wallet.chainId, expected.chainId);
  assert.equal(state.error, null);
});

test('disconnect clears the local session and returns to signed out', async () => {
  const expected = getExpectedNetwork();
  window.ethereum = createProvider({
    accounts: [ADDRESS],
    chainId: expected.hexChainId,
  });
  await useAuthStore.getState().connectWallet();
  await useAuthStore.getState().disconnectWallet();
  await new Promise((resolve) => setTimeout(resolve, 0));

  const state = useAuthStore.getState();
  assert.equal(state.walletStatus, 'idle');
  assert.equal(state.isAuthenticated, false);
  assert.equal(state.user, null);
  const stored = localStorage.getItem('auth-storage');
  if (stored) {
    const parsed = JSON.parse(stored);
    assert.equal(parsed.state.isAuthenticated, false);
    assert.equal(parsed.state.user, null);
  }
});

test('provider events disconnect, change chain, and ignore stale listeners', async () => {
  const expected = getExpectedNetwork();
  const options = {
    accounts: [ADDRESS],
    chainId: expected.hexChainId,
  };
  const provider = createProvider(options);
  window.ethereum = provider;
  await useAuthStore.getState().connectWallet();

  await provider.emit('chainChanged', '0xaa36a7');
  assert.equal(useAuthStore.getState().walletStatus, 'wrong_network');
  assert.equal(useAuthStore.getState().isAuthenticated, true);
  assert.equal(useAuthStore.getState().user.wallet.chainId, 11155111);
  assert.equal(useAuthStore.getState().user.wallet.address, ADDRESS);

  await provider.emit('chainChanged', expected.hexChainId);
  assert.equal(useAuthStore.getState().walletStatus, 'connected');
  assert.equal(useAuthStore.getState().isAuthenticated, true);
  assert.equal(useAuthStore.getState().error, null);

  useAuthStore.getState().releaseWalletBindings();
  assert.equal(provider.listenerCount('accountsChanged'), 0);
  assert.equal(provider.listenerCount('chainChanged'), 0);
  assert.equal(provider.listenerCount('disconnect'), 0);
  await provider.emit('accountsChanged', []);
  assert.equal(useAuthStore.getState().isAuthenticated, true);

  window.ethereum = provider;
  await useAuthStore.getState().connectWallet();
  await provider.emit('disconnect', { code: 4900, message: 'disconnected' });
  assert.equal(useAuthStore.getState().walletStatus, 'connected');
  assert.equal(useAuthStore.getState().user.wallet.address, ADDRESS);

  options.accounts = [];
  await provider.emit('disconnect', { code: 4900, message: 'disconnected' });
  assert.equal(useAuthStore.getState().walletStatus, 'idle');
  assert.equal(useAuthStore.getState().user, null);

  options.accounts = [ADDRESS];
  window.ethereum = provider;
  await useAuthStore.getState().connectWallet();
  options.accounts = [];
  await provider.emit('accountsChanged', []);
  assert.equal(useAuthStore.getState().walletStatus, 'idle');
  assert.equal(useAuthStore.getState().isAuthenticated, false);
});

test('reconnect after an extension disconnect ignores the stale empty event', async () => {
  const expected = getExpectedNetwork();
  const options = {
    accounts: [ADDRESS],
    chainId: expected.hexChainId,
  };
  const provider = createProvider(options);
  window.ethereum = provider;
  await useAuthStore.getState().connectWallet();

  options.accounts = [];
  await provider.emit('accountsChanged', []);
  assert.equal(useAuthStore.getState().isAuthenticated, false);
  assert.equal(useAuthStore.getState().walletStatus, 'idle');
  assert.equal(useAuthStore.getState().authModalOpen, false);

  options.accounts = [ADDRESS];
  const ok = await useAuthStore.getState().connectWallet();
  await provider.emit('accountsChanged', []);
  await provider.emit('disconnect', { code: 4900, message: 'disconnected' });

  const state = useAuthStore.getState();
  assert.equal(ok, true);
  assert.equal(state.walletStatus, 'connected');
  assert.equal(state.isAuthenticated, true);
  assert.equal(state.user.wallet.address, ADDRESS);
  assert.equal(state.authModalOpen, false);
});

test('ignores a connect result that resolves after disconnect', async () => {
  const expected = getExpectedNetwork();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  window.ethereum = createProvider({
    accounts: [ADDRESS],
    chainId: expected.hexChainId,
    onRequestAccounts: () => gate.then(() => [ADDRESS]),
  });

  const pending = useAuthStore.getState().connectWallet();
  await useAuthStore.getState().disconnectWallet();
  release();
  const ok = await pending;
  assert.equal(ok, false);
  assert.equal(useAuthStore.getState().isAuthenticated, false);
  assert.equal(useAuthStore.getState().user, null);
  assert.equal(useAuthStore.getState().walletStatus, 'idle');
});

test('user connect proceeds while a saved session is still being checked', async () => {
  const expected = getExpectedNetwork();
  let releaseAccounts;
  const accountsGate = new Promise((resolve) => {
    releaseAccounts = resolve;
  });
  const options = {
    accounts: [],
    chainId: expected.hexChainId,
    onRequestAccounts: () => {
      options.accounts = [ADDRESS];
      return [ADDRESS];
    },
  };
  const provider = createProvider(options);
  const request = provider.request.bind(provider);
  provider.request = (args) => {
    if (args.method === 'eth_accounts') {
      return accountsGate.then(() => request(args));
    }
    return request(args);
  };
  window.ethereum = provider;
  useAuthStore.setState({
    isAuthenticated: false,
    user: walletFixture(expected.chainId),
    walletStatus: 'idle',
    walletSessionChecked: false,
  });

  const reconcile = useAuthStore.getState().reconcilePersistedSession();
  const ok = await useAuthStore.getState().connectWallet();
  releaseAccounts();
  await reconcile;

  const state = useAuthStore.getState();
  assert.equal(ok, true);
  assert.equal(state.walletStatus, 'connected');
  assert.equal(state.isAuthenticated, true);
  assert.equal(state.user.wallet.address, ADDRESS);
});

test('does not treat a saved address as an active connection', async () => {
  const provider = createProvider({
    accounts: [],
    chainId: '0x1',
  });
  window.ethereum = provider;
  useAuthStore.setState({
    isAuthenticated: true,
    user: walletFixture(1),
    walletStatus: 'connected',
    walletSessionChecked: false,
  });

  await useAuthStore.getState().reconcilePersistedSession();
  const state = useAuthStore.getState();
  assert.equal(provider.calls.includes('eth_requestAccounts'), false);
  assert.equal(provider.calls.includes('eth_accounts'), true);
  assert.equal(state.isAuthenticated, false);
  assert.equal(state.user, null);
  assert.equal(state.walletSessionChecked, true);
});

test('restores a confirmed provider session without requesting accounts', async () => {
  const expected = getExpectedNetwork();
  const provider = createProvider({
    accounts: [ADDRESS],
    chainId: expected.hexChainId,
  });
  window.ethereum = provider;
  useAuthStore.setState({
    isAuthenticated: false,
    user: walletFixture(1),
    walletStatus: 'idle',
    walletSessionChecked: false,
  });

  await useAuthStore.getState().reconcilePersistedSession();
  const state = useAuthStore.getState();
  assert.equal(provider.calls.includes('eth_requestAccounts'), false);
  assert.equal(state.walletStatus, 'connected');
  assert.equal(state.isAuthenticated, true);
  assert.equal(state.user.wallet.address, ADDRESS);
  assert.equal(state.user.wallet.chainId, expected.chainId);
});

test('ignores a network switch result after local disconnect', async () => {
  const expected = getExpectedNetwork();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const provider = createProvider({ accounts: [ADDRESS], chainId: '0x1' });
  const request = provider.request.bind(provider);
  provider.request = async (args) => {
    if (args.method === 'wallet_switchEthereumChain') {
      await gate;
    }
    return request(args);
  };
  window.ethereum = provider;
  await useAuthStore.getState().connectWallet();
  const pending = useAuthStore.getState().switchToPharos();
  assert.equal(useAuthStore.getState().switchingNetwork, true);
  await useAuthStore.getState().disconnectWallet();
  release();
  assert.equal(await pending, false);
  const state = useAuthStore.getState();
  assert.equal(state.user, null);
  assert.equal(state.isAuthenticated, false);
  assert.equal(state.walletStatus, 'idle');
  assert.equal(state.switchingNetwork, false);
  assert.equal(state.error, null);
});
