export const applicationRoles = ["APPLICANT", "COMPANY", "ADMIN"] as const;

export type ApplicationRole = (typeof applicationRoles)[number];
export type AccountStatus = string;

export interface AuthenticatedUser {
  id: string;
  email: string;
  fullName: string;
  role: ApplicationRole;
  accountStatus: AccountStatus;
}

export interface AuthRequestContext {
  user: AuthenticatedUser;
  accessToken: string;
}

export interface CurrentUserData extends AuthenticatedUser {
  profile: Record<string, string | null>;
}

declare module "express-serve-static-core" {
  interface Request {
    authContext?: AuthRequestContext;
  }
}
