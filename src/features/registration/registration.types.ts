export type Gender = 'MALE' | 'FEMALE';
export type MaritalStatus = 'SINGLE' | 'MARRIED';

export interface CompleteRegistrationInput {
  firstName: string;
  lastName: string;
  gender: Gender;
  maritalStatus: MaritalStatus;
  birthdate: string; // ISO date string YYYY-MM-DD
}

export interface RegistrationResult {
  memberId: string;
  tenantId: string;
  role: string;
  groupId: string | null;
}
