# TypeGPU GL retention reproduction

This project creates uniforms and destroys 1×1 textures on one GL root. It
uses no application code, shaders, rendering, images, or TypeGPU build plugin.

Use Node 24.21.0 or another Node version supported by Vite 8.
From this directory:

```sh
pnpm install
pnpm exec playwright install chromium
pnpm verify
```

To select software GL:

```sh
pnpm verify --software
```

If Chromium is already installed elsewhere, set `PLAYWRIGHT_BROWSERS_PATH` to
that installation's directory. From the sticker app repo root, the verified
command is:

```sh
PLAYWRIGHT_BROWSERS_PATH="$PWD/.playwright-browsers" pnpm exec node .scratch/gl-resource-retention/minimal/verify.mjs
```

The script forces collection after each batch, then reads the root's private
collections through Chromium's DevTools Protocol. It releases the inspection
handles after each read. The browser page holds only the root and GL context;
it does not keep the created resources in caller-owned arrays or closures.

Expected output for `@typegpu/gl` 0.12.5:

| Checkpoint     | Uniform records | Uniform buffer bytes | Texture records | Destroyed texture records | Native texture deletion calls |
| -------------- | --------------: | -------------------: | --------------: | ------------------------: | ----------------------------: |
| Initial        |               0 |                    0 |               0 |                         0 |                             0 |
| Batch 1        |             100 |                1,600 |             100 |                       100 |                           100 |
| Batch 2        |             200 |                3,200 |             200 |                       200 |                           200 |
| Batch 3        |             300 |                4,800 |             300 |                       300 |                           300 |
| Root destroyed |               0 |                    0 |               0 |                         0 |                           300 |

An exit code of zero and `REPRODUCED` mean the script observed this retention.
These assertions describe the affected version; they are not acceptance tests
for a fix. The check measures root-owned JavaScript records and native deletion
calls, not physical driver memory or performance.

For manual verification, run `pnpm dev`, open the printed URL in Chrome, and
call `window.allocate(100)` three times in the console. Take a heap snapshot
and inspect the root's `#uniforms` and `#textures` retainers. Destroy the root
with `window.root.destroy()` and take another snapshot. Inspect objects in the
snapshot rather than logging the resource handles, which can keep them alive.
