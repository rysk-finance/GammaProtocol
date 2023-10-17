# Redeployment strategy for Spread upgrades

## Contracts to be redeployed
- Margin Calculator
- Controller Implmenentation

## Full process

Testnet First -> Mainnet

1. Entire system pause - Both opyn full pause and rysk exchange pause
2. Margin Calculator deployment
3. Set Spot Shocks and Upper Bound values for all combinations of products on the newly deployed Margin Calculator
4. Set the fee and fee recipient on the newly deployed Margin Calculator
5. Transfer ownership of the margin calculator to the governor multisig
6. Set Margin calculator on address book
7. Deploy new Controller contract
8. Call setController on the address book using the newly deployed contract 
9. Call initialize on the new Controller Implementation contract to make sure no one else can call it
10. Call refreshConfiguration on the Controller Proxy contract and ensure that the proxy is pointing to the correct addresses
11. Open some trades, create some of the new spreads etc.