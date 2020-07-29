const yatm = require("..");
const ethers = require("ethers");

const { expectGtBN, expectEqBN, PROVIDER_URL } = require("./common");
const { abi, bytecode } = require("./contracts/StateMachine.json");

const provider = new ethers.providers.JsonRpcProvider(PROVIDER_URL);
const signer = provider.getSigner();

let signerAddress;
let StateMachine;
let IStateMachine;

beforeAll(async function () {
  // Gets signer address
  signerAddress = await signer.getAddress();

  // Deploys the token contract and gets related interface
  const tokenFactory = new ethers.ContractFactory(abi, bytecode, signer);
  StateMachine = await tokenFactory.deploy();
  const { transactionHash } = await StateMachine.deployTransaction.wait();

  // Waits for 2 confirmations
  await provider.waitForTransaction(transactionHash, 2, 120000);
  IStateMachine = StateMachine.interface;
});

test("simple override", async function () {
  const nonce = await provider.getTransactionCount(signerAddress);
  const initialGasPrice = yatm.toGwei(1);

  const transaction = {
    from: signerAddress,
    to: signerAddress,
    data: "0x",
    nonce,
    gasLimit: 21000,
    gasPrice: initialGasPrice,
  };

  // Ignore if transaction fails
  signer.sendTransaction(transaction).catch(() => {});

  // Send a bunch of transactions to override and overprice previous tx
  const tx = await yatm(PROVIDER_URL).send({
    transaction,
    sendTransactionFunction: (tx) => signer.sendTransaction(tx),
    minGasPrice: initialGasPrice + yatm.toGwei(1),
    maxGasPrice: yatm.toGwei(50),
    gasPriceScalingFunction: yatm.LINEAR(1),
    delay: 1000,
  });
  const { transactionHash } = await tx.wait();

  await provider.waitForTransaction(transactionHash, 2, 120000);

  const { gasPrice } = await provider.getTransaction(transactionHash);

  // Make sure the final gasPrice is > minGasPrice
  expectGtBN(gasPrice, ethers.BigNumber.from(initialGasPrice));
});

test("contract data override", async function () {
  const nonce = await provider.getTransactionCount(signerAddress);

  const initialGasPrice = yatm.toGwei(1);
  const initialState = ethers.utils.parseEther("10");
  const initialData = IStateMachine.encodeFunctionData("setState", [
    initialState,
  ]);

  const overrideState = ethers.utils.parseEther("100");
  const overrideData = IStateMachine.encodeFunctionData("setState", [
    overrideState,
  ]);

  const initialTransaction = {
    from: signerAddress,
    to: StateMachine.address,
    data: initialData,
    nonce,
    gasLimit: 100000,
    gasPrice: initialGasPrice,
  };

  // Ignore if transaction fails
  signer.sendTransaction(initialTransaction).catch(() => {});

  const tx = await yatm(PROVIDER_URL).send({
    transaction: { ...initialTransaction, data: overrideData },
    sendTransactionFunction: (tx) => signer.sendTransaction(tx),
    minGasPrice: initialGasPrice + yatm.toGwei(1),
    maxGasPrice: yatm.toGwei(50),
    gasPriceScalingFunction: yatm.LINEAR(1),
    delay: 1000,
  });
  const { transactionHash } = await tx.wait();

  await provider.waitForTransaction(transactionHash, 2, 120000);

  const finalState = await StateMachine.state();
  expectEqBN(finalState, overrideState);
});
