# Tanuki Site Relay — Netlify bundle

Target: https://relay.silentcoastasset.com

Required production environment variables:

- TANUKI_RELAY_SESSION_SECRET (32+ chars)
- TANUKI_RELAY_PUBLIC_URL=https://relay.silentcoastasset.com
- TANUKI_SITE_PRODUCT_IDS and/or TANUKI_SITE_VARIANT_IDS
- optional TANUKI_MCP_ALLOWED_ORIGINS when an MCP client sends Origin

Do not enable TANUKI_RELAY_ALLOW_DEV_TOKEN in production. State is stored in Netlify Blobs with strong reads and ETag conditional writes.
