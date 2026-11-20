export type UserRole = 'employee' | 'admin';

export type AttendanceAction = 'check_in' | 'check_out';

export type GeofenceStatus = 'valid' | 'out_of_range_noted' | 'violation';

export type PayType = 'hourly' | 'daily';

export type DateRangePreset = 'today' | 'week' | 'month' | 'custom';

export interface Employee {
  id: string;
  employee_code: string;
  full_name: string;
  email: string;
  department: string;
  position: string;
  role: UserRole;
  pin_code: string;
  pay_type: PayType;
  base_rate_vnd: number;
  ot_multiplier: number;
  is_active: boolean;
  created_at: string;
}

export interface CompanySettings {
  id: string;
  company_name: string;
  office_address: string;
  latitude: number;
  longitude: number;
  geofence_radius_m: number;
  max_gps_accuracy_m: number;
  allow_out_of_office_with_note: boolean;
  shift_start_time: string; // HH:mm e.g. "08:00"
  shift_end_time: string;   // HH:mm e.g. "17:30"
  standard_daily_hours: number; // e.g. 8
  grace_period_minutes: number; // e.g. 10
  updated_at: string;
}

export interface AttendanceLog {
  id: string;
  employee_id: string;
  employee_code: string;
  employee_name: string;
  department: string;
  action: AttendanceAction;
  server_timestamp: string;
  device_timestamp: string;
  clock_drift_seconds: number;
  clock_tamper_flag: boolean;
  latitude: number;
  longitude: number;
  gps_accuracy_m: number;
  distance_to_office_m: number;
  geofence_status: GeofenceStatus;
  address_text: string;
  photo_url: string;
  integrity_hash: string;
  device_info: string;
  note: string;
  is_adjusted?: boolean;
  adjusted_by?: string;
}

export interface AuditLog {
  id: string;
  edited_at: string;
  admin_id: string;
  admin_name: string;
  target_record_id: string;
  target_employee_name: string;
  old_value: string;
  new_value: string;
  reason: string;
}

export interface PayrollSummaryRow {
  employee: Employee;
  totalShifts: number;
  totalWorkHours: number;
  lateMinutes: number;
  overtimeHours: number;
  laborCostVnd: number;
  hasActiveShift: boolean;
}
