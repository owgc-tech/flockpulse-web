export interface FounderRegistrationInput {
  communityName: string;
  description: string | null;
  firstName: string;
  lastName: string;
  gender: string;
  maritalStatus: string;
  confirmAdult: boolean;
  acceptTerms: boolean;
  email: string;
  password: string;
}

export interface FounderRegistrationResult {
  tenantId: string;
  memberId: string;
}
