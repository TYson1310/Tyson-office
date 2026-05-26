import { expect, test } from "@playwright/test";

test("health endpoint reports public readiness without privileged detail", async ({
  request,
}) => {
  const response = await request.get("/api/health");

  expect(response.ok()).toBeTruthy();

  const payload = (await response.json()) as {
    status: string;
    timestamp: string;
    services?: unknown;
    storage?: unknown;
  };

  expect(payload.status).toBe("ok");
  expect(payload.timestamp).toEqual(expect.any(String));
  expect(payload.services).toBeUndefined();
  expect(payload.storage).toBeUndefined();
});
