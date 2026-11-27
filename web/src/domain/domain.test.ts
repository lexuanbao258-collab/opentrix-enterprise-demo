// SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { ApiError } from "../api/client";
import { crumbsFor, navFor } from "../components/Layout";
import { ticket } from "../test/fixtures";
import { formatDate, formatDateTime } from "./format";
import { fieldErrors, isConflict, isUnknownOutcome, messageFor } from "./errors";
import { byUrgency, countByState, validateCategory, validateTicket } from "./tickets";

describe("error messages", () => {
  it("never shows raw server text and covers the contract codes", () => {
    for (const code of ["FORBIDDEN", "NOT_FOUND", "VERSION_CONFLICT", "STATE_LOCKED", "TRANSITION_NOT_ALLOWED", "VALIDATION_FAILED", "COMMIT_OUTCOME_UNKNOWN", "NETWORK"]) {
      const text = messageFor(new ApiError(409, code, "Record was changed by another request"));
      expect(text).not.toMatch(/Record was changed/);
      expect(text.length).toBeGreaterThan(10);
    }
    expect(messageFor(new ApiError(503, "STORE_UNAVAILABLE", "x"))).toMatch(/chưa sẵn sàng/);
    expect(messageFor(new Error("boom"))).toMatch(/lỗi/);
  });
  it("classifies conflicts and unknown outcomes", () => {
    expect(isConflict(new ApiError(409, "VERSION_CONFLICT", ""))).toBe(true);
    expect(isConflict(new ApiError(403, "FORBIDDEN", ""))).toBe(false);
    expect(isUnknownOutcome(new ApiError(503, "COMMIT_OUTCOME_UNKNOWN", ""))).toBe(true);
  });
  it("turns JSON pointers into field names", () => {
    expect(fieldErrors(new ApiError(400, "VALIDATION_FAILED", "", { "/title": "x", "/categoryCode": "y" }))).toEqual({ title: "x", categoryCode: "y" });
  });
});

describe("validation mirrors the manifest", () => {
  it("requires every ticket field and bounds lengths", () => {
    expect(Object.keys(validateTicket({}))).toEqual(["title", "description", "categoryCode", "priority"]);
    expect(validateTicket({ title: "a".repeat(201), description: "d", categoryCode: "NETWORK", priority: "LOW" }).title).toMatch(/200/);
    expect(validateTicket({ title: "t", description: "d", categoryCode: "NETWORK", priority: "LOW" })).toEqual({});
  });
  it("accepts only manifest-shaped category codes", () => {
    expect(validateCategory({ code: "NET_1", name: "n" })).toEqual({});
    for (const code of ["", "a", "1ABC", "A", "HAS SPACE", "X".repeat(33)]) expect(validateCategory({ code, name: "n" }).code).toBeTruthy();
  });
});

describe("dashboard aggregation", () => {
  it("counts by state over the loaded records", () => {
    const counts = countByState([ticket({ state: "DRAFT" }), ticket({ state: "DRAFT" }), ticket({ state: "CLOSED" })]);
    expect(counts).toEqual({ byState: { DRAFT: 2, CLOSED: 1 }, counted: 3 });
  });
});

describe("navigation follows backend-reported capabilities", () => {
  const labels = (ticketOps: Record<string, string>, categoryOps: Record<string, string>) => navFor({ ticket: ticketOps, category: categoryOps }, []).map((item) => item.to);
  it("requester", () => expect(labels({ read: "own", create: "own" }, { read: "all" })).toEqual(["/", "/my-requests", "/tickets/new", "/categories"]));
  it("agent", () => expect(labels({ read: "all" }, { read: "all" })).toEqual(["/", "/tickets", "/categories"]));
  it("administrator", () => expect(labels({ read: "all", audit: "all" }, { read: "all", create: "all" })).toEqual(["/", "/tickets", "/categories", "/audit"]));
  it("breadcrumbs use the list the caller can open", () => {
    const id = "0b3f6d7e-1c2a-4f5b-9d8e-123456789abc";
    expect(crumbsFor(`/tickets/${id}`, false).map((c) => c.to)).toEqual(["/", "/my-requests", `/tickets/${id}`]);
    expect(crumbsFor(`/tickets/${id}`, true).map((c) => c.to)).toEqual(["/", "/tickets", `/tickets/${id}`]);
    expect(crumbsFor("/tickets/new", false).map((c) => c.to)).toEqual(["/", "/my-requests", "/tickets/new"]);
  });
});

describe("date formatting", () => {
  it("formats a calendar date as dd/mm/yyyy without time-zone conversion", () => {
    expect(formatDate("2026-12-22")).toBe("22/12/2026");
    expect(formatDate("not a date")).toBe("not a date");
  });
  it("puts the date before the time", () => {
    expect(formatDateTime("2026-11-27T09:41:00Z")).toMatch(/^\d{2}\/\d{2}\/2026 \d{2}:\d{2}$/);
    expect(formatDateTime("garbage")).toBe("garbage");
  });
});

describe("ticket urgency order", () => {
  it("sorts urgent first, then the most recently updated", () => {
    const make = (id: string, priority: "LOW" | "URGENT" | "HIGH", updatedAt: string) => ticket({ id, updatedAt, data: { title: id, description: "d", categoryCode: "X", priority } });
    const sorted = [make("a", "LOW", "2026-01-03T00:00:00Z"), make("b", "URGENT", "2026-01-01T00:00:00Z"), make("c", "HIGH", "2026-01-02T00:00:00Z"), make("d", "HIGH", "2026-01-04T00:00:00Z")].sort(byUrgency);
    expect(sorted.map((item) => item.id)).toEqual(["b", "d", "c", "a"]);
  });
});
