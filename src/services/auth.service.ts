import type { AuthRepositoryContract, LoginSession } from "../repositories/auth.repository.js";
import type { AuthenticatedUser, CurrentUserData } from "../types/auth.types.js";
import type { LoginInput, RegisterInput } from "../validators/auth.validator.js";
import { HttpError } from "../utils/httpError.js";

export interface AuthServiceContract {
  register(input: RegisterInput): Promise<void>;
  login(input: LoginInput): Promise<LoginSession>;
  authenticate(accessToken: string): Promise<AuthenticatedUser>;
  getCurrentUser(
    user: AuthenticatedUser,
    accessToken: string,
  ): Promise<CurrentUserData>;
}

export class AuthService implements AuthServiceContract {
  constructor(private readonly repository: AuthRepositoryContract) {}

  async register(input: RegisterInput): Promise<void> {
    await this.repository.signUp(input);
  }

  async login(input: LoginInput): Promise<LoginSession> {
    return this.repository.signIn(input);
  }

  async authenticate(accessToken: string): Promise<AuthenticatedUser> {
    const user = await this.repository.getAuthenticatedUser(accessToken);
    if (!user) {
      throw new HttpError(401, "Token tidak valid atau telah kedaluwarsa.");
    }
    return user;
  }

  async getCurrentUser(
    user: AuthenticatedUser,
    accessToken: string,
  ): Promise<CurrentUserData> {
    const profile = await this.repository.getProfile(accessToken, user);
    return { ...user, profile };
  }
}
