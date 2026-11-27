// SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
// SPDX-License-Identifier: Apache-2.0
import { hrApi } from "../api/client";
import { useHr } from "../auth/AuthContext";
import { leaveStateLabel, leaveTransitionLabel } from "../domain/leave";
import { vi } from "../i18n/vi";
import { AuditLog } from "./Audit";

/** Only reachable when the backend grants the `audit` operation on leave requests (auditors). */
export function LeaveAudit() {
  const { hr } = useHr();
  return (
    <AuditLog
      client={hrApi} entity="leaveRequest" title={vi.hrAudit.title} subtitle={vi.hrAudit.subtitle} filterLabel={vi.hrAudit.filterRecord}
      recordHeader={vi.hrAudit.record} stateName={(state) => leaveStateLabel(hr, state)} transitionName={(id) => leaveTransitionLabel(hr, id)}
      machineLabel={vi.ticket.machine}
    />
  );
}
