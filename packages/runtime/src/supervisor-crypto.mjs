import {
  createHash,
  createPublicKey,
  sign as signBytes,
  verify as verifyBytes
} from "node:crypto";

const DOMAINS = Object.freeze({
  "evidence-manifest": "devharness.evidence-manifest.v1\0",
  "approval-request": "devharness.approval-request.v1\0",
  "approval-receipt": "devharness.approval-receipt.v1\0",
  "isolation-proof": "devharness.isolation-proof.v1\0"
});

function canonicalValue(value, ancestors = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "object") throw new TypeError("Supervisor artifacts must be JSON-compatible.");
  if (ancestors.has(value)) throw new TypeError("Supervisor artifacts must be JSON-compatible and acyclic.");
  ancestors.add(value);
  let result;
  if (Array.isArray(value)) {
    result = value.map((item) => canonicalValue(item, ancestors));
  } else {
    result = {};
    for (const key of Object.keys(value).sort()) result[key] = canonicalValue(value[key], ancestors);
  }
  ancestors.delete(value);
  return result;
}

function unsignedArtifact(artifact) {
  if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) {
    throw new TypeError("Supervisor artifact payload must be an object.");
  }
  const payload = { ...artifact };
  delete payload.attestation;
  return payload;
}

export function canonicalArtifactBytes(kind, artifact) {
  const domain = DOMAINS[kind];
  if (!domain) throw new Error(`Unsupported supervisor artifact kind: ${kind}`);
  const serialized = JSON.stringify(canonicalValue(unsignedArtifact(artifact)));
  return Buffer.concat([Buffer.from(domain, "utf8"), Buffer.from(serialized, "utf8")]);
}

export function artifactPayloadHash(kind, artifact) {
  return createHash("sha256").update(canonicalArtifactBytes(kind, artifact)).digest("hex");
}

export function publicKeyFingerprint(publicKey) {
  const key = publicKey?.type === "public" ? publicKey : createPublicKey(publicKey);
  const der = key.export({ type: "spki", format: "der" });
  return createHash("sha256").update(der).digest("hex");
}

export function signSupervisorArtifact(kind, artifact, privateKey, identity) {
  if ((kind === "evidence-manifest" || kind === "isolation-proof") && (artifact?.issuer?.id !== identity.id || artifact?.issuer?.fingerprint !== identity.fingerprint)) {
    throw new Error("Artifact issuer does not match the pinned Supervisor identity.");
  }
  const payload = canonicalArtifactBytes(kind, artifact);
  return {
    ...artifact,
    attestation: {
      issuer_id: identity.id,
      issuer_fingerprint: identity.fingerprint,
      payload_sha256: createHash("sha256").update(payload).digest("hex"),
      algorithm: "Ed25519",
      signature: signBytes(null, payload, privateKey).toString("base64")
    }
  };
}

export function verifySupervisorArtifact(kind, artifact, identity) {
  try {
    const attestation = artifact?.attestation;
    if (!attestation || identity?.algorithm !== "Ed25519") return false;
    if (attestation.algorithm !== "Ed25519") return false;
    if ((kind === "evidence-manifest" || kind === "isolation-proof") && (artifact?.issuer?.id !== identity.id || artifact?.issuer?.fingerprint !== identity.fingerprint)) return false;
    if (attestation.issuer_id !== identity.id || attestation.issuer_fingerprint !== identity.fingerprint) return false;
    if (publicKeyFingerprint(identity.public_key.value) !== identity.fingerprint) return false;
    const payload = canonicalArtifactBytes(kind, artifact);
    if (createHash("sha256").update(payload).digest("hex") !== attestation.payload_sha256) return false;
    return verifyBytes(null, payload, createPublicKey(identity.public_key.value), Buffer.from(attestation.signature, "base64"));
  } catch {
    return false;
  }
}
