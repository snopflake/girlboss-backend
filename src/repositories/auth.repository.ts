import { createSupabaseUserClient } from "../config/supabase.js";
import { applicationRoles, type ApplicationRole, type AuthenticatedUser } from "../types/auth.types.js";
import type { LoginInput, RegisterInput } from "../validators/auth.validator.js";
import { HttpError } from "../utils/httpError.js";

export interface LoginSession {
  user: AuthenticatedUser;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface AuthRepositoryContract {
  signUp(input: RegisterInput): Promise<void>;
  signIn(input: LoginInput): Promise<LoginSession>;
  getAuthenticatedUser(accessToken: string): Promise<AuthenticatedUser | null>;
  getProfile(
    accessToken: string,
    user: AuthenticatedUser,
  ): Promise<Record<string, string | null>>;
}

interface ApplicationUserRow {
  id: string;
  fullName: string;
  accountStatus: string;
  role: ApplicationRole;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getErrorCode(error: unknown): string | undefined {
  return isRecord(error) && typeof error.code === "string" ? error.code : undefined;
}

function getErrorStatus(error: unknown): number | undefined {
  return isRecord(error) && typeof error.status === "number" ? error.status : undefined;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "";
}

function toApplicationUserRow(value: unknown): ApplicationUserRow | null {
  if (!isRecord(value)) {
    return null;
  }

  const roleValue = Array.isArray(value.roles) ? value.roles[0] : value.roles;
  if (
    typeof value.id !== "string" ||
    typeof value.full_name !== "string" ||
    typeof value.account_status !== "string" ||
    !isRecord(roleValue) ||
    typeof roleValue.role_name !== "string" ||
    !applicationRoles.includes(roleValue.role_name as ApplicationRole)
  ) {
    return null;
  }

  return {
    id: value.id,
    fullName: value.full_name,
    accountStatus: value.account_status,
    role: roleValue.role_name as ApplicationRole,
  };
}

function toSafeProfile(value: unknown): Record<string, string | null> {
  if (!isRecord(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string | null] =>
        typeof entry[1] === "string" || entry[1] === null,
    ),
  );
}

export class SupabaseAuthRepository implements AuthRepositoryContract {
  async signUp(input: RegisterInput): Promise<void> {
    try {
      const { data, error } = await createSupabaseUserClient().auth.signUp({
        email: input.email,
        password: input.password,
        options: {
          data: {
            full_name: input.fullName,
            account_type: input.accountType,
            ...(input.accountType === "COMPANY"
              ? { company_name: input.companyName }
              : {}),
          },
        },
      });

      if (error) {
        const code = getErrorCode(error);
        const message = getErrorMessage(error);
        if (
          code === "user_already_exists" ||
          /already registered|already exists/i.test(message)
        ) {
          return;
        }
        throw new HttpError(503, "Pendaftaran belum dapat diproses. Silakan coba kembali.");
      }

      if (!data.user) {
        throw new HttpError(503, "Pendaftaran belum dapat diproses. Silakan coba kembali.");
      }
    } catch (error) {
      if (error instanceof HttpError) {
        throw error;
      }
      throw new HttpError(503, "Layanan pendaftaran sedang tidak tersedia.");
    }
  }

  async signIn(input: LoginInput): Promise<LoginSession> {
    try {
      const { data, error } = await createSupabaseUserClient().auth.signInWithPassword({
        email: input.email,
        password: input.password,
      });

      if (error) {
        if (getErrorCode(error) === "email_not_confirmed") {
          throw new HttpError(403, "Email belum diverifikasi.");
        }
        if (getErrorStatus(error) === 400 || getErrorStatus(error) === 401) {
          throw new HttpError(401, "Email atau password salah.");
        }
        throw new HttpError(503, "Layanan autentikasi sedang tidak tersedia.");
      }

      if (!data.session || !data.user?.email) {
        throw new HttpError(403, "Email belum diverifikasi.");
      }

      const applicationUser = await this.getApplicationUser(
        data.user.id,
        data.session.access_token,
      );
      if (!applicationUser) {
        throw new HttpError(401, "Email atau password salah.");
      }

      const user = {
        ...applicationUser,
        email: data.user.email,
      };
      this.assertAccountActive(user);

      return {
        user,
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        expiresIn: data.session.expires_in,
      };
    } catch (error) {
      if (error instanceof HttpError) {
        throw error;
      }
      throw new HttpError(503, "Layanan autentikasi sedang tidak tersedia.");
    }
  }

  async getAuthenticatedUser(accessToken: string): Promise<AuthenticatedUser | null> {
    try {
      const { data, error } = await createSupabaseUserClient().auth.getUser(accessToken);
      if (error) {
        const status = getErrorStatus(error);
        if (status !== undefined && status < 500) {
          return null;
        }
        throw new HttpError(503, "Layanan autentikasi sedang tidak tersedia.");
      }
      if (!data.user?.email) {
        return null;
      }

      const applicationUser = await this.getApplicationUser(data.user.id, accessToken);
      if (!applicationUser) {
        return null;
      }

      const user = { ...applicationUser, email: data.user.email };
      this.assertAccountActive(user);
      return user;
    } catch (error) {
      if (error instanceof HttpError) {
        throw error;
      }
      throw new HttpError(503, "Layanan autentikasi sedang tidak tersedia.");
    }
  }

  async getProfile(
    accessToken: string,
    user: AuthenticatedUser,
  ): Promise<Record<string, string | null>> {
    if (user.role === "ADMIN") {
      return {};
    }

    const table = user.role === "APPLICANT" ? "applicant_profiles" : "companies";
    const columns =
      user.role === "APPLICANT"
        ? "headline, phone_number, professional_summary"
        : "company_name, industry, verification_status";

    try {
      const { data, error } = await createSupabaseUserClient(accessToken)
        .from(table)
        .select(columns)
        .eq("user_id", user.id)
        .maybeSingle();

      if (error) {
        throw new HttpError(503, "Profil pengguna tidak dapat diambil.");
      }
      return toSafeProfile(data);
    } catch (error) {
      if (error instanceof HttpError) {
        throw error;
      }
      throw new HttpError(503, "Profil pengguna tidak dapat diambil.");
    }
  }

  private async getApplicationUser(
    userId: string,
    accessToken: string,
  ): Promise<Omit<AuthenticatedUser, "email"> | null> {
    try {
      const { data, error } = await createSupabaseUserClient(accessToken)
        .from("users")
        .select("id, full_name, account_status, roles:roles(role_name)")
        .eq("id", userId)
        .maybeSingle();

      if (error) {
        throw new HttpError(503, "Data pengguna tidak dapat diambil.");
      }

      const row = toApplicationUserRow(data);
      if (!row) {
        return null;
      }

      return row;
    } catch (error) {
      if (error instanceof HttpError) {
        throw error;
      }
      throw new HttpError(503, "Data pengguna tidak dapat diambil.");
    }
  }

  private assertAccountActive(user: AuthenticatedUser): void {
    if (user.accountStatus !== "ACTIVE") {
      throw new HttpError(403, "Akun tidak aktif.");
    }
  }
}
