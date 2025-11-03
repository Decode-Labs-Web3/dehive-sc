# Dehive Airdrop Subgraph - Query Guide

## Endpoint

```
https://api.studio.thegraph.com/query/1713799/dehive-airdrop/version/latest
```

## Authentication

Include the authorization header:
```
Authorization: Bearer 112c016bdd600a7de3fa8e9379471bf2
```

## Important: Querying by serverId

⚠️ **Note**: `serverId` is an **indexed string** in the Solidity events, which means it's stored as a **keccak256 hash** (bytes32) in the subgraph.

To query by `serverId`, you need to:
1. Hash your serverId string using keccak256
2. Use the hash (as a hex string with `0x` prefix) in your query

**Example in JavaScript:**
```javascript
import { keccak256, toUtf8Bytes } from 'ethers';

const serverIdString = "your-server-id";
const serverIdHash = keccak256(toUtf8Bytes(serverIdString));
// Use serverIdHash in the query
```

## Query Examples

### 1. Get All Data by Server ID (Recommended)

This query fetches all campaigns for a specific server, including their claims.
**Note**: `$serverId` should be the keccak256 hash of your serverId string (as a hex string with `0x` prefix).

```graphql
query GetServerCampaigns($serverId: Bytes!) {
  campaigns(where: { serverId: $serverId }) {
    id
    factory {
      id
      serverId
      owner
      creator
    }
    serverId
    creator
    token
    merkleRoot
    metadataURI
    totalAmount
    claimedAmount
    createdAt
    blockNumber
    claims(orderBy: blockTimestamp, orderDirection: desc) {
      id
      user
      index
      amount
      blockNumber
      blockTimestamp
      transactionHash
    }
  }
}
```

**cURL Example (with hashed serverId):**
```bash
# First, hash your serverId string (example using JavaScript/Node.js):
# const { keccak256 } = require('ethers');
# const serverIdHash = keccak256(Buffer.from('your-server-id'));

curl -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer 112c016bdd600a7de3fa8e9379471bf2" \
  -d '{
    "query": "query GetServerCampaigns($serverId: Bytes!) { campaigns(where: { serverId: $serverId }) { id factory { id serverId owner creator } serverId creator token merkleRoot metadataURI totalAmount claimedAmount createdAt blockNumber claims(orderBy: blockTimestamp, orderDirection: desc) { id user index amount blockNumber blockTimestamp transactionHash } } }",
    "variables": {
      "serverId": "0x..."
    },
    "operationName": "GetServerCampaigns"
  }' \
  https://api.studio.thegraph.com/query/1713799/dehive-airdrop/version/latest
```

### 2. Get Factory and Campaigns by Server ID

This query fetches the factory first, then all its campaigns.
**Note**: `$serverId` should be the keccak256 hash (as hex string with `0x` prefix).

```graphql
query GetFactoryByServerId($serverId: Bytes!) {
  factories(where: { serverId: $serverId }) {
    id
    serverId
    owner
    creator
    createdAt
    blockNumber
    campaigns {
      id
      creator
      token
      merkleRoot
      metadataURI
      totalAmount
      claimedAmount
      createdAt
      blockNumber
      claims {
        id
        user
        index
        amount
        blockTimestamp
        transactionHash
      }
    }
  }
}
```

**cURL Example:**
```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer 112c016bdd600a7de3fa8e9379471bf2" \
  -d '{
    "query": "query GetFactoryByServerId($serverId: Bytes!) { factories(where: { serverId: $serverId }) { id serverId owner creator createdAt blockNumber campaigns { id creator token merkleRoot metadataURI totalAmount claimedAmount createdAt blockNumber claims { id user index amount blockTimestamp transactionHash } } } }",
    "variables": {
      "serverId": "0x..."
    },
    "operationName": "GetFactoryByServerId"
  }' \
  https://api.studio.thegraph.com/query/1713799/dehive-airdrop/version/latest
```

### 3. Get Campaigns by Server ID (Simple - No Claims)

If you only need campaign information without claim details.
**Note**: `$serverId` should be the keccak256 hash (as hex string with `0x` prefix).

```graphql
query GetServerCampaignsSimple($serverId: Bytes!) {
  campaigns(where: { serverId: $serverId }) {
    id
    factory {
      id
      serverId
    }
    serverId
    creator
    token
    metadataURI
    totalAmount
    claimedAmount
    createdAt
  }
}
```

**cURL Example:**
```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer 112c016bdd600a7de3fa8e9379471bf2" \
  -d '{
    "query": "query GetServerCampaignsSimple($serverId: Bytes!) { campaigns(where: { serverId: $serverId }) { id factory { id serverId } serverId creator token metadataURI totalAmount claimedAmount createdAt } }",
    "variables": {
      "serverId": "0x..."
    },
    "operationName": "GetServerCampaignsSimple"
  }' \
  https://api.studio.thegraph.com/query/1713799/dehive-airdrop/version/latest
```

### 4. Get Claims for a Specific User in a Server

Get all claims made by a specific user across all campaigns in a server.
**Note**: `$serverId` should be the keccak256 hash (as hex string with `0x` prefix).

```graphql
query GetUserClaimsInServer($serverId: Bytes!, $user: Bytes!) {
  campaigns(where: { serverId: $serverId }) {
    id
    token
    totalAmount
    claims(where: { user: $user }) {
      id
      user
      index
      amount
      blockTimestamp
      transactionHash
    }
  }
}
```

**cURL Example:**
```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer 112c016bdd600a7de3fa8e9379471bf2" \
  -d '{
    "query": "query GetUserClaimsInServer($serverId: Bytes!, $user: Bytes!) { campaigns(where: { serverId: $serverId }) { id token totalAmount claims(where: { user: $user }) { id user index amount blockTimestamp transactionHash } } }",
    "variables": {
      "serverId": "0x...",
      "user": "0x..."
    },
    "operationName": "GetUserClaimsInServer"
  }' \
  https://api.studio.thegraph.com/query/1713799/dehive-airdrop/version/latest
```

## JavaScript/TypeScript Example

```typescript
import { keccak256, toUtf8Bytes } from 'ethers';

async function getServerCampaigns(serverIdString: string) {
  // Hash the serverId string first
  const serverIdHash = keccak256(toUtf8Bytes(serverIdString));

  const query = `
    query GetServerCampaigns($serverId: Bytes!) {
      campaigns(where: { serverId: $serverId }) {
        id
        factory {
          id
          serverId
          owner
          creator
        }
        serverId
        creator
        token
        merkleRoot
        metadataURI
        totalAmount
        claimedAmount
        createdAt
        blockNumber
        claims(orderBy: blockTimestamp, orderDirection: desc) {
          id
          user
          index
          amount
          blockNumber
          blockTimestamp
          transactionHash
        }
      }
    }
  `;

  const response = await fetch(
    'https://api.studio.thegraph.com/query/1713799/dehive-airdrop/version/latest',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer 112c016bdd600a7de3fa8e9379471bf2',
      },
      body: JSON.stringify({
        query,
        variables: { serverId: serverIdHash },
        operationName: 'GetServerCampaigns',
      }),
    }
  );

  const data = await response.json();
  return data.data.campaigns;
}
```

## Notes

- ⚠️ **Important**: `serverId` in queries must be the **keccak256 hash** of your serverId string, not the original string
- Use `ethers.keccak256(ethers.toUtf8Bytes("your-server-id"))` to hash the string
- `serverId` fields in results will be returned as `Bytes` (hex strings)
- Replace `"0x..."` with actual hashed serverId or user address
- All `Bytes` fields (like `token`, `user`, `owner`, etc.) are returned as hex strings
- `BigInt` fields are returned as strings
- Use `orderBy` and `orderDirection` to sort claims by timestamp
- Use `first` and `skip` for pagination if needed
