import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_ATTACHMENT_POLICY,
  buildUniqueStorageName,
  normalizeAttachmentPolicy,
  prepareAttachment,
} from "../js/attachment-manager.js";

test("recommended compression policy is small and administrator-configurable", () => {
  assert.equal(DEFAULT_ATTACHMENT_POLICY.profileTargetBytes, 120 * 1024);
  assert.equal(DEFAULT_ATTACHMENT_POLICY.documentTargetBytes, 350 * 1024);
  assert.equal(DEFAULT_ATTACHMENT_POLICY.maxOriginalBytes, 8 * 1024 * 1024);

  const profile = normalizeAttachmentPolicy({ profile_image_max_kb: 90 }, "profile");
  const document = normalizeAttachmentPolicy({ document_image_max_kb: 280 }, "document");
  assert.equal(profile.targetBytes, 90 * 1024);
  assert.equal(document.targetBytes, 280 * 1024);
});

test("stored names combine an RFC UUID with the full SHA-256 digest", () => {
  const uuid = "123e4567-e89b-42d3-a456-426614174000";
  const digest = "a".repeat(64);
  assert.equal(buildUniqueStorageName({ uuid, digest, mimeType: "image/webp" }), `${uuid}-${digest}.webp`);
  assert.notEqual(
    buildUniqueStorageName({ uuid: "123e4567-e89b-42d3-a456-426614174001", digest, mimeType: "image/webp" }),
    buildUniqueStorageName({ uuid, digest, mimeType: "image/webp" }),
  );
});

test("an unreadable image format is preserved unchanged and still hashed", async () => {
  const file = new File([new Uint8Array([1, 2, 3, 4])], "identity.heic", { type: "image/heic" });
  const progress = [];
  const prepared = await prepareAttachment(
    file,
    normalizeAttachmentPolicy({}, "document"),
    event => progress.push(event),
    { compressImage: async () => { throw new Error("decoder unavailable"); }, uuid: () => "123e4567-e89b-42d3-a456-426614174000" },
  );

  assert.equal(prepared.compressed, false);
  assert.equal(prepared.mimeType, "image/heic");
  assert.equal(prepared.originalSize, 4);
  assert.equal(prepared.storedSize, 4);
  assert.match(prepared.digest, /^[a-f0-9]{64}$/);
  assert.match(prepared.storageName, /^123e4567-e89b-42d3-a456-426614174000-[a-f0-9]{64}\.heic$/);
  assert.equal(progress.at(-1).percent, 100);
});

test("a readable image is converted to WebP before hashing", async () => {
  const file = new File([new Uint8Array(900)], "card.png", { type: "image/png" });
  const prepared = await prepareAttachment(
    file,
    { ...normalizeAttachmentPolicy({}, "document"), targetBytes: 200 },
    () => {},
    {
      compressImage: async (_file, policy, onProgress) => {
        assert.equal(policy.targetBytes, 200);
        onProgress(60, "ضغط الصورة");
        return new Blob([new Uint8Array(150)], { type: "image/webp" });
      },
      uuid: () => "123e4567-e89b-42d3-a456-426614174000",
    },
  );

  assert.equal(prepared.compressed, true);
  assert.equal(prepared.mimeType, "image/webp");
  assert.equal(prepared.storedSize, 150);
  assert.match(prepared.storageName, /\.webp$/);
});

test("oversized originals fail before decoding", async () => {
  const file = new File([new Uint8Array(5)], "large.jpg", { type: "image/jpeg" });
  await assert.rejects(
    prepareAttachment(file, { ...normalizeAttachmentPolicy({}, "profile"), maxOriginalBytes: 4 }),
    /يتجاوز الحد الأصلي/,
  );
});
