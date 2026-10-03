import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

// Set PLAYWRIGHT_BROWSERS_PATH to use an existing Chromium installation.
const { chromium } = await import("playwright");
const software = process.argv.includes("--software");
const server = await createServer({
  root: fileURLToPath(new URL(".", import.meta.url)),
  configFile: false,
  server: { host: "127.0.0.1", port: 0 },
});
let browser;
try {
  await server.listen();
  const address = server.httpServer.address();
  assert.ok(address && typeof address !== "string");
  browser = await chromium.launch({
    channel: "chromium",
    headless: true,
    args:
      software ?
        ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"]
      : [],
  });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(`http://127.0.0.1:${address.port}`);
  await page.waitForFunction(() => typeof window.allocate === "function");
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("HeapProfiler.enable");

  async function inspect(label) {
    await cdp.send("HeapProfiler.collectGarbage");
    const group = "root-inspection";
    try {
      const { result } = await cdp.send("Runtime.evaluate", {
        expression: "window.root",
        objectGroup: group,
      });
      assert.ok(result.objectId);
      const { privateProperties } = await cdp.send("Runtime.getProperties", {
        objectId: result.objectId,
        ownProperties: true,
      });
      const records = {};
      for (const name of ["#uniforms", "#textures"]) {
        const property = privateProperties.find((entry) => entry.name === name);
        assert.ok(
          property?.value.objectId,
          `Missing private collection ${name}`,
        );
        const { result: data } = await cdp.send("Runtime.callFunctionOn", {
          objectId: property.value.objectId,
          objectGroup: group,
          returnByValue: true,
          functionDeclaration:
            name === "#uniforms" ?
              "function(){return {count:this.length,bytes:this.reduce((sum,u)=>sum+u.buffer.byteLength,0)}}"
            : "function(){return {count:this.length,destroyed:this.filter(t=>t.destroyed).length}}",
        });
        records[name.slice(1)] = data.value;
      }
      const deletes = await page.evaluate(() => window.deletes);
      const row = { label, ...records, deleteTextureCalls: deletes };
      console.log(JSON.stringify(row));
      return row;
    } finally {
      await cdp.send("Runtime.releaseObjectGroup", { objectGroup: group });
    }
  }

  console.log(
    `Chromium ${browser.version()}: ${await page.evaluate(() => window.renderer)}`,
  );
  const initial = await inspect("initial");
  assert.equal(initial.uniforms.count, 0);
  assert.equal(initial.textures.count, 0);
  for (let batch = 1; batch <= 3; batch++) {
    await page.evaluate(() => window.allocate(100));
    const row = await inspect(`batch-${batch}`);
    assert.equal(row.uniforms.count, batch * 100);
    assert.equal(row.uniforms.bytes, batch * 100 * 16);
    assert.equal(row.textures.count, batch * 100);
    assert.equal(row.textures.destroyed, batch * 100);
    assert.equal(row.deleteTextureCalls, batch * 100);
  }
  await page.evaluate(() => window.root.destroy());
  const stopped = await inspect("root-destroyed");
  assert.equal(stopped.uniforms.count, 0);
  assert.equal(stopped.textures.count, 0);
  assert.equal(stopped.deleteTextureCalls, 300);
  assert.deepEqual(errors, []);
  console.log("REPRODUCED: root records survive GC until root.destroy().");
} finally {
  await browser?.close();
  await server.close();
}
