// SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
// SPDX-License-Identifier: Apache-2.0
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockFetch, ticket } from "../test/fixtures";
import { api, ApiError, collect, configureClient } from "./client";

const expired = vi.fn();
beforeEach(() => {
  expired.mockReset();
  configureClient({ csrf: "tok", onSessionExpired: expired });
});

describe("api client", () => {
  it("sends the CSRF token on writes only and never on reads", async () => {
    const calls = mockFetch(() => [200, {}]);
    await api.list("ticket");
    await api.update("ticket", "id", 3, { a: 1 });
    expect(calls[0]?.headers["X-CSRF-Token"]).toBeUndefined();
    expect(calls[1]?.headers["X-CSRF-Token"]).toBe("tok");
    expect(calls[1]?.url).toBe("/bff/api/v1/apps/it-helpdesk/entities/ticket/records/id");
    expect(calls[1]?.body).toEqual({ expectedVersion: 3, data: { a: 1 } });
  });

  it("creates with the caller-provided id and puts expectedVersion on DELETE in the query", async () => {
    const calls = mockFetch(() => [204, null]);
    await api.create("ticket", "0b3f6d7e-1c2a-4f5b-9d8e-123456789abc", { t: 1 });
    await api.remove("ticket", "abc", 7);
    expect(calls[0]?.body).toEqual({ id: "0b3f6d7e-1c2a-4f5b-9d8e-123456789abc", data: { t: 1 } });
    expect(calls[1]?.url).toContain("/records/abc?expectedVersion=7");
  });

  it("maps a failed write connection to COMMIT_OUTCOME_UNKNOWN and does not retry it", async () => {
    const calls = mockFetch(() => undefined);
    await expect(api.transition("ticket", "id", "submit", 0)).rejects.toMatchObject({ code: "COMMIT_OUTCOME_UNKNOWN" });
    expect(calls).toHaveLength(1);
  });

  it("maps a failed read connection to NETWORK", async () => {
    mockFetch(() => undefined);
    await expect(api.get("ticket", "id")).rejects.toMatchObject({ code: "NETWORK" });
  });

  it("parses Platform problems and keeps field errors keyed by JSON pointer", async () => {
    mockFetch(() => [400, { status: 400, code: "VALIDATION_FAILED", message: "Record is invalid", errors: { "/title": "required" } }]);
    const failure = await api.create("ticket", "i", {}).catch((error) => error as ApiError);
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ status: 400, code: "VALIDATION_FAILED", errors: { "/title": "required" } });
    expect(expired).not.toHaveBeenCalled();
  });

  it("notifies the app when the session ended", async () => {
    mockFetch(() => [401, { status: 401, code: "SESSION_EXPIRED", message: "x", errors: {} }]);
    await expect(api.app()).rejects.toMatchObject({ status: 401 });
    expect(expired).toHaveBeenCalledOnce();
  });

  it("tolerates a non-JSON error body", async () => {
    globalThis.fetch = (async () => new Response("Bad Gateway", { status: 502 })) as typeof fetch;
    await expect(api.app()).rejects.toMatchObject({ status: 502, code: "UNKNOWN" });
  });
});

describe("collect (bounded aggregate over authorized pages)", () => {
  const page = (offset: number, total: number, count: number) => ({
    items: Array.from({ length: count }, (_, index) => ticket({ id: `id-${offset + index}` })), total, limit: 100, offset,
  });

  it("is exact when every record fits under the cap", async () => {
    mockFetch(({ url }) => [200, page(Number(new URL(url, "http://x").searchParams.get("offset")), 230, Number(new URL(url, "http://x").searchParams.get("offset")) === 200 ? 30 : 100)]);
    const result = await collect("ticket", { cap: 500 });
    expect(result.items).toHaveLength(230);
    expect(result.truncated).toBe(false);
  });

  it("flags truncation when the cap is lower than the total", async () => {
    mockFetch(({ url }) => [200, page(Number(new URL(url, "http://x").searchParams.get("offset")), 900, 100)]);
    const result = await collect("ticket", { cap: 300 });
    expect(result.items).toHaveLength(300);
    expect(result.total).toBe(900);
    expect(result.truncated).toBe(true);
  });
});
