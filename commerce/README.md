# Tanuki Commerce Core v0.1

## Product rule

> **SCA / Tanuki is the store. The payment provider is the register.**

Silent Coast Asset owns product discovery, explanation, comparison, brand and navigation. A third-party checkout may handle payment, tax, receipts and Merchant-of-Record responsibilities.

This architecture is intentionally different from sending customers to a generic external storefront to browse products.

## v0.1 files

- `../tanuki-store.html` — first-party storefront
- `products.json` — canonical public commerce registry
- `commerce.js` — fail-closed renderer for Store/product CTAs

## Fail-closed rule

A Buy button is visible only when all are true:

1. `enabled` is `true`
2. `checkout_url` is non-empty
3. URL is HTTPS
4. checkout host is explicitly allowed by `commerce.js`
5. the product-specific production E2E gate has already passed

If the registry is missing, malformed or unavailable, purchase CTAs stay closed.

Never publish a placeholder checkout URL.

## First Polar field gate

Tanuki Chronicle Japanese v1.0 is the single pilot.

`POLAR_FIELD_PASS` requires:

1. SCA product page / Tanuki Store
2. real production Polar Checkout Link
3. successful controlled purchase
4. receipt / buyer access
5. exact intended customer ZIP delivered
6. ZIP downloads successfully
7. ZIP opens
8. product artifact opens
9. refund/revocation behavior checked where feasible

Only after this passes may `tanuki-chronicle-jp` change to:

```json
{
  "commerce_state": "AVAILABLE",
  "checkout_provider": "POLAR",
  "checkout_url": "<verified production checkout URL>",
  "enabled": true
}
```

Chronicle English, Fortune and other download products should reuse the same rail only after the first field pass.

## Polar configuration target

For each verified product Checkout Link:

- `success_url`: return to an SCA/Tanuki confirmation surface once that surface is finalized
- `return_url`: the corresponding SCA product page
- product fulfillment: Polar File Download benefit when appropriate
- no SCA-hosted card handling
- no customer-usage cloud runtime paid by SCA

## Legal/trust boundary

Do not disguise the payment provider at the point where it is legally or operationally relevant. If Polar is Merchant of Record, checkout disclosure should say so clearly. The goal is a first-party **shopping experience**, not pretending SCA itself processes the card transaction.

## Infrastructure rule

No production deploy is required to develop this rail. Respect the current Netlify production-credit freeze. Merge/deploy only when it buys meaningful customer/release evidence.
