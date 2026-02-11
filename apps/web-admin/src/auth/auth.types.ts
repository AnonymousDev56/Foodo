export type Role = "Customer" | "Courier" | "Admin";

export interface AuthUser {
  id: string;
  email: string;
  role: Role;
  name?: string;
  isEmailVerified?: boolean;
  emailVerifiedAt?: string | null;
}

export interface AuthResponse {
  accessToken: string;
  user: AuthUser;
}

export interface LoginPayload {
  email: string;
  password: string;
}

export interface UpdateProfilePayload {
  name: string;
}

export interface UpdatePasswordPayload {
  currentPassword: string;
  newPassword: string;
}
