import { ethers } from "hardhat";
import { ClaimData } from "./merkleHelpers";

/**
 * Test Data Generator Utilities
 *
 * Utilities for generating test data for various scenarios
 */

/**
 * Generate test claims with random or specified amounts
 * @param count Number of claims to generate
 * @param addresses Array of addresses (will be reused if count > addresses.length)
 * @param amounts Optional array of amounts (will be random if not provided)
 * @param startIndex Starting index for claims (default: 0)
 * @returns Array of ClaimData
 */
export function generateTestClaims(
  count: number,
  addresses: string[],
  amounts?: (bigint | string)[],
  startIndex: number = 0
): ClaimData[] {
  const claims: ClaimData[] = [];

  for (let i = 0; i < count; i++) {
    const addressIndex = i % addresses.length;
    const address = addresses[addressIndex].toLowerCase();

    let amount: bigint;
    if (amounts && amounts[i % amounts.length]) {
      amount =
        typeof amounts[i % amounts.length] === "string"
          ? BigInt(amounts[i % amounts.length] as string)
          : (amounts[i % amounts.length] as bigint);
    } else {
      // Generate random amount between 1000 and 10000 (in base units)
      const randomAmount = Math.floor(Math.random() * 9000) + 1000;
      amount = BigInt(randomAmount);
    }

    claims.push({
      index: startIndex + i,
      account: address,
      amount,
    });
  }

  return claims;
}

/**
 * Generate MongoDB-like server IDs
 * @param count Number of server IDs to generate
 * @param prefix Optional prefix for server IDs
 * @returns Array of server ID strings
 */
export function generateServerIds(
  count: number,
  prefix: string = "507f1f77bcf86cd7994390"
): string[] {
  const serverIds: string[] = [];

  for (let i = 0; i < count; i++) {
    // Generate last 2 hex characters
    const suffix = i.toString(16).padStart(2, "0");
    serverIds.push(`${prefix}${suffix}`);
  }

  return serverIds;
}

/**
 * Generate a Discord-like test scenario structure
 * @param numServers Number of servers to create
 * @param numCampaignsPerServer Number of campaigns per server
 * @param addresses Array of user addresses
 * @returns Scenario structure with server and campaign data
 */
export function createDiscordScenario(
  numServers: number,
  numCampaignsPerServer: number,
  addresses: string[]
): {
  servers: Array<{
    serverId: string;
    campaigns: Array<{
      campaignIndex: number;
      claims: ClaimData[];
      userCount: number;
    }>;
  }>;
} {
  const serverIds = generateServerIds(numServers);

  const servers = serverIds.map((serverId, serverIndex) => {
    const campaigns = [];

    for (
      let campaignIndex = 0;
      campaignIndex < numCampaignsPerServer;
      campaignIndex++
    ) {
      // Distribute users across campaigns
      const usersPerCampaign = Math.ceil(
        addresses.length / numCampaignsPerServer
      );
      const startUserIndex = campaignIndex * usersPerCampaign;
      const endUserIndex = Math.min(
        startUserIndex + usersPerCampaign,
        addresses.length
      );
      const campaignAddresses = addresses.slice(startUserIndex, endUserIndex);

      // Generate claims for this campaign
      const claims = generateTestClaims(
        campaignAddresses.length,
        campaignAddresses,
        undefined,
        campaignIndex * 1000 // Offset indices per campaign
      );

      campaigns.push({
        campaignIndex,
        claims,
        userCount: campaignAddresses.length,
      });
    }

    return {
      serverId,
      campaigns,
    };
  });

  return { servers };
}

/**
 * Get Hardhat signers addresses (accounts 0-18 for 19 users)
 */
export async function getTestUserAddresses(): Promise<string[]> {
  const signers = await ethers.getSigners();
  return Promise.all(signers.slice(0, 19).map((signer) => signer.getAddress()));
}

/**
 * Generate claims with specific total amount distributed equally
 * @param addresses Array of addresses
 * @param totalAmount Total amount to distribute
 * @param startIndex Starting index for claims
 * @returns Array of ClaimData with equal distribution
 */
export function generateEqualDistributionClaims(
  addresses: string[],
  totalAmount: bigint,
  startIndex: number = 0
): ClaimData[] {
  const amountPerUser = totalAmount / BigInt(addresses.length);
  const remainder = totalAmount % BigInt(addresses.length);

  return addresses.map((address, i) => {
    // Add remainder to first user
    const amount = i === 0 ? amountPerUser + remainder : amountPerUser;
    return {
      index: startIndex + i,
      account: address.toLowerCase(),
      amount,
    };
  });
}

/**
 * Generate claims with weighted distribution
 * @param addresses Array of addresses
 * @param weights Array of weights (must match addresses length or be empty for equal weights)
 * @param totalAmount Total amount to distribute
 * @param startIndex Starting index for claims
 * @returns Array of ClaimData with weighted distribution
 */
export function generateWeightedDistributionClaims(
  addresses: string[],
  weights: number[],
  totalAmount: bigint,
  startIndex: number = 0
): ClaimData[] {
  // If no weights provided, use equal weights
  const effectiveWeights =
    weights.length === addresses.length ? weights : addresses.map(() => 1);

  const totalWeight = effectiveWeights.reduce((sum, w) => sum + w, 0);

  return addresses.map((address, i) => {
    const weight = effectiveWeights[i];
    const amount = (totalAmount * BigInt(weight)) / BigInt(totalWeight);
    return {
      index: startIndex + i,
      account: address.toLowerCase(),
      amount,
    };
  });
}

/**
 * Create a test scenario with multiple servers and campaigns
 */
export interface DiscordScenario {
  servers: Array<{
    serverId: string;
    factoryOwner: string;
    campaigns: Array<{
      campaignIndex: number;
      claims: ClaimData[];
      creator: string;
    }>;
  }>;
}

/**
 * Generate complete Discord-like scenario with all addresses
 */
export async function generateDiscordScenario(
  numServers: number = 10,
  numCampaignsPerServer: number = 3
): Promise<DiscordScenario> {
  const signers = await ethers.getSigners();
  const addresses = await Promise.all(
    signers.slice(0, 19).map((s) => s.getAddress())
  );

  const serverIds = generateServerIds(numServers);

  const servers = await Promise.all(
    serverIds.map(async (serverId, serverIndex) => {
      // Each server has an owner (distribute owners across signers)
      const ownerIndex = (serverIndex % (signers.length - 1)) + 1; // Skip account 0
      const factoryOwner = await signers[ownerIndex].getAddress();

      const campaigns = [];

      for (
        let campaignIndex = 0;
        campaignIndex < numCampaignsPerServer;
        campaignIndex++
      ) {
        // Each campaign has a creator
        const creatorIndex =
          ((serverIndex * numCampaignsPerServer + campaignIndex) %
            (signers.length - 1)) +
          1;
        const creator = await signers[creatorIndex].getAddress();

        // Generate claims for this campaign
        const usersPerCampaign = Math.ceil(
          addresses.length / numCampaignsPerServer
        );
        const startUserIndex =
          (campaignIndex * usersPerCampaign) % addresses.length;
        const campaignAddresses = [];
        for (let i = 0; i < Math.min(usersPerCampaign, addresses.length); i++) {
          campaignAddresses.push(
            addresses[(startUserIndex + i) % addresses.length]
          );
        }

        const claims = generateTestClaims(
          campaignAddresses.length,
          campaignAddresses,
          undefined,
          serverIndex * 10000 + campaignIndex * 1000 // Unique indices
        );

        campaigns.push({
          campaignIndex,
          claims,
          creator,
        });
      }

      return {
        serverId,
        factoryOwner,
        campaigns,
      };
    })
  );

  return { servers };
}
