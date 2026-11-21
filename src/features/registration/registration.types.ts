export type Gender = 'MALE' | 'FEMALE';
export type MaritalStatus = 'SINGLE' | 'MARRIED';

export interface CompleteRegistrationInput {
  firstName: string;
  lastName: string;
  gender: Gender;
  maritalStatus: MaritalStatus;
  confirmAdult: boolean; // FP-254: "I confirm I am 18 or older."
  acceptTerms: boolean;  // FP-254: "I accept the Terms of Service and the Privacy Policy."
}

export interface RegistrationResult {
  memberId: string;
  tenantId: string;
  role: string;
  groupId: string | null;
}
