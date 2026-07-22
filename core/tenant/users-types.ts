import type { UserRole } from "./request-context.js";

export interface TenantUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UserCreateInput {
  email: string;
  name: string;
  role: UserRole;
  isActive: boolean;
}

export interface UserPatchChanges {
  email?: string;
  name?: string;
  role?: UserRole;
  isActive?: boolean;
}

export interface UserPatchInput {
  expectedUpdatedAt: string;
  changes: UserPatchChanges;
  changedFields: Array<"email" | "name" | "role" | "is_active">;
}

export interface UserListQuery {
  limit: number;
  cursor?: string;
}

export interface UserCursorBoundary {
  createdAt: string;
  id: string;
}

export interface UserListPage {
  users: TenantUser[];
  next_cursor: string | null;
}
