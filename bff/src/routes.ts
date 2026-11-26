// SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Explicit method/path allowlist for the Platform API v1 (docs/api/openapi-v1.json), limited to ONE application.
 * Anything else, including other applications and `/api/v1/apps`, is not forwarded.
 */
const ENTITY = "[A-Za-z0-9_]{1,63}";
const ID = "[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}";

type Rule = { methods: string[]; pattern: RegExp };

function rules(): Rule[] {
  const entity = `/entities/(${ENTITY})`;
  const record = `${entity}/records/(${ID})`;
  const r = (methods: string[], tail: string): Rule => ({ methods, pattern: new RegExp(`^${tail}$`) });
  return [
    r(["GET"], ""),
    r(["GET"], entity),
    r(["GET", "POST"], `${entity}/records`),
    r(["GET", "PUT", "DELETE"], record),
    r(["GET"], `${record}/workflow`),
    r(["GET"], `${record}/history`),
    r(["POST"], `${record}/transitions/(${ENTITY})`),
    r(["GET"], `${entity}/audit`),
  ];
}

const RULES = rules();
const QUERY_KEYS = new Set(["q", "limit", "offset", "recordId", "expectedVersion"]);

export interface Matched {
  /** Path below /api/v1/apps/{app}. */
  tail: string;
}

export const bffPrefix = (appId: string) => `/bff/api/v1/apps/${appId}`;

/** Returns the allowed tail for `method` and `path`, or null (also null when the method is wrong). */
export function matchRoute(method: string, path: string, appId: string): Matched | null {
  const prefix = bffPrefix(appId);
  if (!path.startsWith(prefix)) return null;
  const tail = path.slice(prefix.length);
  for (const rule of RULES) {
    if (rule.pattern.test(tail)) return rule.methods.includes(method) ? { tail } : null;
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
