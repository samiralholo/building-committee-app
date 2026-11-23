export type PaymentStatus = 'unpaid' | 'partial' | 'paid' | 'exempt';
export type CycleType = 'monthly' | 'special';
export type ExpenseCategory = 'electricity' | 'water' | 'elevator' | 'cleaning' | 'maintenance' | 'general';

export interface EmergencyContact {
  name: string;
  role: string;
  phone: string;
}

export interface Building {
  id: string;
  slug: string;
  owner_id: string;
  name: string;
  currency: string;
  default_monthly_fee: number;
  hide_resident_names: boolean;
  announcement: string | null;
  announcement_updated_at: string | null;
  emergency_contacts: EmergencyContact[];
  created_at: string;
}

export interface Unit {
  id: string;
  building_id: string;
  label: string;
  floor: number;
  sort_order: number;
  resident_name: string;
  whatsapp_phone: string | null;
  is_occupied: boolean;
  created_at: string;
}

export interface BillingCycle {
  id: string;
  building_id?: string;
  title: string;
  cycle_type: CycleType;
  default_amount: number;
  cycle_date: string;
  created_at: string;
}

export interface Payment {
  id: string;
  building_id?: string;
  cycle_id: string;
  unit_id: string;
  amount_due: number;
  amount_paid: number;
  status: PaymentStatus;
  paid_at: string | null;
  notes?: string | null;
  updated_at?: string;
}

export interface Expense {
  id: string;
  building_id?: string;
  cycle_id: string | null;
  title: string;
  category: ExpenseCategory;
  amount: number;
  expense_date: string;
  receipt_url: string | null;
  notes: string | null;
  created_at?: string;
}

/** Shape returned by the `get_public_building_dashboard` RPC (no phone numbers). */
export interface PublicUnit {
  id: string;
  label: string;
  floor: number;
  sort_order: number;
  is_occupied: boolean;
  display_name: string;
  total_arrears: number;
}

export interface PublicDashboard {
  building: Pick<
    Building,
    'name' | 'slug' | 'currency' | 'announcement' | 'announcement_updated_at' | 'emergency_contacts' | 'hide_resident_names'
  >;
  stats: {
    total_collected: number;
    total_expenses: number;
    fund_balance: number;
    last_updated: string | null;
  };
  cycles: BillingCycle[];
  units: PublicUnit[];
  payments: Payment[];
  expenses: Expense[];
}
