require('@nomiclabs/hardhat-ethers');
require('dotenv').config();

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: '0.8.20',
    settings: {
      optimizer: { enabled: true, runs: 1 },
      viaIR: true,
      metadata: { bytecodeHash: 'none' },
      debug: { revertStrings: 'strip' },
    },
  },
  paths: {
    sources: './src/contracts',
    artifacts: './artifacts',
    cache: './cache',
  },
  networks: {
    hardhat: {
      chainId: 31337,
      allowUnlimitedContractSize: true,
    },
    localhost: {
      url: 'http://127.0.0.1:8545',
      chainId: 31337,
    },
  },
};
