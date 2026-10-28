const fs = require('fs');
const path = require('path');
const { ethers, network } = require('hardhat');

async function deployProxy(name, initArgs = []) {
  const Factory = await ethers.getContractFactory(name);
  const implementation = await Factory.deploy();
  await implementation.deployed();

  const initData = Factory.interface.encodeFunctionData('initialize', initArgs);
  const Proxy = await ethers.getContractFactory('ERC1967Proxy');
  const proxy = await Proxy.deploy(implementation.address, initData);
  await proxy.deployed();
  return Factory.attach(proxy.address);
}

async function main() {
  const [deployer] = await ethers.getSigners();

  const Compliance = await ethers.getContractFactory('RWAHubCompliance');
  const compliance = await Compliance.deploy();
  await compliance.deployed();

  const kyc = await deployProxy('RWAHubKYC');
  await (await kyc.setSelfVerifyEnabled(true)).wait();

  const marketplace = await deployProxy('RWAHubMarketplace', [
    kyc.address,
    compliance.address,
    250,
    deployer.address,
  ]);

  const token = await deployProxy('RWAHubToken');
  await (await token.setIdentityRegistry(kyc.address)).wait();
  await (await token.setCompliance(compliance.address)).wait();

  const deployed = {
    chainId: network.config.chainId || 31337,
    deployer: deployer.address,
    kyc: kyc.address,
    compliance: compliance.address,
    marketplace: marketplace.address,
    token: token.address,
  };

  const dest = path.join(__dirname, '..', 'src', 'config', 'contracts.json');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, `${JSON.stringify(deployed, null, 2)}\n`);

  console.log('Deployed contracts:');
  console.log(deployed);
  console.log(`Wrote ${dest}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
