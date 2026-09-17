import assert from "node:assert/strict";
import test from "node:test";

import { formatUnderstandingReadyGaps } from "../src/understanding-ready-gaps.mjs";

test("formatUnderstandingReadyGaps lists blocker codes", () => {
  const md = formatUnderstandingReadyGaps({
    verdict: {
      ready: false,
      reasons: [
        { code: "strategy_not_approved", summary: "Strategy needs a human gate." },
        { code: "baseline_verdict_not_ready", summary: "Baseline verdict is needs-evidence." }
      ]
    }
  }, {
    baseline: { verdict: "needs-evidence" },
    strategy: { id: "design-strategy-draft-1", status: "proposed" }
  });
  assert.match(md, /not ready/);
  assert.match(md, /strategy_not_approved/);
  assert.match(md, /--for-strategy/);
  assert.match(md, /needs-evidence/);
});
