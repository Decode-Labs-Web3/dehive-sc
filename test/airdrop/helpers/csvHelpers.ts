import * as fs from "fs";
import * as path from "path";
import { ethers } from "ethers";
import { ClaimData } from "./merkleHelpers";

/**
 * CSV Helper Utilities
 *
 * Utilities for parsing CSV files and converting to claim data format
 */

export interface CSVRow {
  address: string;
  amount: string;
}

/**
 * Parse an airdrop CSV file
 * @param filePath Path to CSV file (relative to project root or absolute)
 * @returns Array of CSV rows with address and amount
 */
export function parseAirdropCSV(filePath: string): CSVRow[] {
  // Resolve path (try relative to project root first)
  let resolvedPath = filePath;
  if (!path.isAbsolute(filePath)) {
    resolvedPath = path.join(process.cwd(), filePath);
  }

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`CSV file not found: ${resolvedPath}`);
  }

  const fileContent = fs.readFileSync(resolvedPath, "utf-8");
  const lines = fileContent.trim().split("\n");

  if (lines.length < 2) {
    throw new Error(`CSV file must have at least a header and one data row`);
  }

  // Skip header row
  const dataLines = lines.slice(1);

  const rows: CSVRow[] = [];
  for (const line of dataLines) {
    if (!line.trim()) continue; // Skip empty lines

    const [address, amount] = line.split(",").map((s) => s.trim());

    if (!address || !amount) {
      throw new Error(`Invalid CSV row: ${line}`);
    }

    // Validate and clean amount - remove any decimal point and everything after it
    // If it's a decimal like "100.0", convert to integer
    let cleanAmount = amount;
    if (amount.includes(".")) {
      const parts = amount.split(".");
      cleanAmount = parts[0]; // Take only the integer part
      if (!cleanAmount) {
        throw new Error(
          `Invalid amount in CSV row: ${line} - cannot convert decimal to integer`
        );
      }
    }

    rows.push({
      address: address.toLowerCase(), // Normalize address
      amount: cleanAmount,
    });
  }

  return rows;
}

/**
 * Convert CSV rows to ClaimData format
 * @param csvRows Array of CSV rows
 * @param startIndex Starting index for claims (default: 0)
 * @returns Array of ClaimData with index, account, and amount
 */
export function convertToClaims(
  csvRows: CSVRow[],
  startIndex: number = 0
): ClaimData[] {
  return csvRows.map((row, i) => ({
    index: startIndex + i,
    account: row.address,
    amount: BigInt(row.amount), // Convert to BigInt
  }));
}

/**
 * Load claims from a CSV file
 * @param filePath Path to CSV file
 * @param startIndex Starting index for claims (default: 0)
 * @returns Array of ClaimData
 */
export function loadCSVClaims(
  filePath: string,
  startIndex: number = 0
): ClaimData[] {
  const csvRows = parseAirdropCSV(filePath);
  return convertToClaims(csvRows, startIndex);
}

/**
 * Get total amount from CSV claims
 * @param claims Array of ClaimData
 * @returns Total amount as BigInt
 */
export function getTotalAmount(claims: ClaimData[]): bigint {
  return claims.reduce((sum, claim) => {
    const amount =
      typeof claim.amount === "string" ? BigInt(claim.amount) : claim.amount;
    return sum + amount;
  }, BigInt(0));
}

/**
 * Create a test CSV file with random data
 * @param filePath Path where to save the CSV
 * @param addresses Array of addresses
 * @param amounts Array of amounts (or random if not provided)
 * @returns Path to created file
 */
export function createTestCSV(
  filePath: string,
  addresses: string[],
  amounts?: string[]
): string {
  const csvContent = [
    "address,amount",
    ...addresses.map((addr, i) => {
      const amount = amounts
        ? amounts[i]
        : Math.floor(Math.random() * 10000).toString();
      return `${addr},${amount}`;
    }),
  ].join("\n");

  fs.writeFileSync(filePath, csvContent, "utf-8");
  return filePath;
}
