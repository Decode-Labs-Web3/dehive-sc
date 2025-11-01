import { ethers, Interface } from "ethers";
import { IDehiveProxy } from "../../../typechain-types";

/**
 * Get all function selectors from an interface
 * @param abi The ABI of the contract
 * @returns Array of function selectors (4-byte hex strings)
 */
export function getFunctionSelectors(abi: any[]): string[] {
  const iface = new Interface(abi);
  const selectors: string[] = [];

  // Iterate through all fragments and get function selectors
  for (const fragment of Object.values(iface.fragments)) {
    if (fragment.type === "function") {
      const selector = iface.getFunction(fragment.name).selector;
      selectors.push(selector);
    }
  }

  return selectors;
}

/**
 * Verify that a facet is properly installed in the proxy
 * @param proxy The DehiveProxy contract instance
 * @param facetAddress The address of the facet to verify
 * @param expectedSelectors Array of expected function selectors
 * @returns True if all selectors are correctly routed to the facet
 */
export async function verifyFacetInstallation(
  proxy: IDehiveProxy,
  facetAddress: string,
  expectedSelectors: string[]
): Promise<boolean> {
  const installedSelectors = await proxy.facetFunctionSelectors(facetAddress);

  // Check that all expected selectors are installed
  for (const selector of expectedSelectors) {
    const facet = await proxy.facetAddress(selector);
    if (facet.toLowerCase() !== facetAddress.toLowerCase()) {
      return false;
    }
  }

  // Check that installed selectors match expected (allowing for additional ones)
  const expectedSet = new Set(expectedSelectors.map((s) => s.toLowerCase()));
  const installedSet = new Set(installedSelectors.map((s) => s.toLowerCase()));

  // All expected selectors must be installed
  for (const selector of expectedSet) {
    if (!installedSet.has(selector)) {
      return false;
    }
  }

  return true;
}

/**
 * Get facet information from the proxy
 * @param proxy The DehiveProxy contract instance
 * @param facetAddress The address of the facet
 * @returns Object with facet information
 */
export async function getFacetInfo(
  proxy: IDehiveProxy,
  facetAddress: string
): Promise<{
  address: string;
  selectors: string[];
  isInstalled: boolean;
}> {
  const selectors = await proxy.facetFunctionSelectors(facetAddress);

  return {
    address: facetAddress,
    selectors: selectors,
    isInstalled: selectors.length > 0,
  };
}

/**
 * Get all facets installed in the proxy
 * @param proxy The DehiveProxy contract instance
 * @returns Array of facet addresses
 */
export async function getAllFacets(proxy: IDehiveProxy): Promise<string[]> {
  return await proxy.facetAddresses();
}
