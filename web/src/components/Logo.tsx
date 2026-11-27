// SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
// SPDX-License-Identifier: Apache-2.0

/** OpenTrix mark: a ring (the "O" of OpenTrix, a process loop) around a solid core. Decorative; the product name sits beside it. */
export function Logo({ size = 36, className = "brand-logo" }: { size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="8" fill="#2f55c9" />
      <circle cx="16" cy="16" r="8" fill="none" stroke="#fff" strokeWidth="3.2" />
      <circle cx="16" cy="16" r="2.6" fill="#c3d1fa" />
    </svg>
  );
}
