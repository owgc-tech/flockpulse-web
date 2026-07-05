export interface FounderRegistrationInput {
  communityName: string;
  firstName: string;
  lastName: string;
  gender: string;
  maritalStatus: string;
  birthdate: string;
  email: string;
  password: string;
}

export interface FounderRegistrationResult {
  tenantId: string;
  memberId: string;
}
