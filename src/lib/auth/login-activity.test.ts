import test from "node:test";
import assert from "node:assert/strict";
import {
  decodeSupabaseAccessTokenClaims,
  extractClientIpAddress,
  parseUserAgent,
} from "./login-activity-shared.ts";

test("parseUserAgent identifies desktop Chrome sessions", () => {
  const parsed = parseUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
  );

  assert.equal(parsed.deviceType, "desktop");
  assert.equal(parsed.deviceName, "Windows PC");
  assert.equal(parsed.browserName, "Chrome");
  assert.equal(parsed.osName, "Windows");
});

test("parseUserAgent identifies iPhone Safari sessions", () => {
  const parsed = parseUserAgent(
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Mobile/15E148 Safari/604.1",
  );

  assert.equal(parsed.deviceType, "mobile");
  assert.equal(parsed.deviceName, "iPhone");
  assert.equal(parsed.browserName, "Safari");
  assert.equal(parsed.osName, "iOS");
});

test("extractClientIpAddress prefers forwarded IP headers", () => {
  const headers = new Headers({
    "x-forwarded-for": "203.0.113.7, 70.41.3.18",
  });

  assert.equal(extractClientIpAddress(headers), "203.0.113.7");
});

test("decodeSupabaseAccessTokenClaims reads JWT payload values", () => {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString(
    "base64url",
  );
  const payload = Buffer.from(
    JSON.stringify({
      session_id: "session-123",
      iat: 1_746_000_000,
      aal: "aal1",
    }),
  ).toString("base64url");
  const token = `${header}.${payload}.`;

  const claims = decodeSupabaseAccessTokenClaims(token);

  assert.equal(claims.session_id, "session-123");
  assert.equal(claims.iat, 1_746_000_000);
  assert.equal(claims.aal, "aal1");
});
