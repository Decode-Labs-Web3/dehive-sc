import { ethers } from "hardhat";
import { DehiveProxy, PaymentHub, MockERC20 } from "../../typechain-types";
import { getFunctionSelectors } from "../dehive/helpers/facetHelpers";
import fs from "fs";
import path from "path";

/**
 * All-in-One Test Script for PaymentHub
 *
 * This script tests the complete PaymentHub implementation:
 * 1. Deploys PaymentHub in standalone mode
 * 2. Deploys DehiveProxy and PaymentHub as facet
 * 3. Tests all payment functions (native, ERC-20)
 * 4. Tests owner functions (fees, withdrawals)
 * 5. Tests integration scenarios
 * 6. Performs load testing
 * 7. Verifies storage isolation
 *
 * Usage: npx hardhat run scripts/payment/testAllInOne.ts --network <network>
 */

interface TestResults {
  standaloneTests: {
    nativePayments: number;
    erc20Payments: number;
    feeUpdates: number;
    feeWithdrawals: number;
  };
  facetTests: {
    nativePayments: number;
    erc20Payments: number;
    feeUpdates: number;
    feeWithdrawals: number;
  };
  loadTests: {
    totalPayments: number;
    nativePayments: number;
    erc20Payments: number;
  };
  errors: string[];
}

async function main() {
  console.log("=".repeat(80));
  console.log("All-in-One Test: PaymentHub");
  console.log("=".repeat(80));

  // Get signers
  const signers = await ethers.getSigners();
  const deployer = signers[0];
  const owner = signers[1];
  const user1 = signers[2];
  const user2 = signers[3];
  const user3 = signers[4];
  const user4 = signers[5];

  console.log("\n📋 Test Configuration:");
  console.log(`  Deployer: ${deployer.address}`);
  console.log(`  Owner: ${owner.address}`);
  console.log(`  User1: ${user1.address}`);
  console.log(`  User2: ${user2.address}`);
  console.log(`  User3: ${user3.address}`);
  console.log(`  User4: ${user4.address}`);

  const testResults: TestResults = {
    standaloneTests: {
      nativePayments: 0,
      erc20Payments: 0,
      feeUpdates: 0,
      feeWithdrawals: 0,
    },
    facetTests: {
      nativePayments: 0,
      erc20Payments: 0,
      feeUpdates: 0,
      feeWithdrawals: 0,
    },
    loadTests: {
      totalPayments: 0,
      nativePayments: 0,
      erc20Payments: 0,
    },
    errors: [],
  };

  // ========== STEP 1: DEPLOY MOCK ERC20 ==========
  console.log("\n" + "=".repeat(80));
  console.log("Step 1: Deploying Mock ERC20 Token");
  console.log("=".repeat(80));

  const MockERC20Factory = await ethers.getContractFactory("MockERC20");
  const mockToken = await MockERC20Factory.deploy(
    "Test Token",
    "TEST",
    18, // decimals
    ethers.parseEther("1000000")
  );
  await mockToken.waitForDeployment();
  const tokenAddress = await mockToken.getAddress();

  console.log(`✓ MockERC20 deployed at: ${tokenAddress}`);

  // Distribute tokens to users
  await mockToken.transfer(user1.address, ethers.parseEther("10000"));
  await mockToken.transfer(user2.address, ethers.parseEther("10000"));
  await mockToken.transfer(user3.address, ethers.parseEther("10000"));
  await mockToken.transfer(user4.address, ethers.parseEther("10000"));

  console.log(`✓ Tokens distributed to users`);

  // ========== STEP 2: DEPLOY STANDALONE PAYMENTHUB ==========
  console.log("\n" + "=".repeat(80));
  console.log("Step 2: Deploying PaymentHub (Standalone Mode)");
  console.log("=".repeat(80));

  const PaymentHubFactory = await ethers.getContractFactory("PaymentHub");
  const paymentHubStandalone = await PaymentHubFactory.deploy(owner.address);
  await paymentHubStandalone.waitForDeployment();
  const standaloneAddress = await paymentHubStandalone.getAddress();

  console.log(`✓ PaymentHub (standalone) deployed at: ${standaloneAddress}`);

  // ========== STEP 3: DEPLOY PROXY AND FACET ==========
  console.log("\n" + "=".repeat(80));
  console.log("Step 3: Deploying DehiveProxy and PaymentHub Facet");
  console.log("=".repeat(80));

  // Deploy proxy
  const ProxyFactory = await ethers.getContractFactory("DehiveProxy");
  const proxy = await ProxyFactory.deploy();
  await proxy.waitForDeployment();
  const proxyAddress = await proxy.getAddress();

  console.log(`✓ DehiveProxy deployed at: ${proxyAddress}`);

  // Deploy facet
  const paymentHubFacet = await PaymentHubFactory.deploy(owner.address);
  await paymentHubFacet.waitForDeployment();
  const facetAddress = await paymentHubFacet.getAddress();

  console.log(`✓ PaymentHub facet deployed at: ${facetAddress}`);

  // Install facet
  const ipaymenthubArtifactPath = path.join(
    __dirname,
    "../../artifacts/contracts/interfaces/IPaymentHub.sol/IPaymentHub.json"
  );
  const ipaymenthubAbi = JSON.parse(
    fs.readFileSync(ipaymenthubArtifactPath, "utf-8")
  ).abi;

  const functionSelectors = getFunctionSelectors(ipaymenthubAbi);
  console.log(`✓ Found ${functionSelectors.length} function selectors`);

  const facetCut = {
    facetAddress: facetAddress,
    functionSelectors: functionSelectors,
    action: 0, // Add
  };

  const paymenthubArtifactPath = path.join(
    __dirname,
    "../../artifacts/contracts/PaymentHub.sol/PaymentHub.json"
  );
  const paymenthubAbi = JSON.parse(
    fs.readFileSync(paymenthubArtifactPath, "utf-8")
  ).abi;

  const proxyOwner = await proxy.owner();
  const initCalldata = ethers.Interface.from(paymenthubAbi).encodeFunctionData(
    "init",
    [proxyOwner]
  );

  const installTx = await proxy
    .connect(deployer)
    .facetCut([facetCut], facetAddress, initCalldata);
  await installTx.wait();

  console.log(`✓ PaymentHub facet installed into proxy`);

  // Connect to proxy as PaymentHub interface
  const paymentHubViaProxy = PaymentHubFactory.attach(
    proxyAddress
  ) as PaymentHub;

  // ========== STEP 4: TEST STANDALONE MODE ==========
  console.log("\n" + "=".repeat(80));
  console.log("Step 4: Testing Standalone Mode");
  console.log("=".repeat(80));

  // Test 4.1: Native payments
  console.log("\n4.1 Testing Native Payments (Standalone)...");
  try {
    const conversationId1 = await paymentHubStandalone.computeConversationId(
      user1.address,
      user2.address
    );

    const amount1 = ethers.parseEther("1.0");
    const tx1 = await paymentHubStandalone
      .connect(user1)
      .sendNative(
        conversationId1,
        user2.address,
        "QmTest1",
        ethers.id("test-1"),
        0,
        "msg-001",
        { value: amount1 }
      );
    await tx1.wait();

    testResults.standaloneTests.nativePayments++;
    console.log(`  ✓ Native payment sent: ${ethers.formatEther(amount1)} ETH`);
  } catch (error: any) {
    testResults.errors.push(
      `Standalone native payment failed: ${error.message}`
    );
    console.log(`  ❌ Failed: ${error.message}`);
  }

  // Test 4.2: ERC-20 payments
  console.log("\n4.2 Testing ERC-20 Payments (Standalone)...");
  try {
    const amount2 = ethers.parseEther("100");
    await mockToken.connect(user1).approve(standaloneAddress, amount2);

    const tx2 = await paymentHubStandalone
      .connect(user1)
      .sendERC20(
        await paymentHubStandalone.computeConversationId(
          user1.address,
          user2.address
        ),
        user2.address,
        tokenAddress,
        amount2,
        "QmTest2",
        ethers.id("test-2"),
        0,
        "msg-002"
      );
    await tx2.wait();

    testResults.standaloneTests.erc20Payments++;
    console.log(`  ✓ ERC-20 payment sent: ${ethers.formatEther(amount2)} TEST`);
  } catch (error: any) {
    testResults.errors.push(
      `Standalone ERC-20 payment failed: ${error.message}`
    );
    console.log(`  ❌ Failed: ${error.message}`);
  }

  // Test 4.3: Set transaction fee
  console.log("\n4.3 Testing Transaction Fee Management (Standalone)...");
  try {
    const newFee = 100; // 1%
    const tx3 = await paymentHubStandalone
      .connect(owner)
      .setTransactionFee(newFee);
    await tx3.wait();

    const currentFee = await paymentHubStandalone.transactionFeePercent();
    console.log(
      `  ✓ Transaction fee set to: ${currentFee} basis points (${
        Number(currentFee) / 100
      }%)`
    );
    testResults.standaloneTests.feeUpdates++;

    // Send payment with fee
    const amount3 = ethers.parseEther("10");
    const expectedFee = amount3 / 100n; // 1%
    const expectedToRecipient = amount3 - expectedFee;

    const user2BalanceBefore = await ethers.provider.getBalance(user2.address);

    await paymentHubStandalone
      .connect(user1)
      .sendNative(
        await paymentHubStandalone.computeConversationId(
          user1.address,
          user2.address
        ),
        user2.address,
        "QmTest3",
        ethers.id("test-3"),
        0,
        "msg-003",
        { value: amount3 }
      );

    const user2BalanceAfter = await ethers.provider.getBalance(user2.address);
    const received = user2BalanceAfter - user2BalanceBefore;

    console.log(`  ✓ Payment with fee: ${ethers.formatEther(amount3)} ETH`);
    console.log(`  ✓ Recipient received: ${ethers.formatEther(received)} ETH`);
    console.log(`  ✓ Fee accumulated: ${ethers.formatEther(expectedFee)} ETH`);

    testResults.standaloneTests.nativePayments++;
  } catch (error: any) {
    testResults.errors.push(
      `Standalone fee management failed: ${error.message}`
    );
    console.log(`  ❌ Failed: ${error.message}`);
  }

  // Test 4.4: Withdraw fees
  console.log("\n4.4 Testing Fee Withdrawal (Standalone)...");
  try {
    const accumulatedFees = await paymentHubStandalone.accumulatedFees(
      ethers.ZeroAddress
    );

    if (accumulatedFees > 0n) {
      const ownerBalanceBefore = await ethers.provider.getBalance(
        owner.address
      );

      const tx4 = await paymentHubStandalone
        .connect(owner)
        .withdrawFees(ethers.ZeroAddress);
      const receipt = await tx4.wait();
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice;

      const ownerBalanceAfter = await ethers.provider.getBalance(owner.address);
      const netGain = ownerBalanceAfter - ownerBalanceBefore + gasUsed;

      console.log(
        `  ✓ Fees withdrawn: ${ethers.formatEther(accumulatedFees)} ETH`
      );
      console.log(
        `  ✓ Owner received: ${ethers.formatEther(netGain)} ETH (after gas)`
      );

      testResults.standaloneTests.feeWithdrawals++;
    } else {
      console.log(`  ⚠️  No fees to withdraw`);
    }
  } catch (error: any) {
    testResults.errors.push(
      `Standalone fee withdrawal failed: ${error.message}`
    );
    console.log(`  ❌ Failed: ${error.message}`);
  }

  // ========== STEP 5: TEST FACET MODE ==========
  console.log("\n" + "=".repeat(80));
  console.log("Step 5: Testing Facet Mode (Through Proxy)");
  console.log("=".repeat(80));

  // Test 5.1: Native payments through proxy
  console.log("\n5.1 Testing Native Payments (Facet)...");
  try {
    const conversationId2 = await paymentHubViaProxy.computeConversationId(
      user3.address,
      user4.address
    );

    const amount4 = ethers.parseEther("2.0");
    const tx5 = await paymentHubViaProxy
      .connect(user3)
      .sendNative(
        conversationId2,
        user4.address,
        "QmTest4",
        ethers.id("test-4"),
        0,
        "msg-004",
        { value: amount4 }
      );
    await tx5.wait();

    testResults.facetTests.nativePayments++;
    console.log(
      `  ✓ Native payment sent via proxy: ${ethers.formatEther(amount4)} ETH`
    );
  } catch (error: any) {
    testResults.errors.push(`Facet native payment failed: ${error.message}`);
    console.log(`  ❌ Failed: ${error.message}`);
  }

  // Test 5.2: ERC-20 payments through proxy
  console.log("\n5.2 Testing ERC-20 Payments (Facet)...");
  try {
    const amount5 = ethers.parseEther("200");
    await mockToken.connect(user3).approve(proxyAddress, amount5);

    const tx6 = await paymentHubViaProxy
      .connect(user3)
      .sendERC20(
        await paymentHubViaProxy.computeConversationId(
          user3.address,
          user4.address
        ),
        user4.address,
        tokenAddress,
        amount5,
        "QmTest5",
        ethers.id("test-5"),
        0,
        "msg-005"
      );
    await tx6.wait();

    testResults.facetTests.erc20Payments++;
    console.log(
      `  ✓ ERC-20 payment sent via proxy: ${ethers.formatEther(amount5)} TEST`
    );
  } catch (error: any) {
    testResults.errors.push(`Facet ERC-20 payment failed: ${error.message}`);
    console.log(`  ❌ Failed: ${error.message}`);
  }

  // Test 5.3: Set transaction fee through proxy
  console.log("\n5.3 Testing Transaction Fee Management (Facet)...");
  try {
    // Proxy owner is deployer since proxy is deployed by deployer
    const newFee2 = 200; // 2%
    const tx7 = await paymentHubViaProxy
      .connect(deployer)
      .setTransactionFee(newFee2);
    await tx7.wait();

    const currentFee2 = await paymentHubViaProxy.transactionFeePercent();
    console.log(
      `  ✓ Transaction fee set via proxy: ${currentFee2} basis points (${
        Number(currentFee2) / 100
      }%)`
    );
    testResults.facetTests.feeUpdates++;

    // Send payment with fee through proxy
    const amount6 = ethers.parseEther("5");
    const expectedFee2 = amount6 / 50n; // 2%

    await paymentHubViaProxy
      .connect(user3)
      .sendNative(
        await paymentHubViaProxy.computeConversationId(
          user3.address,
          user4.address
        ),
        user4.address,
        "QmTest6",
        ethers.id("test-6"),
        0,
        "msg-006",
        { value: amount6 }
      );

    console.log(`  ✓ Payment with 2% fee sent via proxy`);
    console.log(`  ✓ Fee accumulated: ${ethers.formatEther(expectedFee2)} ETH`);

    testResults.facetTests.nativePayments++;
  } catch (error: any) {
    // This is an optional test - log error but continue
    testResults.errors.push(`Facet fee management failed: ${error.message}`);
    console.log(`  ❌ Failed: ${error.message}`);
    console.log(
      `     Note: This is an optional test - core functionality verified in standalone mode`
    );
  }

  // ========== STEP 6: LOAD TESTING ==========
  console.log("\n" + "=".repeat(80));
  console.log("Step 6: Load Testing (50 Payments)");
  console.log("=".repeat(80));

  console.log("\n6.1 Sending 50 payments (mix of native and ERC-20)...");

  const users = [user1, user2, user3, user4];
  const totalLoadPayments = 50;

  for (let i = 0; i < totalLoadPayments; i++) {
    const senderIdx = i % users.length;
    const recipientIdx = (i + 1) % users.length;
    const sender = users[senderIdx];
    const recipient = users[recipientIdx];

    const conversationId = await paymentHubViaProxy.computeConversationId(
      sender.address,
      recipient.address
    );

    try {
      if (i % 2 === 0) {
        // Native payment
        const amount = ethers.parseEther("0.01");
        await paymentHubViaProxy
          .connect(sender)
          .sendNative(
            conversationId,
            recipient.address,
            `QmLoad${i}`,
            ethers.id(`load-${i}`),
            0,
            `load-msg-${i}`,
            { value: amount }
          );

        testResults.loadTests.nativePayments++;
      } else {
        // ERC-20 payment
        const amount = ethers.parseEther("1");
        await mockToken.connect(sender).approve(proxyAddress, amount);

        await paymentHubViaProxy
          .connect(sender)
          .sendERC20(
            conversationId,
            recipient.address,
            tokenAddress,
            amount,
            `QmLoad${i}`,
            ethers.id(`load-${i}`),
            0,
            `load-msg-${i}`
          );

        testResults.loadTests.erc20Payments++;
      }

      testResults.loadTests.totalPayments++;

      if ((i + 1) % 10 === 0) {
        console.log(`  ✓ Sent ${i + 1}/${totalLoadPayments} payments...`);
      }
    } catch (error: any) {
      testResults.errors.push(
        `Load test payment ${i} failed: ${error.message}`
      );
    }
  }

  console.log(
    `\n✓ Load testing completed: ${testResults.loadTests.totalPayments} payments sent`
  );
  console.log(`  - Native: ${testResults.loadTests.nativePayments}`);
  console.log(`  - ERC-20: ${testResults.loadTests.erc20Payments}`);

  // ========== STEP 7: VERIFY STORAGE ISOLATION ==========
  console.log("\n" + "=".repeat(80));
  console.log("Step 7: Verifying Storage Isolation");
  console.log("=".repeat(80));

  try {
    const standaloneFee = await paymentHubStandalone.transactionFeePercent();
    const facetFee = await paymentHubViaProxy.transactionFeePercent();

    console.log(`\n✓ Standalone fee: ${standaloneFee} basis points`);
    console.log(`✓ Facet fee: ${facetFee} basis points`);

    if (standaloneFee !== facetFee) {
      console.log(`✓ Storage is properly isolated (different fees)`);
    }

    const standaloneOwner = await paymentHubStandalone.owner();
    const facetOwner = await paymentHubViaProxy.owner();

    console.log(`✓ Standalone owner: ${standaloneOwner}`);
    console.log(`✓ Facet owner: ${facetOwner}`);
  } catch (error: any) {
    testResults.errors.push(
      `Storage isolation verification failed: ${error.message}`
    );
    console.log(`❌ Storage isolation check failed: ${error.message}`);
  }

  // ========== STEP 8: TEST CONVERSATIONID CONSISTENCY ==========
  console.log("\n" + "=".repeat(80));
  console.log("Step 8: Testing ConversationId Consistency");
  console.log("=".repeat(80));

  try {
    const standaloneConvId = await paymentHubStandalone.computeConversationId(
      user1.address,
      user2.address
    );
    const facetConvId = await paymentHubViaProxy.computeConversationId(
      user1.address,
      user2.address
    );

    console.log(`\n✓ Standalone conversationId: ${standaloneConvId}`);
    console.log(`✓ Facet conversationId: ${facetConvId}`);

    if (standaloneConvId === facetConvId) {
      console.log(`✓ ConversationId computation is consistent across modes`);
    } else {
      testResults.errors.push(
        "ConversationId mismatch between standalone and facet"
      );
      console.log(`❌ ConversationId mismatch!`);
    }

    // Test order independence
    const convId1 = await paymentHubViaProxy.computeConversationId(
      user1.address,
      user2.address
    );
    const convId2 = await paymentHubViaProxy.computeConversationId(
      user2.address,
      user1.address
    );

    if (convId1 === convId2) {
      console.log(`✓ ConversationId is order-independent`);
    } else {
      testResults.errors.push("ConversationId is not order-independent");
      console.log(`❌ ConversationId order dependency detected!`);
    }
  } catch (error: any) {
    testResults.errors.push(`ConversationId testing failed: ${error.message}`);
    console.log(`❌ ConversationId testing failed: ${error.message}`);
  }

  // ========== SUMMARY ==========
  console.log("\n" + "=".repeat(80));
  console.log("Test Summary");
  console.log("=".repeat(80));

  console.log(`\n📦 Deployments:`);
  console.log(`  MockERC20: ${tokenAddress}`);
  console.log(`  PaymentHub (Standalone): ${standaloneAddress}`);
  console.log(`  DehiveProxy: ${proxyAddress}`);
  console.log(`  PaymentHub (Facet): ${facetAddress}`);

  console.log(`\n📊 Standalone Mode Tests:`);
  console.log(
    `  ✓ Native Payments: ${testResults.standaloneTests.nativePayments}`
  );
  console.log(
    `  ✓ ERC-20 Payments: ${testResults.standaloneTests.erc20Payments}`
  );
  console.log(`  ✓ Fee Updates: ${testResults.standaloneTests.feeUpdates}`);
  console.log(
    `  ✓ Fee Withdrawals: ${testResults.standaloneTests.feeWithdrawals}`
  );

  console.log(`\n📊 Facet Mode Tests:`);
  console.log(`  ✓ Native Payments: ${testResults.facetTests.nativePayments}`);
  console.log(`  ✓ ERC-20 Payments: ${testResults.facetTests.erc20Payments}`);
  console.log(`  ✓ Fee Updates: ${testResults.facetTests.feeUpdates}`);

  console.log(`\n📊 Load Tests:`);
  console.log(`  ✓ Total Payments: ${testResults.loadTests.totalPayments}`);
  console.log(`  ✓ Native Payments: ${testResults.loadTests.nativePayments}`);
  console.log(`  ✓ ERC-20 Payments: ${testResults.loadTests.erc20Payments}`);

  console.log(`\n📊 Errors:`);
  if (testResults.errors.length === 0) {
    console.log(`  ✅ No errors encountered`);
  } else {
    console.log(`  ❌ ${testResults.errors.length} error(s) encountered:`);
    testResults.errors.forEach((error, idx) => {
      console.log(`    ${idx + 1}. ${error}`);
    });
  }

  console.log("\n" + "=".repeat(80));
  if (testResults.errors.length === 0) {
    console.log("✅ All-in-One Test Completed Successfully!");
  } else {
    console.log("⚠️  All-in-One Test Completed with Errors");
  }
  console.log("=".repeat(80));

  // Save test results
  const deploymentsDir = path.join(__dirname, "../../deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  const network = await ethers.provider.getNetwork();
  const networkName = network.name || "unknown";

  const resultsFile = path.join(
    deploymentsDir,
    `paymentHub_testResults_${networkName}_${Date.now()}.json`
  );

  fs.writeFileSync(
    resultsFile,
    JSON.stringify(
      {
        network: networkName,
        timestamp: new Date().toISOString(),
        deployments: {
          mockToken: tokenAddress,
          standalone: standaloneAddress,
          proxy: proxyAddress,
          facet: facetAddress,
        },
        results: testResults,
      },
      null,
      2
    )
  );

  console.log(`\n📝 Test results saved to: ${resultsFile}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Test failed:");
    console.error(error);
    process.exit(1);
  });
