export interface NewPayment {
  bookingId: string;
  idempotencyKey: string;
  method: string;
  amount: number;
  currency: "THB";
  expiresAt: Date;
  mockRef: string;
  createdAt: Date;
}

export interface PaymentRecord {
  id: string;
  method: string;
  status: string;
  amount: number;
  currency: string;
  expiresAt: Date;
  mockRef: string;
}

export interface PaymentMethodResponse {
  method: string;
  next: string;
}

export interface StartPaymentResponse {
  paymentId: string;
  status: "PENDING";
  amount: number;
  currency: string;
  expiresAt: string;
  mockRef: string;
}
