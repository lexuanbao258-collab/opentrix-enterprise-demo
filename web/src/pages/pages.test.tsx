// SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
// SPDX-License-Identifier: Apache-2.0
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { configureClient } from "../api/client";
import { App } from "../App";
import { AGENT_OPS, REQUESTER_OPS, mockFetch, readyState, renderAt, ticket, type Call } from "../test/fixtures";
import { TicketDetail } from "./TicketDetail";
import { TicketForm } from "./TicketForm";

const ID = "11111111-1111-4111-8111-111111111111";
beforeEach(() => configureClient({ csrf: "csrf", onSessionExpired: () => undefined }));

async function fillForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Tiêu đề"), "Máy in hết mực");
  await user.selectOptions(screen.getByLabelText("Danh mục"), "NETWORK");
  await user.type(screen.getByLabelText("Mô tả chi tiết"), "Máy in tầng 2 không in được");
}

describe("TicketForm", () => {
  it("shows only active categories and blocks an empty submit without calling the API", async () => {
    const calls = mockFetch(() => [200, {}]);
    const user = userEvent.setup();
    renderAt(<TicketForm mode="new" />, { path: "/tickets/new" });
    expect(screen.getByRole("option", { name: "Mạng và VPN" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Cũ" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Lưu nháp" }));
    expect(screen.getAllByText("Bắt buộc nhập").length).toBeGreaterThanOrEqual(3);
    expect(calls).toHaveLength(0);
  });

  it("after an unknown create outcome it reads first, then retries with the SAME id", async () => {
    let posts = 0;
    const calls = mockFetch((call) => {
      if (call.method === "POST") {
        posts += 1;
        return undefined; // connection lost after the request was sent
      }
      return [404, { status: 404, code: "NOT_FOUND", message: "x", errors: {} }]; // the read shows it was not created
    });
    const user = userEvent.setup();
    renderAt(<TicketForm mode="new" />, { path: "/tickets/new" });
    await fillForm(user);
    await user.click(screen.getByRole("button", { name: "Lưu nháp" }));
    expect(await screen.findByText("Chưa xác nhận được kết quả")).toBeInTheDocument();
    expect(posts).toBe(1); // never repeated automatically
    expect(screen.getByLabelText("Tiêu đề")).toBeDisabled(); // payload cannot drift between attempts

    await user.click(screen.getByRole("button", { name: "Kiểm tra trạng thái" }));
    expect(await screen.findByText(/phiếu chưa được tạo/)).toBeInTheDocument();
    expect(posts).toBe(1);
    await user.click(screen.getByRole("button", { name: "Gửi lại với cùng mã yêu cầu" }));
    await waitFor(() => expect(posts).toBe(2));
    const sent = calls.filter((call: Call) => call.method === "POST").map((call) => call.body as { id: string; data: unknown });
    expect(sent[0]?.id).toBe(sent[1]?.id);
    expect(sent[0]?.data).toEqual(sent[1]?.data);
    expect(calls.find((call) => call.method === "GET")?.url).toContain(`/records/${sent[0]?.id}`);
  });

  it("shows server validation errors next to the fields", async () => {
    mockFetch(() => [400, { status: 400, code: "VALIDATION_FAILED", message: "x", errors: { "/title": "must have at most 200 characters" } }]);
    const user = userEvent.setup();
    renderAt(<TicketForm mode="new" />, { path: "/tickets/new" });
    await fillForm(user);
    await user.click(screen.getByRole("button", { name: "Lưu nháp" }));
    expect(await screen.findByText("must have at most 200 characters")).toBeInTheDocument();
    expect(screen.getByLabelText("Tiêu đề")).toHaveAttribute("aria-invalid", "true");
  });
});

function detailHandlers(options: { record?: ReturnType<typeof ticket>; actions?: string[]; editable?: boolean; onTransition?: (call: Call) => [number, unknown] | undefined }) {
  const record = options.record ?? ticket({ state: "SUBMITTED", version: 1 });
  return (call: Call): [number, unknown] | undefined => {
    if (call.method === "POST" && call.url.includes("/transitions/")) return options.onTransition?.(call) ?? [200, record];
    if (call.url.endsWith("/workflow")) {
      return [200, { state: record.state, version: record.version, terminal: false, editable: options.editable ?? false,
        allowedActions: (options.actions ?? []).map((id) => ({ id, to: "X" })) }];
    }
    if (call.url.endsWith("/history")) return [200, [{ action: "CREATE", transitionId: null, fromState: null, toState: "DRAFT", actorId: "u1", actorType: "USER", recordVersion: 0, occurredAt: "2026-11-27T01:00:00Z" }]];
    return [200, record];
  };
}

const renderDetail = (ops: Record<string, "own" | "all">, roles: string[]) =>
  renderAt(<Routes><Route path="/tickets/:id" element={<TicketDetail />} /></Routes>, { path: `/tickets/${ID}`, state: readyState(ops, roles) });

describe("TicketDetail", () => {
  it("renders exactly the actions the backend allows, not those the manifest merely declares", async () => {
    mockFetch(detailHandlers({ actions: ["cancel"] }));
    renderDetail(REQUESTER_OPS, ["requester"]);
    expect(await screen.findByRole("button", { name: "Hủy yêu cầu" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Tiếp nhận xử lý" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Chỉnh sửa/ })).not.toBeInTheDocument(); // locked state
    expect(screen.getByText("Lịch sử xử lý")).toBeInTheDocument();
  });

  it("offers edit and delete only for an editable record the caller may change", async () => {
    mockFetch(detailHandlers({ record: ticket({ state: "DRAFT" }), actions: ["submit", "discard"], editable: true }));
    renderDetail(REQUESTER_OPS, ["requester"]);
    expect(await screen.findByRole("link", { name: /Chỉnh sửa/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Xóa/ })).toBeInTheDocument();
  });

  it("hides edit and delete from staff who lack the grant, even when the record is editable", async () => {
    mockFetch(detailHandlers({ record: ticket({ state: "DRAFT" }), actions: [], editable: true }));
    renderDetail(AGENT_OPS, ["agent"]);
    expect(await screen.findByRole("heading", { level: 1, name: "VPN lỗi" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Chỉnh sửa/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Xóa/ })).not.toBeInTheDocument();
  });

  it("sends the displayed version and reports a conflict with a reload action", async () => {
    const calls = mockFetch(detailHandlers({
      actions: ["start"], record: ticket({ state: "SUBMITTED", version: 4 }),
      onTransition: () => [409, { status: 409, code: "VERSION_CONFLICT", message: "x", errors: {} }],
    }));
    const user = userEvent.setup();
    renderDetail(AGENT_OPS, ["agent"]);
    await user.click(await screen.findByRole("button", { name: "Tiếp nhận xử lý" }));
    expect(await screen.findByText(/đã được người khác thay đổi/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tải lại" })).toBeInTheDocument();
    expect(calls.find((call) => call.method === "POST")?.body).toEqual({ expectedVersion: 4 });
  });

  it("on an unknown transition outcome it blocks further actions and reconciles by reading", async () => {
    let transitions = 0;
    let current = ticket({ state: "SUBMITTED", version: 1 });
    mockFetch((call) => {
      if (call.method === "POST") {
        transitions += 1;
        return undefined;
      }
      return detailHandlers({ record: current, actions: ["start"] })(call);
    });
    const user = userEvent.setup();
    renderDetail(AGENT_OPS, ["agent"]);
    await user.click(await screen.findByRole("button", { name: "Tiếp nhận xử lý" }));
    expect(await screen.findByText("Chưa xác nhận được kết quả")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tiếp nhận xử lý" })).toBeDisabled();
    expect(transitions).toBe(1);
    current = ticket({ state: "IN_PROGRESS", version: 2 }); // the commit did happen
    await user.click(screen.getByRole("button", { name: "Kiểm tra trạng thái" }));
    expect(await screen.findByText(/thao tác đã được ghi nhận/)).toBeInTheDocument();
    expect(transitions).toBe(1);
  });

  it("shows a not-found page for a hidden or missing ticket", async () => {
    mockFetch(() => [404, { status: 404, code: "NOT_FOUND", message: "x", errors: {} }]);
    renderDetail(REQUESTER_OPS, ["requester"]);
    expect(await screen.findByText("Không tìm thấy phiếu")).toBeInTheDocument();
  });
});

describe("App shell", () => {
  it("keeps the page mounted and shows the sign-in dialog when the session ended (regression)", () => {
    mockFetch(() => [200, { items: [], total: 0, limit: 100, offset: 0 }]);
    renderAt(<App />, { path: "/", state: readyState(REQUESTER_OPS, ["requester"], true) });
    const dialog = screen.getByRole("alertdialog", { name: "Phiên đăng nhập đã hết hạn" });
    expect(within(dialog).getByRole("button", { name: "Đăng nhập" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Điều hướng chính" })).toBeInTheDocument();
  });

  it("refuses routes the backend does not grant (agent cannot open the create form)", async () => {
    mockFetch(() => [200, { items: [], total: 0, limit: 100, offset: 0 }]);
    renderAt(<App />, { path: "/tickets/new", state: readyState(AGENT_OPS, ["agent"]) });
    expect(await screen.findByText("Không có quyền truy cập")).toBeInTheDocument();
  });
});
