// SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
// SPDX-License-Identifier: Apache-2.0
// Shapes of docs/api/openapi-v1.json (Platform API v1) that ESM uses.

export type Localized = Record<string, string>;

export interface AppInfo {
  id: string;
  version: string;
  name: Localized;
  description: Localized;
  callerRoles: string[];
  entities: { key: string; name: Localized }[];
}

export interface WorkflowState {
  id: string;
  name: Localized;
  editable: boolean;
  terminal: boolean;
}

export interface WorkflowTransition {
  id: string;
  from: string;
  to: string;
  name: Localized;
  allowedForCaller: boolean;
  notByCreator: boolean;
}

export interface EntityInfo {
  app: string;
  key: string;
  name: Localized;
  schema: unknown;
  searchFields: string[];
  /** operation (read, create, update, delete, audit) to scope (own, all) for the caller. */
  allowedOperations: Record<string, "own" | "all">;
  workflow: { initialState: string; states: WorkflowState[]; transitions: WorkflowTransition[] } | null;
}

export interface PlatformRecord<T> {
  id: string;
  app: string;
  entity: string;
  data: T;
  version: number;
  state: string | null;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
}

export interface Page<T> {
  items: PlatformRecord<T>[];
  total: number;
  limit: number;
  offset: number;
}

export interface WorkflowInfo {
  state: string;
  version: number;
  terminal: boolean;
  editable: boolean;
  allowedActions: { id: string; to: string }[];
}

export interface HistoryItem {
  action: string;
  transitionId: string | null;
  fromState: string | null;
  toState: string | null;
  actorId: string;
  actorType: "USER" | "MACHINE";
  recordVersion: number;
  occurredAt: string;
}

export interface AuditItem extends HistoryItem {
  eventId: number;
  recordId: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

export interface AuditPage {
  items: AuditItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface Ticket {
  title: string;
  description: string;
  categoryCode: string;
  priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
}

export interface Category {
  code: string;
  name: string;
  description?: string;
  active: boolean;
}
