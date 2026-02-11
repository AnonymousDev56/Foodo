export const ROLES = ["Customer", "Courier", "Admin"] as const;

export type Role = (typeof ROLES)[number];
