import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { AttendanceLog, AuditLog, CompanySettings, Employee } from '../types';

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() || '';
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() || '';

export const isSupabaseConfigured = Boolean(
  supabaseUrl &&
    supabaseAnonKey &&
    supabaseUrl.startsWith('http') &&
    !supabaseUrl.includes('your-project') &&
    !supabaseAnonKey.includes('your-anon-key')
);

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

export const ATTENDANCE_BUCKET = 'attendance-photos';

export async function uploadAttendancePhotoToSupabase(
  blob: Blob,
  employeeCode: string,
  action: 'check_in' | 'check_out'
): Promise<string> {
  if (!supabase) {
    throw new Error('Supabase chưa được cấu hình.');
  }

  const timestamp = Date.now();
  const safeCode = employeeCode.replace(/[^a-zA-Z0-9_-]/g, '');
  const filePath = `${safeCode}/${new Date().toISOString().slice(0, 10)}/${action}_${timestamp}.jpg`;

  const { error: uploadError } = await supabase.storage
    .from(ATTENDANCE_BUCKET)
    .upload(filePath, blob, {
      contentType: 'image/jpeg',
      cacheControl: '31536000',
      upsert: false,
    });

  if (uploadError) {
    throw new Error(`Lỗi tải ảnh lên Supabase Storage: ${uploadError.message}`);
  }

  const { data } = supabase.storage.from(ATTENDANCE_BUCKET).getPublicUrl(filePath);
  return data.publicUrl;
}

export async function fetchAllFromSupabase(): Promise<{
  employees: Employee[];
  settings: CompanySettings | null;
  logs: AttendanceLog[];
  auditLogs: AuditLog[];
}> {
  if (!supabase) {
    throw new Error('Supabase chưa được cấu hình.');
  }

  const [empRes, settingsRes, logsRes, auditRes] = await Promise.all([
    supabase.from('employees').select('*').order('employee_code', { ascending: true }),
    supabase.from('company_settings').select('*').limit(1).maybeSingle(),
    supabase.from('attendance_logs').select('*').order('server_timestamp', { ascending: false }).limit(2000),
    supabase.from('audit_logs').select('*').order('edited_at', { ascending: false }).limit(500),
  ]);

  if (empRes.error) throw new Error(`Lỗi đọc bảng employees: ${empRes.error.message}`);
  if (settingsRes.error) throw new Error(`Lỗi đọc bảng company_settings: ${settingsRes.error.message}`);
  if (logsRes.error) throw new Error(`Lỗi đọc bảng attendance_logs: ${logsRes.error.message}`);
  if (auditRes.error) throw new Error(`Lỗi đọc bảng audit_logs: ${auditRes.error.message}`);

  return {
    employees: (empRes.data || []) as Employee[],
    settings: (settingsRes.data as CompanySettings) || null,
    logs: (logsRes.data || []) as AttendanceLog[],
    auditLogs: (auditRes.data || []) as AuditLog[],
  };
}

export const SUPABASE_SETUP_SQL = `-- 1. Bảng cấu hình điểm danh & Geofence
CREATE TABLE IF NOT EXISTS company_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name TEXT NOT NULL DEFAULT 'Sun World Ba Na Hills · Tạp vụ Nhà hàng (Đối tác BNC)',
  office_address TEXT NOT NULL DEFAULT 'Khu du lịch Sun World Ba Na Hills, Hòa Ninh, Hòa Vang, Đà Nẵng',
  latitude DOUBLE PRECISION NOT NULL DEFAULT 15.9977,
  longitude DOUBLE PRECISION NOT NULL DEFAULT 107.9881,
  geofence_radius_m INTEGER NOT NULL DEFAULT 300,
  max_gps_accuracy_m INTEGER NOT NULL DEFAULT 50,
  allow_out_of_office_with_note BOOLEAN NOT NULL DEFAULT true,
  shift_start_time TEXT NOT NULL DEFAULT '08:00',
  shift_end_time TEXT NOT NULL DEFAULT '17:30',
  standard_daily_hours NUMERIC(4,2) NOT NULL DEFAULT 8.0,
  grace_period_minutes INTEGER NOT NULL DEFAULT 10,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Khởi tạo 1 dòng cấu hình mặc định nếu bảng chưa có dữ liệu
INSERT INTO company_settings (
  company_name, office_address, latitude, longitude, geofence_radius_m,
  max_gps_accuracy_m, allow_out_of_office_with_note, shift_start_time,
  shift_end_time, standard_daily_hours, grace_period_minutes
)
SELECT
  'Sun World Ba Na Hills · Tạp vụ Nhà hàng (Đối tác BNC)',
  'Khu du lịch Sun World Ba Na Hills, Hòa Ninh, Hòa Vang, Đà Nẵng',
  15.9977, 107.9881, 300, 50, true, '08:00', '17:30', 8.0, 10
WHERE NOT EXISTS (SELECT 1 FROM company_settings);

-- 2. Bảng nhân sự & đơn giá lương
CREATE TABLE IF NOT EXISTS employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_code TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  department TEXT NOT NULL,
  position TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('employee', 'admin')) DEFAULT 'employee',
  pin_code TEXT NOT NULL,
  pay_type TEXT NOT NULL CHECK (pay_type IN ('hourly', 'daily')) DEFAULT 'hourly',
  base_rate_vnd INTEGER NOT NULL DEFAULT 65000,
  ot_multiplier NUMERIC(3,2) NOT NULL DEFAULT 1.50,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Bảng dữ liệu chấm công chống giả mạo (server_timestamp dùng DEFAULT now() làm chuẩn pháp lý)
CREATE TABLE IF NOT EXISTS attendance_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID REFERENCES employees(id) ON DELETE RESTRICT,
  employee_code TEXT NOT NULL,
  employee_name TEXT NOT NULL,
  department TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('check_in', 'check_out')),
  server_timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  device_timestamp TIMESTAMPTZ NOT NULL,
  clock_drift_seconds INTEGER NOT NULL DEFAULT 0,
  clock_tamper_flag BOOLEAN NOT NULL DEFAULT false,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  gps_accuracy_m DOUBLE PRECISION NOT NULL,
  distance_to_office_m DOUBLE PRECISION NOT NULL,
  geofence_status TEXT NOT NULL CHECK (geofence_status IN ('valid', 'out_of_range_noted', 'violation')),
  address_text TEXT NOT NULL DEFAULT '',
  photo_url TEXT NOT NULL,
  integrity_hash TEXT NOT NULL,
  device_info TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  is_adjusted BOOLEAN NOT NULL DEFAULT false,
  adjusted_by TEXT
);

-- 4. Bảng Audit Log bất biến (Không cho phép xóa lịch sử)
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  edited_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  admin_id TEXT NOT NULL,
  admin_name TEXT NOT NULL,
  target_record_id TEXT NOT NULL,
  target_employee_name TEXT NOT NULL DEFAULT '',
  old_value TEXT NOT NULL,
  new_value TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (char_length(trim(reason)) >= 5)
);

-- 5. Khởi tạo Storage Bucket lưu ảnh xác thực chấm công
INSERT INTO storage.buckets (id, name, public)
VALUES ('attendance-photos', 'attendance-photos', true)
ON CONFLICT (id) DO NOTHING;

-- 6. Bật RLS và tạo policy mẫu cho môi trường nội bộ
ALTER TABLE company_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow read all" ON company_settings FOR SELECT USING (true);
CREATE POLICY "Allow update all" ON company_settings FOR UPDATE USING (true);
CREATE POLICY "Allow insert all" ON company_settings FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow read employees" ON employees FOR SELECT USING (true);
CREATE POLICY "Allow write employees" ON employees FOR ALL USING (true);

CREATE POLICY "Allow read logs" ON attendance_logs FOR SELECT USING (true);
CREATE POLICY "Allow insert logs" ON attendance_logs FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow update logs" ON attendance_logs FOR UPDATE USING (true);
-- Không cấp DELETE policy trên attendance_logs để bảo đảm tính toàn vẹn pháp lý!

CREATE POLICY "Allow read audit" ON audit_logs FOR SELECT USING (true);
CREATE POLICY "Allow insert audit" ON audit_logs FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow public read photos" ON storage.objects FOR SELECT USING (bucket_id = 'attendance-photos');
CREATE POLICY "Allow upload photos" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'attendance-photos');
`;
