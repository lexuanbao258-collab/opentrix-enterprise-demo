// SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
// SPDX-License-Identifier: Apache-2.0
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

export interface RecordRow { id: string; to: string; title: string; meta: string; badges: ReactNode }

/** Compact list of records for dashboards. Shared by every module. */
export function RecordList({ rows }: { rows: RecordRow[] }) {
  return (
    <ul className="recent-list">
      {rows.map((row) => (
        <li key={row.id}>
          <div className="recent-main">
            <Link to={row.to}>{row.title}</Link>
            <span className="muted">{row.meta}</span>
          </div>
          <div className="recent-badges">{row.badges}</div>
        </li>
      ))}
    </ul>
  );
}
