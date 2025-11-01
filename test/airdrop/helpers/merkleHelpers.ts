import { ethers } from "ethers";
import { MerkleTree } from "merkletreejs";
import { keccak256, solidityPacked } from "ethers";

/**
 * Merkle Tree Helper Utilities
 *
 * Provides utilities for generating Merkle trees compatible with OpenZeppelin's MerkleProof
 * Leaf format: keccak256(abi.encodePacked(index, account, amount))
 */

export interface ClaimData {
  index: number;
  account: string;
  amount: bigint | string;
}

export interface MerkleTreeData {
  tree: MerkleTree;
  root: string;
  claims: ClaimData[];
}

/**
 * Generate a Merkle tree from claims data
 * @param claims Array of claim data (index, account, amount)
 * @returns MerkleTreeData with tree, root, and original claims
 */
export function generateMerkleTree(claims: ClaimData[]): MerkleTreeData {
  // Generate leaves: keccak256(abi.encodePacked(index, account, amount))
  const leaves = claims.map((claim) => {
    const index = claim.index;
    const account = claim.account.toLowerCase(); // Normalize address
    const amount =
      typeof claim.amount === "string" ? BigInt(claim.amount) : claim.amount;

    // Create packed data: address + address + uint256
    const packed = solidityPacked(
      ["uint256", "address", "uint256"],
      [index, account, amount]
    );

    // Hash the packed data
    const leaf = keccak256(packed);
    return Buffer.from(leaf.slice(2), "hex");
  });

  // Create Merkle tree
  const tree = new MerkleTree(leaves, keccak256, {
    hashLeaves: false, // Leaves are already hashed
    sortPairs: true, // Sort pairs for OpenZeppelin compatibility
  });

  // Get root
  const root = `0x${tree.getRoot().toString("hex")}`;

  return {
    tree,
    root,
    claims,
  };
}

/**
 * Get Merkle proof for a specific claim
 * @param treeData MerkleTreeData containing the tree and claims
 * @param claimIndex Index of the claim in the original claims array
 * @returns Array of proof hashes as hex strings
 */
export function generateMerkleProof(
  treeData: MerkleTreeData,
  claimIndex: number
): string[] {
  const claim = treeData.claims[claimIndex];
  if (!claim) {
    throw new Error(`Claim index ${claimIndex} not found`);
  }

  // Generate leaf for this claim
  const index = claim.index;
  const account = claim.account.toLowerCase();
  const amount =
    typeof claim.amount === "string" ? BigInt(claim.amount) : claim.amount;

  const packed = solidityPacked(
    ["uint256", "address", "uint256"],
    [index, account, amount]
  );
  const leaf = Buffer.from(keccak256(packed).slice(2), "hex");

  // Get proof
  const proof = treeData.tree.getProof(leaf);
  return proof.map((p) => `0x${p.data.toString("hex")}`);
}

/**
 * Verify a Merkle proof
 * @param root Merkle root
 * @param leaf Leaf hash
 * @param proof Array of proof hashes
 * @returns True if proof is valid
 */
export function verifyMerkleProof(
  root: string,
  leaf: string,
  proof: string[]
): boolean {
  const leafBuffer = Buffer.from(leaf.slice(2), "hex");
  const proofBuffers = proof.map((p) => Buffer.from(p.slice(2), "hex"));
  const rootBuffer = Buffer.from(root.slice(2), "hex");

  return MerkleTree.verify(proofBuffers, leafBuffer, rootBuffer, keccak256, {
    sortPairs: true,
  });
}

/**
 * Calculate Merkle root from claims (without creating full tree)
 * @param claims Array of claim data
 * @returns Merkle root as hex string
 */
export function calculateMerkleRoot(claims: ClaimData[]): string {
  const { root } = generateMerkleTree(claims);
  return root;
}

/**
 * Generate leaf hash for a claim (matches contract's leaf format)
 * @param index Claim index
 * @param account Account address
 * @param amount Claim amount
 * @returns Leaf hash as hex string
 */
export function generateLeafHash(
  index: number,
  account: string,
  amount: bigint | string
): string {
  const accountNormalized = account.toLowerCase();
  const amountBigInt = typeof amount === "string" ? BigInt(amount) : amount;

  const packed = solidityPacked(
    ["uint256", "address", "uint256"],
    [index, accountNormalized, amountBigInt]
  );

  return keccak256(packed);
}
