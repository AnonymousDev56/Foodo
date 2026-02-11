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

export interface RegisterPayload {
  email: string;
  password: string;
  role?: Role;
  name?: string;
}

export interface SignupPayload {
  email: string;
  password: string;
  name: string;
}

export interface SignupResponse {
  userId: string;
  email: string;
  role: Role;
  verificationRequired: boolean;
  devVerificationCode?: string;
}

export interface ResendVerificationPayload {
  email: string;
}

export interface VerifyEmailCodePayload {
  email: string;
  code: string;
}

export interface UpdateProfilePayload {
  name: string;
}

export interface UpdatePasswordPayload {
  currentPassword: string;
  newPassword: string;
}
