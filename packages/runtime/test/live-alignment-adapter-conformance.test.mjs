import assert from "node:assert/strict";
import test from "node:test";

import {
  makeLiveAlignmentFixture,
  normalizeInteractionPacket,
  normalizeStatus
} from "./live-alignment-fixtures.mjs";

test("provider-neutral live alignment keeps normalized status and packets equivalent across adapters", () => {
  const codex = makeLiveAlignmentFixture({ adapterId: "codex", authorityId: "authority-codex", answerLabel: "Codex" });
  const cursor = makeLiveAlignmentFixture({ adapterId: "cursor", authorityId: "authority-cursor", answerLabel: "Cursor" });

  assert.notEqual(codex.operation.id, cursor.operation.id);
  assert.notEqual(codex.operation.agent_descriptor.descriptor_sha256, cursor.operation.agent_descriptor.descriptor_sha256);
  assert.notEqual(codex.operation.agent_authority_subject.subject_sha256, cursor.operation.agent_authority_subject.subject_sha256);

  assert.deepEqual(normalizeStatus(codex.status), normalizeStatus(cursor.status));
  assert.notEqual(codex.status.journal_head_sha256, cursor.status.journal_head_sha256);
  assert.notEqual(codex.status.accounting_head_sha256, cursor.status.accounting_head_sha256);

  assert.deepEqual(normalizeInteractionPacket(codex.interactionPacket), normalizeInteractionPacket(cursor.interactionPacket));
  assert.equal(codex.interactionPacket.run_id, cursor.interactionPacket.run_id);
  assert.equal(codex.interactionPacket.head_sha, cursor.interactionPacket.head_sha);
});
