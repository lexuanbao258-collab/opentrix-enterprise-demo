// SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Explicit allowlist for the Platform API v1 (docs/api/openapi-v1.json): the applications, entities and workflow
 * transitions that ESM modules use, and the method/path shapes of the contract. Anything else, including other
 * applications, is not forwarded. Adding an ESM module means adding its entry here.
 */
export const ALLOWED_APPS: Record<string, { entities: string[]; transitions: string[] }> = {
  "it-helpdesk": {
    entities: ["category", "ticket"],
    transitions: ["submit", "discard", "cancel", "start", "resolve", "confirm", "reopen"],
  },
  "hr-leave": {
    entities: ["leaveRequest"],
    transitions: ["submit", "discard", "withdraw", "approve", "reject"],
  },
};

const ID = "[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}";

type Rule = { methods: string[]; pattern: RegExp };

function rulesFor(entities: string[], transitions: string[]): Rule[] {
  const entity = `/entities/(?:${entities.join("|")})`;
  const record = `${entity}/records/${ID}`;
  const r = (methods: string[], tail: string): Rule => ({ methods, pattern: new RegExp(`^${tail}$`) });
  return [
    r(["GET"], ""),
    r(["GET"], entity),
    r(["GET", "POST"], `${entity}/records`),
    r(["GET", "PUT", "DELETE"], record),
    r(["GET"], `${record}/workflow`),
    r(["GET"], `${record}/history`),
    r(["POST"], `${record}/transitions/(?:${transitions.join("|")})`),
    r(["GET"], `${entity}/audit`),
  ];
}

const RULES = new Map(Object.entries(ALLOWED_APPS).map(([app, spec]) => [app, rulesFor(spec.entities, spec.transitions)]));
const QUERY_KEYS = new Set(["q", "limit", "offset", "recordId", "expectedVersion"]);

export interface Matched {
  /** Platform path below /api/v1/apps (empty string = the discovery list). */
  upstream: string;
}

const PREFIX = "/bff/api/v1/apps";

/** Returns the Platform path for `method` and `path`, or null (also null when the method is wrong). */
export function matchRoute(method: string, path: string): Matched | null {
  if (path === PREFIX) return method === "GET" ? { upstream: "" } : null; // discovery: apps the caller holds a role in
  const app = /^\/bff\/api\/v1\/apps\/([a-z0-9-]+)(\/.*)?$/.exec(path);
  const rules = app?.[1] ? RULES.get(app[1]) : undefined;
  if (!app || !rules) return null;
  const tail = app[2] ?? "";
  for (const rule of rules) {
    if (rule.pattern.test(tail)) return rule.methods.includes(method) ? { upstream: `/${app[1]}${tail}` } : null;
  }
  return null;
}

/** Forward only the query keys the contract defines. */
export function cleanQuery(query: URLSearchParams): string {
  const out = new URLSearchParams();
  for (const [key, value] of query) {
    if (QUERY_KEYS.has(key) && value.length <= 200) out.append(key, value);
  }
  const text = out.toString();
  return text ? `?${text}` : "";
}
