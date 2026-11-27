// SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
// SPDX-License-Identifier: Apache-2.0
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { configureClient } from "../api/client";
import { App } from "../App";
import { hrCrumbsFor, hrNavFor, navFor } from "../components/Layout";
import { validateLeave } from "../domain/leave";
import {
  AUDITOR_OPS, EMPLOYEE_OPS, MANAGER_OPS, REQUESTER_OPS, USER_ID, leaveRequest, mockFetch, renderAt, sessionState, type Call,
} from "../test/fixtures";
import { LeaveDetail } from "./LeaveDetail";
import { LeaveForm } from "./LeaveForm";
import { LeaveList } from "./LeaveList";

const ID = "22222222-2222-4222-8222-222222222222";
beforeEach(() => configureClient({ csrf: "csrf", onSessionExpired: () => undefined }));

const employee = sessionState({ hr: { ops: EMPLOYEE_OPS, roles: ["employee"] } });
const manager = sessionState({ hr: { ops: MANAGER_OPS, roles: ["manager"] } });
const employeeManager = sessionState({ hr: { ops: MANAGER_OPS, roles: ["employee", "manager"] } });
const empty = () => [200, { items: [], total: 0, limit: 100, offset: 0 }] as [number, unknown];

describe("leave validation mirrors the manifest and invents nothing", () => {
  it("requires every field and bounds days and reason", () => {
    expect(Object.keys(validateLeave({}))).toEqual(["kind", "startDate", "days", "reason"]);
    expect(validateLeave({ kind: "ANNUAL", startDate: "2026-12-01", days: 30, reason: "r" })).toEqual({});
    for (const days of [0, 31, 1.5, "x", ""]) expect(validateLeave({ kind: "SICK", startDate: "2026-12-01", days, reason: "r" }).days).toBeTruthy();
    expect(validateLeave({ kind: "SICK", startDate: "2026-02-30", days: 1, reason: "r" }).startDate).toBeTruthy();
    expect(validateLeave({ kind: "SICK", startDate: "2026-12-01", days: 1, reason: "x".repeat(501) }).reason).toMatch(/500/);
    expect(validateLeave({ kind: "OTHER", startDate: "2026-12-01", days: 1, reason: "r" }).kind).toBeTruthy();
  });
});

describe("navigation follows discovery and backend-reported capabilities", () => {
  const to = (ops: Record<string, string>, roles: string[]) => hrNavFor(ops, roles).map((item) => item.to);
  it("employee", () => expect(to(EMPLOYEE_OPS, ["employee"])).toEqual(["/hr", "/hr/my-requests", "/hr/requests/new"]));
  it("manager", () => expect(to(MANAGER_OPS, ["manager"])).toEqual(["/hr", "/hr/approvals", "/hr/requests"]));
  it("employee and manager", () => expect(to({ ...MANAGER_OPS, create: "own" }, ["employee", "manager"])).toEqual(["/hr", "/hr/my-requests", "/hr/requests/new", "/hr/approvals", "/hr/requests"]));
  it("auditor", () => expect(to(AUDITOR_OPS, ["auditor"])).toEqual(["/hr", "/hr/requests", "/hr/audit"]));
  it("IT navigation is unchanged by HR", () => expect(navFor({ ticket: REQUESTER_OPS, category: { read: "all" } }, []).map((i) => i.to)).toEqual(["/", "/my-requests", "/tickets/new", "/categories"]));
  it("breadcrumbs", () => {
    expect(hrCrumbsFor("/requests/abcdef12-0000").map((c) => c.to)).toEqual(["/hr", "/hr/requests/abcdef12-0000"]);
    expect(hrCrumbsFor("/approvals").map((c) => c.to)).toEqual(["/hr", "/hr/approvals"]);
  });
});

describe("App routing across the two applications", () => {
  it("an IT-only user cannot open HR pages and sees no HR navigation", async () => {
    mockFetch(empty);
    renderAt(<App />, { path: "/hr", state: sessionState({ it: { ops: REQUESTER_OPS, roles: ["requester"] } }) });
    expect(await screen.findByText("Không có quyền truy cập")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Đơn của tôi" })).not.toBeInTheDocument();
  });

  it("an HR-only user cannot open IT pages and lands on HR Leave from /", async () => {
    mockFetch(empty);
    renderAt(<App />, { path: "/tickets/new", state: employee });
    expect(await screen.findByText("Không có quyền truy cập")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Quản lý phiếu" })).not.toBeInTheDocument();
  });

  it("/ sends an HR-only user to the HR dashboard", async () => {
    mockFetch(empty);
    renderAt(<App />, { path: "/", state: employee });
    expect(await screen.findByRole("heading", { level: 1, name: "Tổng quan nghỉ phép" })).toBeInTheDocument();
  });

  it("a user with roles in both applications gets both navigation groups", async () => {
    mockFetch(empty);
    renderAt(<App />, { path: "/", state: sessionState({ it: { ops: REQUESTER_OPS, roles: ["requester"] }, hr: { ops: EMPLOYEE_OPS, roles: ["employee"] } }) });
    const nav = screen.getByRole("navigation", { name: "Điều hướng chính" });
    expect(within(nav).getByRole("heading", { name: "Hỗ trợ CNTT" })).toBeInTheDocument();
    expect(within(nav).getByRole("heading", { name: "Nghỉ phép" })).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "Yêu cầu của tôi" })).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "Đơn của tôi" })).toBeInTheDocument();
  });

  it("refuses HR routes the backend does not grant (employee cannot open approvals or audit)", async () => {
    mockFetch(empty);
    renderAt(<App />, { path: "/hr/approvals", state: employee });
    expect(await screen.findByText("Không có quyền truy cập")).toBeInTheDocument();
  });

  it("only an auditor reaches the HR audit view", async () => {
    mockFetch(empty);
    renderAt(<App />, { path: "/hr/audit", state: manager });
    expect(await screen.findByText("Không có quyền truy cập")).toBeInTheDocument();
  });
});

describe("LeaveForm", () => {
  async function fill(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText("Ngày bắt đầu"), "2026-12-01");
    await user.clear(screen.getByLabelText("Số ngày nghỉ"));
    await user.type(screen.getByLabelText("Số ngày nghỉ"), "3");
    await user.type(screen.getByLabelText(/^Lý do/), "Việc gia đình");
  }

  it("blocks an invalid submit without calling the API", async () => {
    const calls = mockFetch(() => [200, {}]);
    const user = userEvent.setup();
    renderAt(<LeaveForm mode="new" />, { path: "/hr/requests/new", state: employee });
    await user.clear(screen.getByLabelText("Số ngày nghỉ"));
    await user.type(screen.getByLabelText("Số ngày nghỉ"), "31");
    await user.click(screen.getByRole("button", { name: "Lưu nháp" }));
    expect(screen.getAllByText("Bắt buộc nhập").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Nhập số nguyên từ 1 đến 30", { selector: ".field-error" })).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it("creates with a client id then submits with the returned version", async () => {
    const calls = mockFetch((call) => {
      if (call.method === "POST" && call.url.endsWith("/records")) return [201, leaveRequest({ version: 0 })];
      if (call.method === "POST") return [200, leaveRequest({ state: "PENDING", version: 1 })];
      return [200, {}];
    });
    const user = userEvent.setup();
    renderAt(<Routes><Route path="/hr/requests/new" element={<LeaveForm mode="new" />} /><Route path="/hr/requests/:id" element={<p>detail</p>} /></Routes>, { path: "/hr/requests/new", state: employee });
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Gửi duyệt" }));
    await screen.findByText("detail");
    const posts = calls.filter((call) => call.method === "POST");
    expect(posts[0]?.url).toBe("/bff/api/v1/apps/hr-leave/entities/leaveRequest/records");
    expect(posts[0]?.body).toMatchObject({ data: { kind: "ANNUAL", startDate: "2026-12-01", days: 3, reason: "Việc gia đình" } });
    expect(posts[1]?.url).toContain("/transitions/submit");
    expect(posts[1]?.body).toEqual({ expectedVersion: 0 });
  });

  it("after an unknown create outcome it reads first, then retries with the SAME id", async () => {
    let posts = 0;
    const calls = mockFetch((call) => {
      if (call.method === "POST") { posts += 1; return undefined; }
      return [404, { status: 404, code: "NOT_FOUND", message: "x", errors: {} }];
    });
    const user = userEvent.setup();
    renderAt(<LeaveForm mode="new" />, { path: "/hr/requests/new", state: employee });
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Lưu nháp" }));
    expect(await screen.findByText("Chưa xác nhận được kết quả")).toBeInTheDocument();
    expect(posts).toBe(1);
    expect(screen.getByLabelText("Số ngày nghỉ")).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Kiểm tra trạng thái" }));
    expect(await screen.findByText(/đơn chưa được tạo/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Gửi lại với cùng mã yêu cầu" }));
    await waitFor(() => expect(posts).toBe(2));
    const sent = calls.filter((call: Call) => call.method === "POST").map((call) => call.body as { id: string });
    expect(sent[0]?.id).toBe(sent[1]?.id);
  });

  it("shows server validation errors next to the field", async () => {
    mockFetch(() => [400, { status: 400, code: "VALIDATION_FAILED", message: "x", errors: { "/reason": "must have at most 500 characters" } }]);
    const user = userEvent.setup();
    renderAt(<LeaveForm mode="new" />, { path: "/hr/requests/new", state: employee });
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Lưu nháp" }));
    expect(await screen.findByText("must have at most 500 characters")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Lý do/)).toHaveAttribute("aria-invalid", "true");
  });
});

function detail(options: { record?: ReturnType<typeof leaveRequest>; actions?: string[]; editable?: boolean; onTransition?: (call: Call) => [number, unknown] | undefined }) {
  const record = options.record ?? leaveRequest({ state: "PENDING", version: 1 });
  return (call: Call): [number, unknown] | undefined => {
    if (call.method === "POST" && call.url.includes("/transitions/")) return options.onTransition?.(call) ?? [200, record];
    if (call.url.endsWith("/workflow")) {
      return [200, { state: record.state, version: record.version, terminal: false, editable: options.editable ?? false, allowedActions: (options.actions ?? []).map((id) => ({ id, to: "X" })) }];
    }
    if (call.url.endsWith("/history")) return [200, [{ action: "CREATE", transitionId: null, fromState: null, toState: "DRAFT", actorId: "u9", actorType: "USER", recordVersion: 0, occurredAt: "2026-11-27T01:00:00Z" }]];
    return [200, record];
  };
}
const renderDetail = (state: ReturnType<typeof sessionState>) =>
  renderAt(<Routes><Route path="/hr/requests/:id" element={<LeaveDetail />} /></Routes>, { path: `/hr/requests/${ID}`, state });

describe("LeaveDetail", () => {
  it("renders exactly the actions the backend allows", async () => {
    mockFetch(detail({ record: leaveRequest({ state: "PENDING", version: 1, createdBy: "someone-else" }), actions: ["approve", "reject"] }));
    renderDetail(manager);
    expect(await screen.findByRole("button", { name: "Phê duyệt" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Từ chối" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Rút đơn" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("self-approval-note")).not.toBeInTheDocument();
  });

  it("explains why a creator who is also a manager cannot decide their own request", async () => {
    mockFetch(detail({ record: leaveRequest({ state: "PENDING", version: 1, createdBy: USER_ID }), actions: ["withdraw"] }));
    renderDetail(employeeManager);
    expect(await screen.findByRole("button", { name: "Rút đơn" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Phê duyệt" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Từ chối" })).not.toBeInTheDocument();
    expect(screen.getByTestId("self-approval-note")).toHaveTextContent(/không thể tự phê duyệt/);
  });

  it("approves with the displayed version and no confirmation", async () => {
    const calls = mockFetch(detail({ record: leaveRequest({ state: "PENDING", version: 3, createdBy: "someone-else" }), actions: ["approve", "reject"] }));
    const user = userEvent.setup();
    renderDetail(manager);
    await user.click(await screen.findByRole("button", { name: "Phê duyệt" }));
    await waitFor(() => expect(calls.some((call) => call.method === "POST")).toBe(true));
    const post = calls.find((call) => call.method === "POST");
    expect(post?.url).toContain("/transitions/approve");
    expect(post?.body).toEqual({ expectedVersion: 3 });
  });

  it("asks for confirmation before rejecting and sends nothing until confirmed", async () => {
    const calls = mockFetch(detail({ record: leaveRequest({ state: "PENDING", version: 1, createdBy: "someone-else" }), actions: ["approve", "reject"] }));
    const user = userEvent.setup();
    renderDetail(manager);
    await user.click(await screen.findByRole("button", { name: "Từ chối" }));
    expect(calls.some((call) => call.method === "POST")).toBe(false);
    expect(document.querySelector("dialog")).toHaveTextContent(/không thể mở lại/);
  });

  it("reports a stale version with a reload action and never retries", async () => {
    const calls = mockFetch(detail({
      record: leaveRequest({ state: "PENDING", version: 4, createdBy: "x" }), actions: ["approve"],
      onTransition: () => [409, { status: 409, code: "VERSION_CONFLICT", message: "x", errors: {} }],
    }));
    const user = userEvent.setup();
    renderDetail(manager);
    await user.click(await screen.findByRole("button", { name: "Phê duyệt" }));
    expect(await screen.findByText(/đã được người khác thay đổi/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tải lại" })).toBeInTheDocument();
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
  });

  it("shows the locked state for a decided request (no edit, no delete)", async () => {
    mockFetch(detail({ record: leaveRequest({ state: "APPROVED", version: 2 }), actions: [], editable: false }));
    renderDetail(employee);
    expect(await screen.findByText("Không có thao tác nào dành cho bạn ở trạng thái này.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Chỉnh sửa/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Xóa/ })).not.toBeInTheDocument();
  });

  it("offers edit and delete for an editable draft the caller owns", async () => {
    mockFetch(detail({ record: leaveRequest({ state: "DRAFT" }), actions: ["submit", "discard"], editable: true }));
    renderDetail(employee);
    expect(await screen.findByRole("link", { name: /Chỉnh sửa/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Xóa/ })).toBeInTheDocument();
  });

  it("shows a not-found page for a hidden or missing request", async () => {
    mockFetch(() => [404, { status: 404, code: "NOT_FOUND", message: "x", errors: {} }]);
    renderDetail(employee);
    expect(await screen.findByText("Không tìm thấy đơn")).toBeInTheDocument();
  });
});

describe("LeaveList", () => {
  const page = (items: ReturnType<typeof leaveRequest>[]) => () => [200, { items, total: items.length, limit: 100, offset: 0 }] as [number, unknown];
  const mine = leaveRequest({ id: "aaaaaaaa-0000-4000-8000-000000000001", createdBy: USER_ID, state: "PENDING" });
  const theirs = leaveRequest({ id: "bbbbbbbb-0000-4000-8000-000000000002", createdBy: "other-user", state: "PENDING", data: { kind: "SICK", startDate: "2026-12-05", days: 1, reason: "Ốm" } });
  const draftOfOther = leaveRequest({ id: "cccccccc-0000-4000-8000-000000000003", createdBy: "other-user", state: "DRAFT" });

  it("'mine' shows only the caller's own records for a user who can read all (employee and manager)", async () => {
    mockFetch(page([mine, theirs, draftOfOther]));
    renderAt(<LeaveList mode="mine" />, { path: "/hr/my-requests", state: employeeManager });
    expect(await screen.findByText("AAAAAAAA")).toBeInTheDocument();
    expect(screen.queryByText("BBBBBBBB")).not.toBeInTheDocument();
    expect(screen.queryByText("CCCCCCCC")).not.toBeInTheDocument();
  });

  it("'approvals' lists pending requests only and marks the caller's own", async () => {
    mockFetch(page([mine, theirs, draftOfOther]));
    renderAt(<LeaveList mode="approvals" />, { path: "/hr/approvals", state: employeeManager });
    expect(await screen.findByText("BBBBBBBB")).toBeInTheDocument();
    expect(screen.getByText("AAAAAAAA")).toBeInTheDocument();
    expect(screen.queryByText("CCCCCCCC")).not.toBeInTheDocument();
    expect(screen.getByText("Bạn")).toBeInTheDocument();
  });

  it("says so when the scan is truncated (no false global statistics)", async () => {
    const many = Array.from({ length: 100 }, (_, i) => leaveRequest({ id: `dddddddd-0000-4000-8000-${String(i).padStart(12, "0")}`, createdBy: "o" }));
    mockFetch(() => [200, { items: many, total: 900, limit: 100, offset: 0 }]);
    renderAt(<LeaveList mode="all" />, { path: "/hr/requests", state: manager });
    expect(await screen.findByText(/có thể thấp hơn thực tế/)).toBeInTheDocument();
  });

  it("shows the empty state for an employee without requests", async () => {
    mockFetch(page([]));
    renderAt(<LeaveList mode="mine" />, { path: "/hr/my-requests", state: employee });
    expect(await screen.findByText("Bạn chưa có đơn nghỉ phép nào.")).toBeInTheDocument();
  });

  it("shows an error with a retry action when loading fails", async () => {
    mockFetch(() => [503, { status: 503, code: "STORE_UNAVAILABLE", message: "x", errors: {} }]);
    renderAt(<LeaveList mode="mine" />, { path: "/hr/my-requests", state: employee });
    expect(await screen.findByRole("button", { name: "Thử lại" })).toBeInTheDocument();
  });
});
