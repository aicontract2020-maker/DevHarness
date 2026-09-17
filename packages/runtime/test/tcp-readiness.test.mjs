import assert from "node:assert/strict";
import net from "node:net";
import test from "node:test";

import { assertSafeReadiness } from "../../project/src/harness.mjs";
import { probeTcpReadiness, probeReadiness } from "../src/verify.mjs";

test("assertSafeReadiness accepts loopback tcp targets", () => {
  assertSafeReadiness({
    kind: "tcp",
    url: "tcp://127.0.0.1:55432",
    expected_statuses: [200],
    timeout_ms: 1000,
    interval_ms: 100
  });
  assert.throws(
    () => assertSafeReadiness({
      kind: "tcp",
      url: "tcp://example.com:5432",
      expected_statuses: [200],
      timeout_ms: 1000,
      interval_ms: 100
    }),
    /Unsafe readiness target/
  );
});

test("probeTcpReadiness reports 200 when the port accepts connections", async () => {
  const server = net.createServer((socket) => socket.end());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    const observation = await probeTcpReadiness(
      { kind: "tcp", url: `tcp://127.0.0.1:${port}` },
      1000
    );
    assert.equal(observation.status, 200);
    const viaDispatch = await probeReadiness(
      { kind: "tcp", url: `tcp://127.0.0.1:${port}`, expected_statuses: [200] },
      1000
    );
    assert.equal(viaDispatch.status, 200);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
