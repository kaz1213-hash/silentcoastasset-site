# Tanuki Commerce Operations

## Ownership

- **Silent Coast Asset site** owns storefront UI, product pages and the public commerce registry.
- **Tanuki Growth** owns product registration, checkout verification, launch copy, funnel measurement and post-launch conversion improvements.
- **Product teams** own the delivered artifact and product-specific first-run acceptance.
- **Director** only performs unavoidable identity/KYC/bank/login/final public-release actions.

## Promotion flow

A product advances through these states:

`PRODUCT_READY -> CHECKOUT_PENDING -> FIELD_TEST -> AVAILABLE`

Promotion to `AVAILABLE` requires evidence for every stage:

1. first-party SCA product/store page exists
2. production checkout URL is real and product-specific
3. checkout product name/price match the SCA page
4. controlled purchase succeeds
5. expected receipt/buyer access appears
6. exact intended artifact is delivered
7. artifact opens
8. first-use acceptance passes
9. refund/revocation behavior is understood

When these pass, Growth may request a single registry change:

- set provider from candidate to production provider
- set verified checkout URL
- set `commerce_state=AVAILABLE`
- set `enabled=true`

The storefront code then exposes the Buy CTA automatically.

## Rollback

If checkout, fulfillment or artifact delivery breaks after launch:

- set `enabled=false`
- set `commerce_state=PAUSED`
- keep the product page live for explanation/support
- diagnose before re-enabling

Do not replace a broken checkout with an unverified fallback URL.

## Metrics

Future Growth measurement should observe, where trustworthy data exists:

`store/product view -> Buy CTA -> checkout -> purchase -> delivery -> first use`

Missing events remain `UNKNOWN`. No manual monthly spreadsheet is required from the Director.
