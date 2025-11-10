import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const ProxyFactory = await ethers.getContractFactory("DehiveProxy");
  const proxy = await ProxyFactory.deploy();
  await proxy.waitForDeployment();

  const owner = await proxy.owner();
  console.log("Proxy owner:", owner);
  console.log("Match:", owner.toLowerCase() === deployer.address.toLowerCase());
}

main().catch(console.error);
