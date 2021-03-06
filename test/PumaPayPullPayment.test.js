import {
    calcSignedMessageForRegistration,
    calcSignedMessageForDeletion,
    getVRS
} from './helpers/signatureCalculator';
import assertRevert from './helpers/assertRevert';
import { timeTravel, currentBlockTime } from './helpers/timeHelper'
import Web3 from 'web3';

const PumaPayToken = artifacts.require('PumaPayToken');
const PumaPayPullPayment = artifacts.require('PumaPayPullPayment');
const BigNumber = web3.BigNumber;
const web3API = new Web3(new Web3.providers.HttpProvider('http://localhost:7545'));

require('chai')
    .use(require('chai-as-promised'))
    .use(require('chai-bignumber')(BigNumber))
    .should();

const MINUTE = 60; // 60 seconds
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const YEAR = 365 * DAY;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const ONE_ETHER = web3.toWei("1", 'ether');
const MINTED_TOKENS = 1000000000 * ONE_ETHER; // 1 Billion PMA
const EUR_EXCHANGE_RATE = 100000000; // 0.01 * 1^10
const USD_EXCHANGE_RATE = 200000000; // 0.02 * 1^10

const CLIENT_ONE_PRIVATE_KEY = '0xbebca8c785dff420b4a0b0c4c61e262b380f34e6ee4789044050ef8bca4bf821';
const CLIENT_TWO_PRIVATE_KEY = '0x6618238d98d6cddf9764a73a046474cbc24373a16acc09b66ca911455b6d3111';
const CLIENT_THREE_PRIVATE_KEY = '0xe2e00d88c4f66daf29875c6b23702631db4cab46034041ceee39617f8fcf5e49';

contract('PumaPay Pull Payment Contract', async (accounts) => {
    const deployerAccount = accounts[0];    // 0xe689c075c808404C9A0d84bE10d2E960CC61c497
    const owner = accounts[1];              // 0x853C292e80e2ba1f93F33Af6046C3A0B2EaE47Dc
    const executorOne = accounts[2];        // 0xf52DBA6fe86D2f80c13F2e2565F521Ad0C18Efc0
    const executorTwo = accounts[3];        // 0x8CB728587175968B3616758FD0a528D057dFc336
    const beneficiaryOne = accounts[4];     // 0x3D76b36e4F76D7220001F21Cf0C70F2fb5799e6b
    const beneficiaryTwo = accounts[5];     // 0x5252055feEf476DBc6Ef32eF58Fd324b988F13B2
    const beneficiaryThree = accounts[6];   // 0xAaeDDcD2c5c96dF8Fc4297333f66b4Ea61fc3ab3
    const clientOne = accounts[7];          // 0xb2F990cCC50Da372307b080501BfA4703c1C499B
    const clientTwo = accounts[8];          // 0x34bfe2E8cbec8d0263Cd24c67166022C2D350614
    const clientThree = accounts[9];        // 0xc4771Be5D994847bE5B846E7126A0F73c6A0B144

    let singlePullPayment = {
        merchantID: "merchantID_1",
        paymentID: "paymentID_1",
        client: clientOne,
        beneficiary: beneficiaryOne,
        currency: 'EUR',
        initialPaymentAmountInCents: 0,
        fiatAmountInCents: 100000000000000, // 1 trillion in EUR cents
        frequency: 1,
        numberOfPayments: 1,
        startTimestamp: Math.floor(Date.now() / 1000) + DAY
    };

    let recurringPullPayment = {
        merchantID: "merchantID_2",
        paymentID: "paymentID_2",
        client: clientTwo,
        beneficiary: beneficiaryTwo,
        currency: 'USD',
        initialPaymentAmountInCents: 0,
        fiatAmountInCents: 200, // 2.00 USD in cents
        frequency: 2 * DAY,
        numberOfPayments: 10,
        startTimestamp: Math.floor(Date.now() / 1000) + DAY
    };

    let recurringPullPaymentWithInitialAmount = {
        merchantID: "merchantID_3",
        paymentID: "paymentID_3",
        client: clientThree,
        beneficiary: beneficiaryThree,
        currency: 'USD',
        initialPaymentAmountInCents: 100,
        fiatAmountInCents: 200, // 2.00 USD in cents
        frequency: 2 * DAY,
        numberOfPayments: 10,
        startTimestamp: Math.floor(Date.now() / 1000) + 2 * DAY
    };

    let token;
    let pumaPayPullPayment;


    beforeEach('Deploying new PumaPayToken', async () => {
        token = await PumaPayToken.new({
            from: deployerAccount
        });
    });

    beforeEach('Deploying new PumaPay Pull Payment', async () => {
        pumaPayPullPayment = await PumaPayPullPayment
            .new(token.address, {
                from: owner
            });
    });

    beforeEach('Issue tokens to the clients', async () => {
        const tokens = MINTED_TOKENS;
        await token.mint(clientOne, tokens, {
            from: deployerAccount
        });
        await token.mint(clientTwo, tokens, {
            from: deployerAccount
        });
        await token.mint(clientThree, tokens, {
            from: deployerAccount
        });
    });

    beforeEach('Finish Minting', async () => {
        await token.finishMinting({
            from: deployerAccount
        });
    });

    beforeEach('set the rate for multiple fiat currencies', async () => {
        await pumaPayPullPayment.setRate('EUR', EUR_EXCHANGE_RATE, {
            from: owner
        });
        await pumaPayPullPayment.setRate('USD', USD_EXCHANGE_RATE, {
            from: owner
        });
    });

    const transferEthersToSmartContract = async (ethers, fromAccount, smartContract) => {
        await smartContract.sendTransaction(
            {
                from: fromAccount,
                value: ethers * ONE_ETHER
            }
        );
    }

    describe('Deploying', async () => {
        it('PumaPay Pull Payment owner should be the address that was specified on contract deployment', async () => {
            const accountOwner = await pumaPayPullPayment.owner();

            assert.equal(accountOwner.toString(), owner);
        });

        it('PumaPay Pull Payment token should be the token address specified on contract deployment', async () => {
            const accountToken = await pumaPayPullPayment.token();

            assert.equal(accountToken, token.address);
        });

        it('PumaPay Pull Payment deployment should revert when the token is a ZERO address', async () => {
            await assertRevert(PumaPayPullPayment
                .new(ZERO_ADDRESS, {
                    from: deployerAccount
                }));
        });
    });

    describe('Add executor', async () => {
        beforeEach('Transfer ETH to smart contract', async () => {
            await transferEthersToSmartContract(1, deployerAccount, pumaPayPullPayment);
        });

        it('should set the executor specified to true', async () => {
            await pumaPayPullPayment.addExecutor(executorOne, {
                from: owner
            });
            const executor = await pumaPayPullPayment.executors(executorOne);

            assert.equal(executor, true);
        });

        it('should transfer ETHER to the executor account for paying gas fees', async () => {
            ;
            const executorBalanceBefore = await web3API.eth.getBalance(executorOne);
            await pumaPayPullPayment.addExecutor(executorOne, {
                from: owner
            });
            const executorBalanceAfter = await web3API.eth.getBalance(executorOne);

            assert.equal(executorBalanceAfter - executorBalanceBefore, 1 * ONE_ETHER);
        });

        it('should revert when the executor is a ZERO address', async () => {
            await assertRevert(
                pumaPayPullPayment.addExecutor(ZERO_ADDRESS, {
                    from: owner
                })
            );
        });

        it('should revert when the adding the same executor', async () => {
            await pumaPayPullPayment.addExecutor(executorOne, {
                from: owner
            });
            await assertRevert(
                pumaPayPullPayment.addExecutor(executorOne, {
                    from: owner
                })
            );
        });

        it('should revert if NOT executed by the owner', async () => {
            await pumaPayPullPayment.addExecutor(executorOne, {
                from: owner
            });

            await assertRevert(
                pumaPayPullPayment.addExecutor(executorTwo, {
                    from: executorOne
                })
            );
        });
    });

    describe('Remove executor', async () => {
        beforeEach('Transfer ETH to smart contract', async () => {
            await transferEthersToSmartContract(1, deployerAccount, pumaPayPullPayment);
        });

        beforeEach('add an executor', async () => {
            await pumaPayPullPayment.addExecutor(executorOne, {
                from: owner
            });
        });

        it('should set the executor specified to false', async () => {
            await pumaPayPullPayment.removeExecutor(executorOne, {
                from: owner
            });
            const executor = await pumaPayPullPayment.executors(executorOne);

            assert.equal(executor, false);
        });

        it('should revert when the executor is a ZERO address', async () => {
            await assertRevert(
                pumaPayPullPayment.removeExecutor(ZERO_ADDRESS, {
                    from: owner
                })
            );
        });

        it('should revert when the executor does not exists', async () => {
            await assertRevert(
                pumaPayPullPayment.removeExecutor(executorTwo, {
                    from: owner
                })
            );
        });

        it('should revert if NOT executed by the owner', async () => {
            await assertRevert(
                pumaPayPullPayment.removeExecutor(executorTwo, {
                    from: executorOne
                })
            );
        });
    });

    describe('Set Rate', async () => {
        it('should set the rate for fiat currency', async () => {
            await pumaPayPullPayment.setRate('EUR', EUR_EXCHANGE_RATE * 10, {
                from: owner
            });
            const euroRate = await pumaPayPullPayment.getRate('EUR');

            euroRate.should.be.bignumber.equal(EUR_EXCHANGE_RATE * 10);
        });

        it('should set the rate for multiple fiat currencies', async () => {
            const euroRate = await pumaPayPullPayment.getRate('EUR');
            const usdRate = await pumaPayPullPayment.getRate('USD');

            euroRate.should.be.bignumber.equal(EUR_EXCHANGE_RATE);
            usdRate.should.be.bignumber.equal(USD_EXCHANGE_RATE);
        });

        it('should revert when not executed by the owner', async () => {
            await assertRevert(pumaPayPullPayment.setRate('EUR', EUR_EXCHANGE_RATE, {
                from: deployerAccount
            }));
        });

        it('should allow everyone to retrieve the rate', async () => {
            const usdRate = await pumaPayPullPayment.getRate('USD', {
                from: deployerAccount
            });

            usdRate.should.be.bignumber.equal(USD_EXCHANGE_RATE);
        });

        it('should emit a "LogSetExchangeRate" event', async () => {
            const setRate = await pumaPayPullPayment.setRate('EUR', EUR_EXCHANGE_RATE, {
                from: owner
            });
            const logs = setRate.logs;

            assert.equal(logs.length, 1);
            assert.equal(logs[0].event, 'LogSetExchangeRate');
            logs[0].args.currency.should.be.equal('EUR');
            logs[0].args.exchangeRate.should.be.bignumber.equal(EUR_EXCHANGE_RATE);
        });
    });

    describe('Register Pull Payment', async () => {
        beforeEach('Transfer ETH to smart contract', async () => {
            await transferEthersToSmartContract(1, deployerAccount, pumaPayPullPayment);
        });
        beforeEach('add executors', async () => {
            await pumaPayPullPayment.addExecutor(executorOne, {
                from: owner
            });
        });
        it('should add the pull payment for the beneficiary in the active payments array', async () => {
            const signature = await calcSignedMessageForRegistration(singlePullPayment, CLIENT_ONE_PRIVATE_KEY);
            const sigVRS = await getVRS(signature);

            await pumaPayPullPayment.registerPullPayment(
                sigVRS.v,
                sigVRS.r,
                sigVRS.s,
                singlePullPayment.merchantID,
                singlePullPayment.paymentID,
                singlePullPayment.client,
                singlePullPayment.beneficiary,
                singlePullPayment.currency,
                singlePullPayment.initialPaymentAmountInCents,
                singlePullPayment.fiatAmountInCents,
                singlePullPayment.frequency,
                singlePullPayment.numberOfPayments,
                singlePullPayment.startTimestamp,
                {
                    from: executorOne
                });

            const activePaymentInArray = await pumaPayPullPayment.pullPayments(clientOne, beneficiaryOne);

            activePaymentInArray[0].should.be.equal(singlePullPayment.merchantID); // MERCHANT ID
            activePaymentInArray[1].should.be.equal(singlePullPayment.paymentID); // PAYMENT ID
            activePaymentInArray[2].should.be.equal(singlePullPayment.currency); // CURRENCY
            activePaymentInArray[3].should.be.bignumber.equal(singlePullPayment.initialPaymentAmountInCents); // INITIAL AMOUNT 
            activePaymentInArray[4].should.be.bignumber.equal(singlePullPayment.fiatAmountInCents); // FIAT AMOUNT
            activePaymentInArray[5].should.be.bignumber.equal(singlePullPayment.frequency); // FREQUENCY
            activePaymentInArray[6].should.be.bignumber.equal(singlePullPayment.numberOfPayments); // NUMBER OF ALLOWED PULL PAYMENTS
            activePaymentInArray[7].should.be.bignumber.equal(singlePullPayment.startTimestamp); // START TIMESTAMP
            activePaymentInArray[8].should.be.bignumber.equal(singlePullPayment.startTimestamp); // NEXT PAYMENT TIMESTAMP = START TIMESTAMP
            activePaymentInArray[9].should.be.bignumber.equal(0); // LAST PAYMENT TIMESTAMP
            activePaymentInArray[10].should.be.bignumber.equal(0); // CANCEL PAYMENT TIMESTAMP
        });

        it('should revert when NOT executed an executor', async () => {
            const signature = await calcSignedMessageForRegistration(singlePullPayment, CLIENT_ONE_PRIVATE_KEY);
            const sigVRS = await getVRS(signature);

            await assertRevert(pumaPayPullPayment.registerPullPayment(
                sigVRS.v,
                sigVRS.r,
                sigVRS.s,
                singlePullPayment.merchantID,
                singlePullPayment.paymentID,
                singlePullPayment.client,
                singlePullPayment.beneficiary,
                singlePullPayment.currency,
                singlePullPayment.initialPaymentAmountInCents,
                singlePullPayment.fiatAmountInCents,
                singlePullPayment.frequency,
                singlePullPayment.numberOfPayments,
                singlePullPayment.startTimestamp,
                {
                    from: deployerAccount
                }));
        });

        it('should revert when the pull payment params does match with the ones signed by the signatory', async () => {
            const signature = await calcSignedMessageForRegistration(singlePullPayment, CLIENT_ONE_PRIVATE_KEY);
            const sigVRS = await getVRS(signature);

            await assertRevert(pumaPayPullPayment.registerPullPayment(
                sigVRS.v,
                sigVRS.r,
                sigVRS.s,
                recurringPullPayment.merchantID,
                recurringPullPayment.paymentID,
                recurringPullPayment.client,
                recurringPullPayment.beneficiary,
                recurringPullPayment.currency,
                recurringPullPayment.initialPaymentAmountInCents,
                recurringPullPayment.fiatAmountInCents,
                recurringPullPayment.frequency,
                recurringPullPayment.numberOfPayments,
                recurringPullPayment.startTimestamp,
                {
                    from: executorOne
                }));
        });


        it('should emit a "LogPaymentRegistered" event', async () => {
            const signature = await calcSignedMessageForRegistration(singlePullPayment, CLIENT_ONE_PRIVATE_KEY);
            const sigVRS = await getVRS(signature);

            const pumaPayPullPaymentRegistration = await pumaPayPullPayment.registerPullPayment(
                sigVRS.v,
                sigVRS.r,
                sigVRS.s,
                singlePullPayment.merchantID,
                singlePullPayment.paymentID,
                singlePullPayment.client,
                singlePullPayment.beneficiary,
                singlePullPayment.currency,
                singlePullPayment.initialPaymentAmountInCents,
                singlePullPayment.fiatAmountInCents,
                singlePullPayment.frequency,
                singlePullPayment.numberOfPayments,
                singlePullPayment.startTimestamp,
                {
                    from: executorOne
                });

            const logs = pumaPayPullPaymentRegistration.logs;

            assert.equal(logs.length, 1);
            assert.equal(logs[0].event, 'LogPaymentRegistered');
            logs[0].args.clientAddress.should.be.equal(singlePullPayment.client);
            logs[0].args.beneficiaryAddress.should.be.equal(singlePullPayment.beneficiary);
            logs[0].args.paymentID.should.be.equal(singlePullPayment.paymentID);
        });
    });

    describe('Delete Recurring Payment', async () => {
        beforeEach('Transfer ETH to smart contract', async () => {
            await transferEthersToSmartContract(2, deployerAccount, pumaPayPullPayment);
        });
        beforeEach('add executors', async () => {
            await pumaPayPullPayment.addExecutor(executorOne, {
                from: owner
            });
            await pumaPayPullPayment.addExecutor(executorTwo, {
                from: owner
            });
        });
        beforeEach('Add single pull payment', async () => {
            const signature = await calcSignedMessageForRegistration(singlePullPayment, CLIENT_ONE_PRIVATE_KEY);
            const sigVRS = await getVRS(signature);

            await pumaPayPullPayment.registerPullPayment(
                sigVRS.v,
                sigVRS.r,
                sigVRS.s,
                singlePullPayment.merchantID,
                singlePullPayment.paymentID,
                singlePullPayment.client,
                singlePullPayment.beneficiary,
                singlePullPayment.currency,
                singlePullPayment.initialPaymentAmountInCents,
                singlePullPayment.fiatAmountInCents,
                singlePullPayment.frequency,
                singlePullPayment.numberOfPayments,
                singlePullPayment.startTimestamp,
                {
                    from: executorOne
                });
        });

        beforeEach('Add recurring pull payment', async () => {
            const signature = await calcSignedMessageForRegistration(recurringPullPayment, CLIENT_TWO_PRIVATE_KEY);
            const sigVRS = await getVRS(signature);

            await pumaPayPullPayment.registerPullPayment(
                sigVRS.v,
                sigVRS.r,
                sigVRS.s,
                recurringPullPayment.merchantID,
                recurringPullPayment.paymentID,
                recurringPullPayment.client,
                recurringPullPayment.beneficiary,
                recurringPullPayment.currency,
                recurringPullPayment.initialPaymentAmountInCents,
                recurringPullPayment.fiatAmountInCents,
                recurringPullPayment.frequency,
                recurringPullPayment.numberOfPayments,
                recurringPullPayment.startTimestamp,
                {
                    from: executorTwo
                });
        });

        it('should set the cancel date of the pull payment for the beneficiaryOne to NOW', async () => {
            const signature = await calcSignedMessageForDeletion(singlePullPayment.paymentID, singlePullPayment.beneficiary, CLIENT_ONE_PRIVATE_KEY);
            const sigVRS = await getVRS(signature);

            await pumaPayPullPayment.deletePullPayment(
                sigVRS.v,
                sigVRS.r,
                sigVRS.s,
                singlePullPayment.paymentID,
                singlePullPayment.client,
                singlePullPayment.beneficiary, {
                    from: executorOne
                });
            const ethDate = await currentBlockTime();
            const activePaymentInArray = await pumaPayPullPayment.pullPayments(clientOne, beneficiaryOne);

            activePaymentInArray[10].should.be.bignumber.equal(ethDate); // CANCEL PAYMENT TIMESTAMP
        });

        it('should revert when NOT executed by an executor', async () => {
            const signature = await calcSignedMessageForDeletion(singlePullPayment.paymentID, beneficiaryOne, CLIENT_ONE_PRIVATE_KEY);
            const sigVRS = await getVRS(signature);

            await assertRevert(pumaPayPullPayment.deletePullPayment(
                sigVRS.v,
                sigVRS.r,
                sigVRS.s,
                singlePullPayment.paymentID,
                singlePullPayment.client,
                beneficiaryOne, {
                    from: owner
                }));
        });

        it('should revert when the payment for the beneficiary does not exists', async () => {
            const signature = await calcSignedMessageForDeletion(singlePullPayment.paymentID, beneficiaryOne, CLIENT_ONE_PRIVATE_KEY);
            const sigVRS = await getVRS(signature);

            await assertRevert(pumaPayPullPayment.deletePullPayment(
                sigVRS.v,
                sigVRS.r,
                sigVRS.s,
                singlePullPayment.paymentID,
                singlePullPayment.client,
                beneficiaryThree, {
                    from: executorOne
                }));
        });

        it('should revert when the deletion pull payment params does match with the ones signed by the signatory', async () => {
            const signature = await calcSignedMessageForDeletion(singlePullPayment.paymentID, beneficiaryOne, CLIENT_ONE_PRIVATE_KEY);
            const sigVRS = await getVRS(signature);

            await assertRevert(pumaPayPullPayment.deletePullPayment(
                sigVRS.v,
                sigVRS.r,
                sigVRS.s,
                singlePullPayment.paymentID,
                singlePullPayment.client,
                beneficiaryTwo, {
                    from: executorOne
                }));
        });

        it('should emit a "LogPaymentCancelled" event', async () => {
            const signature = await calcSignedMessageForDeletion(singlePullPayment.paymentID, beneficiaryOne, CLIENT_ONE_PRIVATE_KEY);
            const sigVRS = await getVRS(signature);

            const pumaPayPullPaymentDeletion = await pumaPayPullPayment.deletePullPayment(
                sigVRS.v,
                sigVRS.r,
                sigVRS.s,
                singlePullPayment.paymentID,
                singlePullPayment.client,
                beneficiaryOne, {
                    from: executorTwo
                });

            const logs = pumaPayPullPaymentDeletion.logs;

            assert.equal(logs.length, 1);
            assert.equal(logs[0].event, 'LogPaymentCancelled');
            logs[0].args.clientAddress.should.be.equal(singlePullPayment.client);
            logs[0].args.beneficiaryAddress.should.be.equal(singlePullPayment.beneficiary);
            logs[0].args.paymentID.should.be.equal(singlePullPayment.paymentID);
        });
    });

    describe('Execute Single Pull Payment', async () => {
        beforeEach('Transfer ETH to smart contract', async () => {
            await transferEthersToSmartContract(1, deployerAccount, pumaPayPullPayment);
        });
        beforeEach('add executors', async () => {
            await pumaPayPullPayment.addExecutor(executorTwo, {
                from: owner
            });
        });

        beforeEach('approve PumaPay Pull Payment  to transfer from first client\'s account ', async () => {
            await token.approve(pumaPayPullPayment.address, MINTED_TOKENS, {
                from: clientOne
            });
        });

        beforeEach('set simple pull payment details', async () => {
            const ethDate = await currentBlockTime();
            singlePullPayment = {
                merchantID: "merchantID_1",
                paymentID: "paymentID_1",
                client: clientOne,
                beneficiary: beneficiaryOne,
                currency: 'EUR',
                initialPaymentAmountInCents: 0,
                fiatAmountInCents: 1000, // 10.00 EUR in cents
                frequency: 1,
                numberOfPayments: 1,
                startTimestamp: ethDate + DAY
            };
        });

        beforeEach('Add single pull payment', async () => {
            const signature = await calcSignedMessageForRegistration(singlePullPayment, CLIENT_ONE_PRIVATE_KEY);
            const sigVRS = await getVRS(signature);

            await pumaPayPullPayment.registerPullPayment(
                sigVRS.v,
                sigVRS.r,
                sigVRS.s,
                singlePullPayment.merchantID,
                singlePullPayment.paymentID,
                singlePullPayment.client,
                singlePullPayment.beneficiary,
                singlePullPayment.currency,
                singlePullPayment.initialPaymentAmountInCents,
                singlePullPayment.fiatAmountInCents,
                singlePullPayment.frequency,
                singlePullPayment.numberOfPayments,
                singlePullPayment.startTimestamp,
                {
                    from: executorTwo
                });
        });

        it('should pull the amount specified on the payment details to the beneficiaryOne', async () => {
            await timeTravel(DAY);
            await pumaPayPullPayment.executePullPayment(clientOne, singlePullPayment.paymentID, {
                from: beneficiaryOne
            });

            const balanceOfBeneficiaryAfter = await token.balanceOf(beneficiaryOne);
            // 1 PMA = 0.01 EUR ==> 1 EUR = 100 PMA ==> 10 EUR = 1000 PMA
            Number(balanceOfBeneficiaryAfter).should.be.equal(1000 * ONE_ETHER);
        });

        it('should update the pull payment numberOfPayments', async () => {
            await timeTravel(DAY);
            await pumaPayPullPayment.executePullPayment(clientOne, singlePullPayment.paymentID, {
                from: beneficiaryOne
            });

            const pullPayment = await pumaPayPullPayment.pullPayments(clientOne, beneficiaryOne);

            pullPayment[6].should.be.bignumber.equal(singlePullPayment.numberOfPayments - 1); // NUMBER OF ALLOWED PULL PAYMENTS
        });

        it('should update the pull payment nextPaymentTimestamp', async () => {
            await timeTravel(DAY);
            await pumaPayPullPayment.executePullPayment(clientOne, singlePullPayment.paymentID, {
                from: beneficiaryOne
            });

            const pullPayment = await pumaPayPullPayment.pullPayments(clientOne, beneficiaryOne);

            pullPayment[8].should.be.bignumber.equal(singlePullPayment.startTimestamp + singlePullPayment.frequency); // NEXT PAYMENT TIMESTAMP
        });

        it('should update the pull payment lastPaymentTimestamp', async () => {
            await timeTravel(DAY);
            await pumaPayPullPayment.executePullPayment(clientOne, singlePullPayment.paymentID, {
                from: beneficiaryOne
            });
            const ethDate = await currentBlockTime();
            const pullPayment = await pumaPayPullPayment.pullPayments(clientOne, beneficiaryOne);

            pullPayment[9].should.be.bignumber.equal(ethDate); // LAST PAYMENT TIMESTAMP
        });

        it('should revert if executed before the start date specified in the payment', async () => {
            await timeTravel(DAY - 10);
            await assertRevert(pumaPayPullPayment.executePullPayment(clientOne, singlePullPayment.paymentID, {
                from: beneficiaryOne
            }));
        });

        it('should revert when executed twice, i.e. number of payments is zero', async () => {
            await timeTravel(DAY);
            await pumaPayPullPayment.executePullPayment(clientOne, singlePullPayment.paymentID, {
                from: beneficiaryOne
            });

            await assertRevert(pumaPayPullPayment.executePullPayment(clientOne, singlePullPayment.paymentID, {
                from: beneficiaryOne
            }));
        });

        it('should revert when pull payment does not exists for beneficiary calling the smart contract', async () => {
            await assertRevert(pumaPayPullPayment.executePullPayment(clientOne, singlePullPayment.paymentID, {
                from: beneficiaryThree
            }));
        });

        it('should emit a "LogPullPaymentExecuted" event', async () => {
            await timeTravel(DAY);
            const pullPaymentExecution = await pumaPayPullPayment.executePullPayment(clientOne, singlePullPayment.paymentID, {
                from: beneficiaryOne
            });

            const logs = pullPaymentExecution.logs;

            assert.equal(logs.length, 1);
            assert.equal(logs[0].event, 'LogPullPaymentExecuted');
            logs[0].args.clientAddress.should.be.equal(singlePullPayment.client);
            logs[0].args.beneficiaryAddress.should.be.equal(singlePullPayment.beneficiary);
            logs[0].args.paymentID.should.be.equal(singlePullPayment.paymentID);
        });
    });

    describe('Execute Recurring Pull Payment', async () => {
        beforeEach('Transfer ETH to smart contract', async () => {
            await transferEthersToSmartContract(1, deployerAccount, pumaPayPullPayment);
        });
        beforeEach('add executors', async () => {
            await pumaPayPullPayment.addExecutor(executorOne, {
                from: owner
            });
        });
        beforeEach('approve PumaPay Pull Payment  to transfer from second client\'s account ', async () => {
            await token.approve(pumaPayPullPayment.address, MINTED_TOKENS, {
                from: clientTwo
            });
        });

        beforeEach('set recurring pull payment details', async () => {
            const ethDate = await currentBlockTime();
            recurringPullPayment = {
                merchantID: "merchantID_2",
                paymentID: "paymentID_2",
                client: clientTwo,
                beneficiary: beneficiaryTwo,
                currency: 'USD',
                initialPaymentAmountInCents: 0,
                fiatAmountInCents: 200, // 2.00 USD in cents
                frequency: 1000000 * YEAR, // one million years to test for high numbers
                numberOfPayments: 10,
                startTimestamp: ethDate
            };
        });

        beforeEach('Add recurring pull payment', async () => {
            const signature = await calcSignedMessageForRegistration(recurringPullPayment, CLIENT_TWO_PRIVATE_KEY);
            const sigVRS = await getVRS(signature);

            await pumaPayPullPayment.registerPullPayment(
                sigVRS.v,
                sigVRS.r,
                sigVRS.s,
                recurringPullPayment.merchantID,
                recurringPullPayment.paymentID,
                recurringPullPayment.client,
                recurringPullPayment.beneficiary,
                recurringPullPayment.currency,
                recurringPullPayment.initialPaymentAmountInCents,
                recurringPullPayment.fiatAmountInCents,
                recurringPullPayment.frequency,
                recurringPullPayment.numberOfPayments,
                recurringPullPayment.startTimestamp,
                {
                    from: executorOne
                });
        });

        it('should pull the amount specified on the payment details to the beneficiary', async () => {
            await pumaPayPullPayment.executePullPayment(clientTwo, recurringPullPayment.paymentID, {
                from: beneficiaryTwo
            });

            const beneficiaryBalance = await token.balanceOf(beneficiaryTwo);
            // 1 PMA = 0.02 USD ==> 1 USD = 50 PMA ==> 2 USD = 100 PMA
            Number(beneficiaryBalance).should.be.equal(100 * ONE_ETHER);
        });

        it('should update the pull payment numberOfPayments', async () => {
            await pumaPayPullPayment.executePullPayment(clientTwo, recurringPullPayment.paymentID, {
                from: beneficiaryTwo
            });

            const pullPayment = await pumaPayPullPayment.pullPayments(clientTwo, beneficiaryTwo);

            pullPayment[6].should.be.bignumber.equal(recurringPullPayment.numberOfPayments - 1); // NUMBER OF ALLOWED PULL PAYMENTS
        });

        it('should update the pull payment nextPaymentTimestamp', async () => {
            await pumaPayPullPayment.executePullPayment(clientTwo, recurringPullPayment.paymentID, {
                from: beneficiaryTwo
            });

            const pullPayment = await pumaPayPullPayment.pullPayments(clientTwo, beneficiaryTwo);

            pullPayment[8].should.be.bignumber.equal(recurringPullPayment.startTimestamp + recurringPullPayment.frequency); // NEXT PAYMENT TIMESTAMP
        });

        it('should update the pull payment lastPaymentTimestamp', async () => {
            await pumaPayPullPayment.executePullPayment(clientTwo, recurringPullPayment.paymentID, {
                from: beneficiaryTwo
            });

            const ethDate = await currentBlockTime();
            const pullPayment = await pumaPayPullPayment.pullPayments(clientTwo, beneficiaryTwo);

            pullPayment[9].should.be.bignumber.equal(ethDate); // LAST PAYMENT TIMESTAMP
        });

        it('should execute the next payment when next payment date is reached', async () => {
            await pumaPayPullPayment.executePullPayment(clientTwo, recurringPullPayment.paymentID, {
                from: beneficiaryTwo
            });
            await timeTravel(1000000 * YEAR);
            await pumaPayPullPayment.executePullPayment(clientTwo, recurringPullPayment.paymentID, {
                from: beneficiaryTwo
            });

            const beneficiaryBalance = await token.balanceOf(beneficiaryTwo);
            // 1 PMA = 0.02 USD ==> 1 USD = 50 PMA ==> 2 USD = 100 PMA
            Number(beneficiaryBalance).should.be.equal(200 * ONE_ETHER);
        });

        it('should revert when if the next payment date is NOT reached', async () => {
            await pumaPayPullPayment.executePullPayment(clientTwo, recurringPullPayment.paymentID, {
                from: beneficiaryTwo
            });

            await timeTravel(1000000 * YEAR - DAY);
            await assertRevert(pumaPayPullPayment.executePullPayment(clientTwo, recurringPullPayment.paymentID, {
                from: beneficiaryTwo
            }));
        });

        it('should allow the merchant to pull payments in case they have missed few payments', async () => {
            await pumaPayPullPayment.executePullPayment(clientTwo, recurringPullPayment.paymentID, {
                from: beneficiaryTwo
            });

            await timeTravel(4000000 * YEAR); // 4 more paymets are allowed!
            await pumaPayPullPayment.executePullPayment(clientTwo, recurringPullPayment.paymentID, {
                from: beneficiaryTwo
            });
            await pumaPayPullPayment.executePullPayment(clientTwo, recurringPullPayment.paymentID, {
                from: beneficiaryTwo
            });
            await pumaPayPullPayment.executePullPayment(clientTwo, recurringPullPayment.paymentID, {
                from: beneficiaryTwo
            });
            await pumaPayPullPayment.executePullPayment(clientTwo, recurringPullPayment.paymentID, {
                from: beneficiaryTwo
            });

            const beneficiaryBalance = await token.balanceOf(beneficiaryTwo);
            // 1 PMA = 0.02 USD ==> 1 USD = 50 PMA ==> 2 USD = 100 PMA
            Number(beneficiaryBalance).should.be.equal(500 * ONE_ETHER);
            await assertRevert(pumaPayPullPayment.executePullPayment(clientTwo, recurringPullPayment.paymentID, {
                from: beneficiaryTwo
            }));
        });

        it('should allow the merchant to pull payments in case they have missed few payments and the customer cancelled the subscription', async () => {
            await timeTravel(2000000 * YEAR + DAY); // 3 paymets are allowed!
            const signature = await calcSignedMessageForDeletion(recurringPullPayment.paymentID, beneficiaryTwo, CLIENT_TWO_PRIVATE_KEY);
            const sigVRS = await getVRS(signature);

            await pumaPayPullPayment.deletePullPayment(
                sigVRS.v,
                sigVRS.r,
                sigVRS.s,
                recurringPullPayment.paymentID,
                recurringPullPayment.client,
                beneficiaryTwo, {
                    from: executorOne
                });
            await pumaPayPullPayment.executePullPayment(clientTwo, recurringPullPayment.paymentID, {
                from: beneficiaryTwo
            });
            await pumaPayPullPayment.executePullPayment(clientTwo, recurringPullPayment.paymentID, {
                from: beneficiaryTwo
            });
            await pumaPayPullPayment.executePullPayment(clientTwo, recurringPullPayment.paymentID, {
                from: beneficiaryTwo
            });

            const beneficiaryBalance = await token.balanceOf(beneficiaryTwo);
            // 1 PMA = 0.02 USD ==> 1 USD = 50 PMA ==> 2 USD = 100 PMA
            Number(beneficiaryBalance).should.be.equal(300 * ONE_ETHER);
            await assertRevert(pumaPayPullPayment.executePullPayment(clientTwo, recurringPullPayment.paymentID, {
                from: beneficiaryTwo
            }));
        });
    });

    describe('Execute Recurring Pull Payment with initial amount', async () => {
        beforeEach('Transfer ETH to smart contract', async () => {
            await transferEthersToSmartContract(1, deployerAccount, pumaPayPullPayment);
        });
        beforeEach('add executors', async () => {
            await pumaPayPullPayment.addExecutor(executorOne, {
                from: owner
            });
        });
        beforeEach('approve PumaPay Pull Payment  to transfer from third client\'s account ', async () => {
            await token.approve(pumaPayPullPayment.address, MINTED_TOKENS, {
                from: clientThree
            });
        });

        beforeEach('set recurring pull payment with initial amount details', async () => {
            const ethDate = await currentBlockTime();
            recurringPullPaymentWithInitialAmount = {
                merchantID: "merchantID_3",
                paymentID: "paymentID_3",
                client: clientThree,
                beneficiary: beneficiaryThree,
                currency: 'USD',
                initialPaymentAmountInCents: 100,
                fiatAmountInCents: 200, // 2.00 USD in cents
                frequency: 2 * DAY,
                numberOfPayments: 10,
                startTimestamp: ethDate + DAY
            };
        });

        beforeEach('Add recurring pull payment', async () => {
            const signature = await calcSignedMessageForRegistration(recurringPullPaymentWithInitialAmount, CLIENT_THREE_PRIVATE_KEY);
            const sigVRS = await getVRS(signature);

            await pumaPayPullPayment.registerPullPayment(
                sigVRS.v,
                sigVRS.r,
                sigVRS.s,
                recurringPullPaymentWithInitialAmount.merchantID,
                recurringPullPaymentWithInitialAmount.paymentID,
                recurringPullPaymentWithInitialAmount.client,
                recurringPullPaymentWithInitialAmount.beneficiary,
                recurringPullPaymentWithInitialAmount.currency,
                recurringPullPaymentWithInitialAmount.initialPaymentAmountInCents,
                recurringPullPaymentWithInitialAmount.fiatAmountInCents,
                recurringPullPaymentWithInitialAmount.frequency,
                recurringPullPaymentWithInitialAmount.numberOfPayments,
                recurringPullPaymentWithInitialAmount.startTimestamp,
                {
                    from: executorOne
                });
        });

        it('should pull the initial amount specified on the payment details to the beneficiary', async () => {
            await pumaPayPullPayment.executePullPayment(clientThree, recurringPullPaymentWithInitialAmount.paymentID, {
                from: beneficiaryThree
            });

            const beneficiaryBalance = await token.balanceOf(beneficiaryThree);

            Number(beneficiaryBalance).should.be.equal(50 * ONE_ETHER);
        });

        it('should pull the amount of the first payment specified for the reccuring payment to the beneficiary after receiving the initial payment', async () => {
            await pumaPayPullPayment.executePullPayment(clientThree, recurringPullPaymentWithInitialAmount.paymentID, {
                from: beneficiaryThree
            });
            await timeTravel(DAY);
            await pumaPayPullPayment.executePullPayment(clientThree, recurringPullPaymentWithInitialAmount.paymentID, {
                from: beneficiaryThree
            });

            const beneficiaryBalance = await token.balanceOf(beneficiaryThree);

            Number(beneficiaryBalance).should.be.equal(150 * ONE_ETHER);
        });

        it('should pull the amount of the second payment specified for the reccuring payment to the beneficiary', async () => {
            await pumaPayPullPayment.executePullPayment(clientThree, recurringPullPaymentWithInitialAmount.paymentID, {
                from: beneficiaryThree
            });
            await timeTravel(DAY);
            await pumaPayPullPayment.executePullPayment(clientThree, recurringPullPaymentWithInitialAmount.paymentID, {
                from: beneficiaryThree
            });
            await timeTravel(2 * DAY);
            await pumaPayPullPayment.executePullPayment(clientThree, recurringPullPaymentWithInitialAmount.paymentID, {
                from: beneficiaryThree
            });

            const beneficiaryBalance = await token.balanceOf(beneficiaryThree);

            Number(beneficiaryBalance).should.be.equal(250 * ONE_ETHER);
        });

        it('should set the intial payment amount to ZERO after pulling it', async () => {
            const pullPaymentBefore = await pumaPayPullPayment.pullPayments(clientThree, beneficiaryThree);
            pullPaymentBefore[3].should.be.bignumber.equal(recurringPullPaymentWithInitialAmount.initialPaymentAmountInCents); // INITIAL AMOUNT

            await pumaPayPullPayment.executePullPayment(clientThree, recurringPullPaymentWithInitialAmount.paymentID, {
                from: beneficiaryThree
            });
            const pullPaymentAfter = await pumaPayPullPayment.pullPayments(clientThree, beneficiaryThree);
            const ethDate = await currentBlockTime();

            pullPaymentAfter[3].should.be.bignumber.equal(0); // INITIAL AMOUNT
            pullPaymentAfter[9].should.be.bignumber.equal(ethDate); // LAST PAYMENT TIMESTAMP
        });
    });
});

contract('PumaPay Pull Payment Contract For Funding', async (accounts) => {
    const deployerAccount = accounts[0];    // 0xe689c075c808404C9A0d84bE10d2E960CC61c497
    const owner = accounts[1];              // 0x853C292e80e2ba1f93F33Af6046C3A0B2EaE47Dc
    const executorOne = accounts[2];        // 0xf52DBA6fe86D2f80c13F2e2565F521Ad0C18Efc0
    const executorTwo = accounts[3];        // 0x8CB728587175968B3616758FD0a528D057dFc336
    const beneficiaryOne = accounts[4];     // 0x3D76b36e4F76D7220001F21Cf0C70F2fb5799e6b
    const beneficiaryTwo = accounts[5];     // 0x5252055feEf476DBc6Ef32eF58Fd324b988F13B2
    const beneficiaryThree = accounts[6];   // 0xAaeDDcD2c5c96dF8Fc4297333f66b4Ea61fc3ab3
    const clientOne = accounts[7];          // 0xb2F990cCC50Da372307b080501BfA4703c1C499B
    const clientTwo = accounts[8];          // 0x34bfe2E8cbec8d0263Cd24c67166022C2D350614
    const clientThree = accounts[9];        // 0xc4771Be5D994847bE5B846E7126A0F73c6A0B144

    const gasPrice = 1000000000;

    let singlePullPayment = {
        merchantID: "merchantID_1",
        paymentID: "paymentID_1",
        client: clientOne,
        beneficiary: beneficiaryOne,
        currency: 'EUR',
        initialPaymentAmountInCents: 0,
        fiatAmountInCents: 1000, // 10.00 EUR in cents
        frequency: 1,
        numberOfPayments: 1,
        startTimestamp: Math.floor(Date.now() / 1000) + DAY
    };

    let token;
    let pumaPayPullPayment;


    beforeEach('Deploying new PumaPayToken', async () => {
        token = await PumaPayToken.new({
            from: deployerAccount
        });
    });

    beforeEach('Deploying new PumaPay Pull Payment', async () => {
        pumaPayPullPayment = await PumaPayPullPayment
            .new(token.address, {
                from: owner
            });
    });

    beforeEach('Issue tokens to the clients', async () => {
        const tokens = MINTED_TOKENS;
        await token.mint(clientOne, tokens, {
            from: deployerAccount
        });
        await token.mint(clientTwo, tokens, {
            from: deployerAccount
        });
        await token.mint(clientThree, tokens, {
            from: deployerAccount
        });
    });

    beforeEach('Finish Minting', async () => {
        await token.finishMinting({
            from: deployerAccount
        });
    });

    const transferEthersToSmartContract = async (ethers, fromAccount, smartContract) => {
        await smartContract.sendTransaction(
            {
                from: fromAccount,
                value: ethers * ONE_ETHER
            }
        );
    }

    describe('Set Rate', async () => {
        beforeEach('Transfer ETH to smart contract', async () => {
            await transferEthersToSmartContract(1, deployerAccount, pumaPayPullPayment);
        });
        afterEach('Transfer ETH to owner account', async () => {
            await web3API.eth.sendTransaction({
                from: deployerAccount,
                to: owner,
                value: 5 * ONE_ETHER
            });
        });
        it('should transfer ETH to the owner when its balance is lower than 0.01 ETH and set the rate', async () => {
            const ownerBalance = await web3API.eth.getBalance(owner);
            await web3API.eth.sendTransaction({
                from: owner,
                to: deployerAccount,
                value: ownerBalance - 0.01 * ONE_ETHER
            });
            const ownerBalanceBefore = await web3API.eth.getBalance(owner);
            const transaction = await pumaPayPullPayment.setRate('EUR', EUR_EXCHANGE_RATE * 10, {
                from: owner
            });
            const txFee = Number(transaction.receipt.gasUsed) * gasPrice;

            const ownerBalanceAfter = await web3API.eth.getBalance(owner);
            const euroRate = await pumaPayPullPayment.getRate('EUR');

            euroRate.should.be.bignumber.equal(EUR_EXCHANGE_RATE * 10);
            (ownerBalanceAfter - ownerBalanceBefore + txFee).should.be.bignumber.equal(ONE_ETHER);
        });
    });

    describe('Add Executor', async () => {
        beforeEach('Transfer ETH to smart contract', async () => {
            await transferEthersToSmartContract(2, deployerAccount, pumaPayPullPayment);
        });
        afterEach('Transfer ETH to owner account', async () => {
            await web3API.eth.sendTransaction({
                from: deployerAccount,
                to: owner,
                value: 5 * ONE_ETHER
            });
        });
        it('should transfer ETH to the owner when its balance is lower than 0.01 ETH', async () => {
            const ownerBalance = await web3API.eth.getBalance(owner);
            await web3API.eth.sendTransaction({
                from: owner,
                to: deployerAccount,
                value: ownerBalance - 0.01 * ONE_ETHER
            });
            const ownerBalanceBefore = await web3API.eth.getBalance(owner);
            const transaction = await pumaPayPullPayment.addExecutor(executorOne, {
                from: owner
            });
            const txFee = Number(transaction.receipt.gasUsed) * gasPrice;

            const ownerBalanceAfter = await web3API.eth.getBalance(owner);
            const executor = await pumaPayPullPayment.executors(executorOne);

            assert.equal(executor, true);
            (ownerBalanceAfter - ownerBalanceBefore + txFee).should.be.bignumber.equal(ONE_ETHER);
        });
    });

    describe('Remove Executor', async () => {
        beforeEach('Transfer ETH to smart contract', async () => {
            await transferEthersToSmartContract(2, deployerAccount, pumaPayPullPayment);
        });
        beforeEach('Add executor ETH to smart contract', async () => {
            await pumaPayPullPayment.addExecutor(executorOne, {
                from: owner
            });
        });
        afterEach('Transfer ETH to owner account', async () => {
            await web3API.eth.sendTransaction({
                from: deployerAccount,
                to: owner,
                value: 5 * ONE_ETHER
            });
        });
        it('should transfer ETH to the owner when its balance is lower than 0.01 ETH', async () => {
            const ownerBalance = await web3API.eth.getBalance(owner);
            await web3API.eth.sendTransaction({
                from: owner,
                to: deployerAccount,
                value: ownerBalance - 0.01 * ONE_ETHER
            });
            const ownerBalanceBefore = await web3API.eth.getBalance(owner);
            const transaction = await pumaPayPullPayment.removeExecutor(executorOne, {
                from: owner
            });
            const txFee = Number(transaction.receipt.gasUsed) * gasPrice;

            const ownerBalanceAfter = await web3API.eth.getBalance(owner);
            const executor = await pumaPayPullPayment.executors(executorOne);

            assert.equal(executor, false);
            (ownerBalanceAfter - ownerBalanceBefore + txFee).should.be.bignumber.equal(ONE_ETHER);
        });
    });

    describe('Register Pull Payment', async () => {
        beforeEach('Transfer ETH to smart contract', async () => {
            await transferEthersToSmartContract(3, deployerAccount, pumaPayPullPayment);
        });
        beforeEach('Add executor ETH to smart contract', async () => {
            await pumaPayPullPayment.addExecutor(executorOne, {
                from: owner
            });
        });
        it('should transfer ETH to the executor when its balance is lower than 0.01 ETH', async () => {
            const executorBalance = await web3API.eth.getBalance(executorOne);
            await web3API.eth.sendTransaction({
                from: executorOne,
                to: deployerAccount,
                value: executorBalance - 0.01 * ONE_ETHER
            });
            const executorBalanceBefore = await web3API.eth.getBalance(executorOne);

            const signature = await calcSignedMessageForRegistration(singlePullPayment, CLIENT_ONE_PRIVATE_KEY);
            const sigVRS = await getVRS(signature);

            const transaction = await pumaPayPullPayment.registerPullPayment(
                sigVRS.v,
                sigVRS.r,
                sigVRS.s,
                singlePullPayment.merchantID,
                singlePullPayment.paymentID,
                singlePullPayment.client,
                singlePullPayment.beneficiary,
                singlePullPayment.currency,
                singlePullPayment.initialPaymentAmountInCents,
                singlePullPayment.fiatAmountInCents,
                singlePullPayment.frequency,
                singlePullPayment.numberOfPayments,
                singlePullPayment.startTimestamp,
                {
                    from: executorOne
                });

            const txFee = Number(transaction.receipt.gasUsed) * gasPrice;
            const executorBalanceAfter = await web3API.eth.getBalance(executorOne);
            const activePaymentInArray = await pumaPayPullPayment.pullPayments(clientOne, beneficiaryOne);

            activePaymentInArray[0].should.be.equal(singlePullPayment.merchantID); // MERCHANT ID
            activePaymentInArray[1].should.be.equal(singlePullPayment.paymentID); // PAYMENT ID
            activePaymentInArray[2].should.be.equal(singlePullPayment.currency); // CURRENCY
            activePaymentInArray[3].should.be.bignumber.equal(singlePullPayment.initialPaymentAmountInCents); // INITIAL AMOUNT 
            activePaymentInArray[4].should.be.bignumber.equal(singlePullPayment.fiatAmountInCents); // FIAT AMOUNT
            activePaymentInArray[5].should.be.bignumber.equal(singlePullPayment.frequency); // FREQUENCY
            activePaymentInArray[6].should.be.bignumber.equal(singlePullPayment.numberOfPayments); // NUMBER OF ALLOWED PULL PAYMENTS
            activePaymentInArray[7].should.be.bignumber.equal(singlePullPayment.startTimestamp); // START TIMESTAMP
            activePaymentInArray[8].should.be.bignumber.equal(singlePullPayment.startTimestamp); // NEXT PAYMENT TIMESTAMP = START TIMESTAMP
            activePaymentInArray[9].should.be.bignumber.equal(0); // LAST PAYMENT TIMESTAMP
            activePaymentInArray[10].should.be.bignumber.equal(0); // CANCEL PAYMENT TIMESTAMP
            (executorBalanceAfter - executorBalanceBefore + txFee).should.be.bignumber.equal(ONE_ETHER);
        });
    });

    describe('Delete Pull Payment', async () => {
        beforeEach('Transfer ETH to smart contract', async () => {
            await transferEthersToSmartContract(3, deployerAccount, pumaPayPullPayment);
        });
        beforeEach('Add executor ETH to smart contract', async () => {
            await pumaPayPullPayment.addExecutor(executorOne, {
                from: owner
            });
        });
        beforeEach('Add single pull payment', async () => {
            const signature = await calcSignedMessageForRegistration(singlePullPayment, CLIENT_ONE_PRIVATE_KEY);
            const sigVRS = await getVRS(signature);

            await pumaPayPullPayment.registerPullPayment(
                sigVRS.v,
                sigVRS.r,
                sigVRS.s,
                singlePullPayment.merchantID,
                singlePullPayment.paymentID,
                singlePullPayment.client,
                singlePullPayment.beneficiary,
                singlePullPayment.currency,
                singlePullPayment.initialPaymentAmountInCents,
                singlePullPayment.fiatAmountInCents,
                singlePullPayment.frequency,
                singlePullPayment.numberOfPayments,
                singlePullPayment.startTimestamp,
                {
                    from: executorOne
                });
        });

        it('should transfer ETH to the executor when its balance is lower than 0.01 ETH', async () => {
            const executorBalance = await web3API.eth.getBalance(executorOne);
            await web3API.eth.sendTransaction({
                from: executorOne,
                to: deployerAccount,
                value: executorBalance - 0.01 * ONE_ETHER
            });
            const executorBalanceBefore = await web3API.eth.getBalance(executorOne);
            const signature = await calcSignedMessageForDeletion(singlePullPayment.paymentID, singlePullPayment.beneficiary, CLIENT_ONE_PRIVATE_KEY);
            const sigVRS = await getVRS(signature);

            const transaction = await pumaPayPullPayment.deletePullPayment(
                sigVRS.v,
                sigVRS.r,
                sigVRS.s,
                singlePullPayment.paymentID,
                singlePullPayment.client,
                singlePullPayment.beneficiary, {
                    from: executorOne
                });

            const txFee = Number(transaction.receipt.gasUsed) * gasPrice;
            const executorBalanceAfter = await web3API.eth.getBalance(executorOne);
            const ethDate = await currentBlockTime();
            const activePaymentInArray = await pumaPayPullPayment.pullPayments(clientOne, beneficiaryOne);

            activePaymentInArray[10].should.be.bignumber.equal(ethDate); // CANCEL PAYMENT TIMESTAMP
            (executorBalanceAfter - executorBalanceBefore + txFee).should.be.bignumber.equal(ONE_ETHER);
        });
    });
});