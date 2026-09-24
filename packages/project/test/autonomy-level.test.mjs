import assert from "node:assert/strict";
import test from "node:test";

import {
  computeAutonomyLevel,
  nextAutonomyLevelGap
} from "../src/doctor.mjs";

function caps(statuses) {
  return Object.entries(statuses).map(([id, status]) => ({ id, status }));
}

const sealedThrough4 = {
  "git-repository": "pass",
  "build-command": "pass",
  "automated-tests": "pass",
  "behavior-verification": "pass",
  "service-launch": "pass",
  "ci-feedback": "pass",
  "pull-request-delivery": "pass",
  "supervisor-isolation": "fail"
};

test("computeAutonomyLevel climbs 0→5 with sealed evidence and isolation", () => {
  assert.equal(computeAutonomyLevel(caps({ "git-repository": "fail" })), 0);
  assert.equal(computeAutonomyLevel(caps({ "git-repository": "pass" })), 1);
  assert.equal(
    computeAutonomyLevel(
      caps({
        "git-repository": "pass",
        "build-command": "pass",
        "automated-tests": "pass"
      })
    ),
    2
  );
  assert.equal(
    computeAutonomyLevel(
      caps({
        "git-repository": "pass",
        "build-command": "pass",
        "automated-tests": "pass",
        "behavior-verification": "pass",
        "service-launch": "not_applicable"
      })
    ),
    3
  );
  assert.equal(computeAutonomyLevel(caps(sealedThrough4)), 4);
  assert.equal(
    computeAutonomyLevel(caps({ ...sealedThrough4, "supervisor-isolation": "pass" })),
    5
  );
});

test("nextAutonomyLevelGap names the missing rung and clears at L5", () => {
  const gap4 = nextAutonomyLevelGap(caps(sealedThrough4));
  assert.equal(gap4.next_level, 5);
  assert.deepEqual(gap4.missing, ["supervisor-isolation"]);
  assert.match(gap4.summary, /prove-isolation/);

  assert.equal(
    nextAutonomyLevelGap(caps({ ...sealedThrough4, "supervisor-isolation": "pass" })),
    null
  );

  const gap2 = nextAutonomyLevelGap(
    caps({
      "git-repository": "pass",
      "build-command": "warn",
      "automated-tests": "fail"
    })
  );
  assert.equal(gap2.next_level, 2);
  assert.deepEqual(gap2.missing, ["build-command", "automated-tests"]);
});
