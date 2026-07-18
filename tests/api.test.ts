import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db";

// Integration tests — they exercise the real Express app against a real Postgres
// (metadata) and the local-file blob store (content).
// Start the DB first:  docker compose up -d postgres  &&  npm run db:push
const app = createApp();

const CODE = "def hello():\n    print('hi pastebin')\n";

beforeAll(async () => {
  await prisma.paste.deleteMany(); // clean slate for deterministic assertions
});

afterAll(async () => {
  await prisma.paste.deleteMany();
  await prisma.$disconnect();
});

describe("POST /api/v1/pastes", () => {
  it("F1: creates a paste and returns 201 with a key + url", async () => {
    const res = await request(app)
      .post("/api/v1/pastes")
      .send({ content: CODE, language: "python", expiry: "1d", visibility: "public" });
    expect(res.status).toBe(201);
    expect(res.body.key).toMatch(/^[0-9A-Za-z]{7}$/);
    expect(res.body.url).toContain(res.body.key);
    expect(res.body.expires_at).toBeTruthy();
  });

  it("the metadata/blob split: content is NOT stored in the DB, only a blob pointer", async () => {
    const res = await request(app).post("/api/v1/pastes").send({ content: CODE });
    const row = await prisma.paste.findUnique({ where: { key: res.body.key } });
    expect(row).not.toBeNull();
    // The row has a pointer + size, but no `content` column exists at all.
    expect(row).not.toHaveProperty("content");
    expect(row!.blobUrl).toContain(res.body.key);
    expect(row!.sizeBytes).toBe(Buffer.byteLength(CODE, "utf-8"));
  });

  it("F2: reads a paste back as JSON with its content", async () => {
    const create = await request(app).post("/api/v1/pastes").send({ content: CODE });
    const res = await request(app).get(`/api/v1/pastes/${create.body.key}`);
    expect(res.status).toBe(200);
    expect(res.body.content).toBe(CODE);
    expect(res.body.views).toBeGreaterThanOrEqual(1);
  });

  it("F2: raw view returns text/plain content", async () => {
    const create = await request(app).post("/api/v1/pastes").send({ content: CODE });
    const res = await request(app).get(`/${create.body.key}/raw`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain");
    expect(res.text).toBe(CODE);
  });

  it("F7: honors a custom alias", async () => {
    const res = await request(app)
      .post("/api/v1/pastes")
      .send({ content: CODE, custom_alias: "my-snippet" });
    expect(res.status).toBe(201);
    expect(res.body.key).toBe("my-snippet");
  });

  it("F7: returns 409 when the alias is already taken", async () => {
    await request(app).post("/api/v1/pastes").send({ content: CODE, custom_alias: "dup-alias" });
    const res = await request(app)
      .post("/api/v1/pastes")
      .send({ content: CODE, custom_alias: "dup-alias" });
    expect(res.status).toBe(409);
  });

  it("F4: rejects an over-cap paste with 413", async () => {
    // Temporarily assume the default 10 MB cap; send just over a small override isn't
    // possible here, so we send > 10 MB to hit the byte check. Kept modest for speed.
    const big = "x".repeat(10 * 1024 * 1024 + 1);
    const res = await request(app).post("/api/v1/pastes").send({ content: big });
    expect(res.status).toBe(413);
  });

  it("rejects an empty paste with 400", async () => {
    const res = await request(app).post("/api/v1/pastes").send({ content: "" });
    expect(res.status).toBe(400);
  });
});

describe("GET /:key", () => {
  it("returns 404 for an unknown key", async () => {
    const res = await request(app).get("/api/v1/pastes/doesNotExist");
    expect(res.status).toBe(404);
  });

  it("F5: returns 410 Gone for an expired paste", async () => {
    await prisma.paste.create({
      data: {
        key: "expired1",
        blobUrl: "blob://pastebin-blobs/pastes/expired1",
        sizeBytes: 3,
        visibility: "unlisted",
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    const res = await request(app).get("/api/v1/pastes/expired1");
    expect(res.status).toBe(410);
  });

  it("F5: burn-after-read serves once, then is Gone (410)", async () => {
    const create = await request(app)
      .post("/api/v1/pastes")
      .send({ content: "one-time secret", expiry: "burn" });
    const key = create.body.key;

    const first = await request(app).get(`/api/v1/pastes/${key}`);
    expect(first.status).toBe(200);
    expect(first.body.content).toBe("one-time secret");

    const second = await request(app).get(`/api/v1/pastes/${key}`);
    expect(second.status).toBe(410);
  });
});

describe("F6: visibility", () => {
  it("private pastes are 403 for non-owners and 200 for the owner", async () => {
    const create = await request(app)
      .post("/api/v1/pastes")
      .set("Authorization", "Bearer alice")
      .send({ content: CODE, visibility: "private" });
    const key = create.body.key;

    const anon = await request(app).get(`/api/v1/pastes/${key}`);
    expect(anon.status).toBe(403);

    const owner = await request(app)
      .get(`/api/v1/pastes/${key}`)
      .set("Authorization", "Bearer alice");
    expect(owner.status).toBe(200);
    expect(owner.body.content).toBe(CODE);
  });
});

describe("DELETE /api/v1/pastes/:key", () => {
  it("owner can delete (204); afterwards it is 404", async () => {
    const create = await request(app)
      .post("/api/v1/pastes")
      .set("Authorization", "Bearer bob")
      .send({ content: CODE });
    const key = create.body.key;

    const del = await request(app)
      .delete(`/api/v1/pastes/${key}`)
      .set("Authorization", "Bearer bob");
    expect(del.status).toBe(204);

    const after = await request(app).get(`/api/v1/pastes/${key}`);
    expect(after.status).toBe(404);
  });

  it("non-owner cannot delete (403)", async () => {
    const create = await request(app)
      .post("/api/v1/pastes")
      .set("Authorization", "Bearer carol")
      .send({ content: CODE });
    const res = await request(app)
      .delete(`/api/v1/pastes/${create.body.key}`)
      .set("Authorization", "Bearer mallory");
    expect(res.status).toBe(403);
  });
});

describe("F9: list my pastes", () => {
  it("returns the caller's pastes and 401 when unauthenticated", async () => {
    await request(app)
      .post("/api/v1/pastes")
      .set("Authorization", "Bearer dave")
      .send({ content: CODE });

    const mine = await request(app)
      .get("/api/v1/users/me/pastes")
      .set("Authorization", "Bearer dave");
    expect(mine.status).toBe(200);
    expect(mine.body.pastes.length).toBeGreaterThanOrEqual(1);

    const anon = await request(app).get("/api/v1/users/me/pastes");
    expect(anon.status).toBe(401);
  });
});
