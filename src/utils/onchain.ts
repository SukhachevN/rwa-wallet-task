import { ethers } from 'ethers';
import deployed from '@/config/contracts.json';

const KYC_ABI = [
  'function isVerified(address userAddress) view returns (bool)',
  'function selfVerify() external',
];

const MARKETPLACE_ABI = [
  'function createAsset(string title, string description, string category, uint256 price, uint8 tokenizationType, uint256 totalTokens, uint256 pricePerToken, uint8 listingType, uint256 auctionEndTime, address royaltyReceiver, uint96 royaltyFraction) external returns (uint256)',
  'function validateAsset(uint256 assetId) external',
  'function getAssetDetails(uint256 assetId) view returns (uint256 id, address owner, string title, string description, string category, uint8 status, uint256 price, uint8 tokenizationType, uint256 totalTokens, uint256 availableTokens, uint256 pricePerToken, uint8 listingType, bool isVerified, uint256 createdAt, uint256 updatedAt, uint256 auctionEndTime, address royaltyReceiver, uint96 royaltyFraction)',
];

export type DeployedContracts = {
  chainId: number;
  deployer: string;
  kyc: string;
  compliance: string;
  marketplace: string;
  token: string;
};

export const deployedContracts = deployed as DeployedContracts;

export const isOnChainConfigured = () =>
  Boolean(deployedContracts.marketplace && deployedContracts.kyc);

export const getAppChainId = () => deployedContracts.chainId || 31337;

export function getBrowserProvider() {
  const ethereum = (window as any).ethereum;
  if (!ethereum) {
    throw new Error('MetaMask is not available. Connect a wallet first.');
  }
  return new ethers.providers.Web3Provider(ethereum, 'any');
}

export async function createAssetOnChain(input: {
  title: string;
  description: string;
  category: string;
  price: number;
}) {
  if (!isOnChainConfigured()) {
    return null;
  }

  const provider = getBrowserProvider();
  const network = await provider.getNetwork();
  if (Number(network.chainId) !== getAppChainId()) {
    throw new Error(`Switch MetaMask to chain ${getAppChainId()} before creating an on-chain asset.`);
  }

  const signer = provider.getSigner();
  const account = await signer.getAddress();
  const kyc = new ethers.Contract(deployedContracts.kyc, KYC_ABI, signer);
  const marketplace = new ethers.Contract(deployedContracts.marketplace, MARKETPLACE_ABI, signer);

  const verified = await kyc.isVerified(account);
  if (!verified) {
    const verifyTx = await kyc.selfVerify();
    await verifyTx.wait();
  }

  const price = ethers.BigNumber.from(Math.max(Math.floor(input.price) || 1, 1));
  const tx = await marketplace.createAsset(
    input.title,
    input.description,
    input.category,
    price,
    1,
    1,
    price,
    0,
    0,
    ethers.constants.AddressZero,
    0
  );
  const receipt = await tx.wait();
  const created = receipt.events?.find((event: { event?: string }) => event.event === 'AssetCreated');
  const assetId = created?.args?.assetId ? Number(created.args.assetId) : 0;

  try {
    const validateTx = await marketplace.validateAsset(assetId);
    await validateTx.wait();
  } catch {
    // Deployer/admin can validate; other wallets still created a pending on-chain asset.
  }

  return {
    assetId,
    txHash: receipt.transactionHash as string,
  };
}
