// SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
// SPDX-License-Identifier: Apache-2.0
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi as spy } from "vitest";
import { ActionPanel, StatusBanner } from "./Detail";

const label = (id: string) => ({ approve: "Phê duyệt", reject: "Từ chối", withdraw: "Rút đơn" })[id] ?? id;

describe("ActionPanel", () => {
  it("renders only the offered actions, keeps ending actions apart and never makes them primary", async () => {
    const onAction = spy.fn();
    render(
      <ActionPanel actions={[{ id: "approve" }, { id: "reject" }]} ending={new Set(["reject", "withdraw"])} labelOf={label} busy={null} locked={false} emptyText="Không có" onAction={onAction} />,
    );
    expect(screen.getByRole("button", { name: "Phê duyệt" })).toHaveClass("btn-primary");
    expect(screen.getByRole("button", { name: "Từ chối" })).toHaveClass("btn-danger");
    expect(screen.getByRole("button", { name: "Từ chối" })).not.toHaveClass("btn-primary");
    expect(screen.queryByRole("button", { name: "Rút đơn" })).not.toBeInTheDocument(); // not in allowedActions: never rendered
    await userEvent.click(screen.getByRole("button", { name: "Từ chối" }));
    expect(onAction).toHaveBeenCalledWith("reject");
  });

  it("shows the empty text and no delete control when nothing is allowed", () => {
    render(<ActionPanel actions={[]} ending={new Set()} labelOf={label} busy={null} locked={false} emptyText="Không có thao tác" onAction={() => undefined} />);
    expect(screen.getByText("Không có thao tác")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Xóa" })).not.toBeInTheDocument();
  });

  it("disables every action while a request is in flight or its outcome is unknown", () => {
    render(<ActionPanel actions={[{ id: "approve" }, { id: "reject" }]} ending={new Set(["reject"])} labelOf={label} busy="approve" locked={false} emptyText="" onAction={() => undefined} />);
    expect(screen.getByRole("button", { name: "Từ chối" })).toBeDisabled();
  });
});

describe("StatusBanner", () => {
  it("shows the state and its hint", () => {
    render(<StatusBanner state="PENDING" label="Chờ duyệt" hint="Đang chờ quản lý." />);
    expect(screen.getByTestId("status-banner")).toHaveTextContent("Chờ duyệt");
    expect(screen.getByTestId("status-banner")).toHaveTextContent("Đang chờ quản lý.");
  });
});
