import React, { useCallback, useEffect, useState } from 'react';
import {
  Database,
  LogOut,
  RefreshCw,
} from 'lucide-react';
import {
  AttendanceAction,
  AttendanceLog,
  AuditLog,
  CompanySettings,
  Employee,
  GeofenceStatus,
} from './types';
import {
  createDemoAttendanceLogs,
  createDemoAuditLogs,
  DEMO_COMPANY_SETTINGS,
  DEMO_EMPLOYEES,
} from './data/demoData';
import {
  fetchAllFromSupabase,
  isSupabaseConfigured,
  supabase,
  uploadAttendancePhotoToSupabase,
} from './lib/supabase';
import {
  cleanDisplayName,
  formatDateTimeVN,
  getVNDateKey,
  normalizeFullName,
} from './utils/forensics';
import { LoginScreen } from './components/LoginScreen';
import { EmployeeAttendanceView } from './components/EmployeeAttendanceView';
import { AdminDashboardView } from './components/AdminDashboardView';
import { EvidenceInspectorModal } from './components/EvidenceInspectorModal';
import { ManualAdjustModal } from './components/ManualAdjustModal';
import { SupabaseSetupModal } from './components/SupabaseSetupModal';
import { OfflineIndicator } from './components/PWAInstallButton';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STORAGE_KEYS = {
  employees: 'chamcong_demo_employees_v1',
  settings: 'chamcong_demo_settings_v1',
  logs: 'chamcong_demo_logs_v1',
  audit: 'chamcong_demo_audit_v1',
};

function loadDemoState<T>(key: string, fallback: () => T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw) {
      return JSON.parse(raw) as T;
    }
  } catch {
    // Ignore storage read error
  }
  return fallback();
}

export default function App() {
  const [employees, setEmployees] = useState<Employee[]>(() =>
    isSupabaseConfigured
      ? []
      : loadDemoState(STORAGE_KEYS.employees, () => DEMO_EMPLOYEES)
  );
  const [settings, setSettings] = useState<CompanySettings>(() =>
    isSupabaseConfigured
      ? DEMO_COMPANY_SETTINGS
      : loadDemoState(STORAGE_KEYS.settings, () => DEMO_COMPANY_SETTINGS)
  );
  const [logs, setLogs] = useState<AttendanceLog[]>(() =>
    isSupabaseConfigured
      ? []
      : loadDemoState(STORAGE_KEYS.logs, createDemoAttendanceLogs)
  );
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>(() =>
    isSupabaseConfigured
      ? []
      : loadDemoState(STORAGE_KEYS.audit, createDemoAuditLogs)
  );

  const [currentUser, setCurrentUser] = useState<Employee | null>(null);
  const [employeeInitialTab, setEmployeeInitialTab] = useState<
    'checkin' | 'history' | 'profile'
  >('checkin');
  const [pendingAutoStart, setPendingAutoStart] = useState<AttendanceAction | null>(null);
  const [loadingSupabase, setLoadingSupabase] = useState<boolean>(isSupabaseConfigured);
  const [supabaseError, setSupabaseError] = useState<string>('');

  const [setupModalOpen, setSetupModalOpen] = useState(false);
  const [inspectedLog, setInspectedLog] = useState<AttendanceLog | null>(null);
  const [adjustingLog, setAdjustingLog] = useState<AttendanceLog | null>(null);

  // Persist demo changes locally
  useEffect(() => {
    if (!isSupabaseConfigured) {
      try {
        window.localStorage.setItem(STORAGE_KEYS.employees, JSON.stringify(employees));
        window.localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(settings));
        window.localStorage.setItem(STORAGE_KEYS.logs, JSON.stringify(logs));
        window.localStorage.setItem(STORAGE_KEYS.audit, JSON.stringify(auditLogs));
      } catch {
        // Ignore quota errors
      }
    }
  }, [employees, settings, logs, auditLogs]);

  const loadSupabaseData = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    setLoadingSupabase(true);
    setSupabaseError('');
    try {
      const data = await fetchAllFromSupabase();
      setEmployees(data.employees);
      if (data.settings) setSettings(data.settings);
      setLogs(data.logs);
      setAuditLogs(data.auditLogs);
    } catch (err) {
      setSupabaseError(
        err instanceof Error
          ? err.message
          : 'Không thể tải dữ liệu từ Supabase.'
      );
    } finally {
      setLoadingSupabase(false);
    }
  }, []);

  useEffect(() => {
    if (isSupabaseConfigured) {
      loadSupabaseData();
    }
  }, [loadSupabaseData]);

  const ensureEmployeeExists = async (rawName: string): Promise<Employee> => {
    const cleanName = cleanDisplayName(rawName);
    const normalized = normalizeFullName(cleanName);

    const existing = employees.find(
      (e) => normalizeFullName(e.full_name) === normalized && e.is_active
    );
    if (existing) {
      return existing;
    }

    const nextNum = String(employees.length + 1).padStart(3, '0');
    const slug = normalized
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '.')
      .replace(/^\.+|\.+$/g, '');
    const uniqueSuffix = String(Date.now()).slice(-4);

    const newEmp: Employee = {
      id: `emp-${Date.now()}`,
      employee_code: `NV${nextNum}-${uniqueSuffix}`,
      full_name: cleanName,
      email: `${slug || 'nv'}.${uniqueSuffix}@banahills.vn`,
      department: 'Tạp vụ Nhà hàng',
      position: 'Nhân sự Đối tác (BNC)',
      role: 'employee',
      pin_code: '0000',
      pay_type: 'hourly',
      base_rate_vnd: 65000,
      ot_multiplier: 1.5,
      is_active: true,
      created_at: new Date().toISOString(),
    };

    let createdEmp: Employee = newEmp;
    if (isSupabaseConfigured && supabase) {
      const { id: _ignored, ...rest } = newEmp;
      const { data, error } = await supabase
        .from('employees')
        .insert(rest)
        .select('*')
        .single();
      if (error) {
        throw new Error(`Không thể tạo hồ sơ điểm danh: ${error.message}`);
      }
      createdEmp = data as Employee;
    }

    setEmployees((prev) => [...prev, createdEmp]);
    return createdEmp;
  };

  const handleSubmitAttendance = async (payload: {
    action: AttendanceAction;
    deviceTimestamp: string;
    latitude: number;
    longitude: number;
    gpsAccuracyM: number;
    distanceToOfficeM: number;
    geofenceStatus: GeofenceStatus;
    addressText: string;
    photoBlob: Blob;
    photoDataUrl: string;
    integrityHash: string;
    note: string;
  }): Promise<AttendanceLog> => {
    if (!currentUser) {
      throw new Error('Phiên đăng nhập đã hết hạn.');
    }

    // If user entered via read-only name lookup and now checks in/out, materialize real employee record first
    let activeEmp = currentUser;
    if (currentUser.id === 'lookup-temp' || currentUser.employee_code === 'TRA-CUU') {
      activeEmp = await ensureEmployeeExists(currentUser.full_name);
      setCurrentUser(activeEmp);
    }

    const deviceInfo =
      typeof navigator !== 'undefined'
        ? `${navigator.platform || 'Web'} · ${navigator.userAgent.slice(0, 64)}`
        : 'Trình duyệt Web';

    if (isSupabaseConfigured && supabase) {
      // 1. Upload JPEG watermarked photo to Supabase Storage bucket 'attendance-photos'
      const publicPhotoUrl = await uploadAttendancePhotoToSupabase(
        payload.photoBlob,
        activeEmp.employee_code,
        payload.action
      );

      // 2. Insert record WITHOUT server_timestamp so PostgreSQL DEFAULT now() is legal truth
      const insertRow = {
        employee_id: activeEmp.id,
        employee_code: activeEmp.employee_code,
        employee_name: activeEmp.full_name,
        department: activeEmp.department,
        action: payload.action,
        device_timestamp: payload.deviceTimestamp,
        latitude: payload.latitude,
        longitude: payload.longitude,
        gps_accuracy_m: payload.gpsAccuracyM,
        distance_to_office_m: payload.distanceToOfficeM,
        geofence_status: payload.geofenceStatus,
        address_text: payload.addressText,
        photo_url: publicPhotoUrl,
        integrity_hash: payload.integrityHash,
        device_info: deviceInfo,
        note: payload.note,
      };

      const { data: inserted, error: insertError } = await supabase
        .from('attendance_logs')
        .insert(insertRow)
        .select('*')
        .single();

      if (insertError || !inserted) {
        throw new Error(
          `Lỗi ghi dữ liệu chấm công lên máy chủ: ${insertError?.message || 'Không rõ'}`
        );
      }

      const serverMs = new Date(inserted.server_timestamp).getTime();
      const deviceMs = new Date(payload.deviceTimestamp).getTime();
      const driftSec = Math.round(Math.abs(serverMs - deviceMs) / 1000);
      const tamperFlag = driftSec > 60;

      if (driftSec !== inserted.clock_drift_seconds || tamperFlag !== inserted.clock_tamper_flag) {
        await supabase
          .from('attendance_logs')
          .update({
            clock_drift_seconds: driftSec,
            clock_tamper_flag: tamperFlag,
          })
          .eq('id', inserted.id);
      }

      const finalRecord: AttendanceLog = {
        ...(inserted as AttendanceLog),
        clock_drift_seconds: driftSec,
        clock_tamper_flag: tamperFlag,
      };

      setLogs((prev) => [finalRecord, ...prev]);
      return finalRecord;
    }

    // Demo mode insertion (simulates authoritative server timestamp)
    const serverNowIso = new Date().toISOString();
    const serverMs = new Date(serverNowIso).getTime();
    const deviceMs = new Date(payload.deviceTimestamp).getTime();
    const driftSec = Math.round(Math.abs(serverMs - deviceMs) / 1000);

    const newLog: AttendanceLog = {
      id: `CC-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`,
      employee_id: activeEmp.id,
      employee_code: activeEmp.employee_code,
      employee_name: activeEmp.full_name,
      department: activeEmp.department,
      action: payload.action,
      server_timestamp: serverNowIso,
      device_timestamp: payload.deviceTimestamp,
      clock_drift_seconds: driftSec,
      clock_tamper_flag: driftSec > 60,
      latitude: payload.latitude,
      longitude: payload.longitude,
      gps_accuracy_m: payload.gpsAccuracyM,
      distance_to_office_m: payload.distanceToOfficeM,
      geofence_status: payload.geofenceStatus,
      address_text: payload.addressText,
      photo_url: payload.photoDataUrl,
      integrity_hash: payload.integrityHash,
      device_info: deviceInfo,
      note: payload.note,
    };

    setLogs((prev) => [newLog, ...prev]);
    return newLog;
  };

  const handleSaveAdjustment = async (params: {
    logId: string;
    newTimestampIso: string;
    newGeofenceStatus: GeofenceStatus;
    newNote: string;
    reason: string;
  }) => {
    if (!currentUser) return;
    const target = logs.find((l) => l.id === params.logId);
    if (!target) return;

    const translateStatus = (s: GeofenceStatus) =>
      s === 'valid'
        ? 'Hợp lệ'
        : s === 'out_of_range_noted'
          ? 'Ngoài vùng (Ghi chú)'
          : 'Vi phạm';

    const oldValue = `Giờ: ${formatDateTimeVN(target.server_timestamp)} | Vùng: ${translateStatus(
      target.geofence_status
    )}${target.note ? ` | Ghi chú: ${target.note}` : ''}`;

    const newValue = `Giờ: ${formatDateTimeVN(params.newTimestampIso)} | Vùng: ${translateStatus(
      params.newGeofenceStatus
    )}${params.newNote ? ` | Ghi chú: ${params.newNote}` : ''}`;

    if (isSupabaseConfigured && supabase) {
      const { error: updErr } = await supabase
        .from('attendance_logs')
        .update({
          server_timestamp: params.newTimestampIso,
          geofence_status: params.newGeofenceStatus,
          note: params.newNote,
          is_adjusted: true,
          adjusted_by: currentUser.full_name,
        })
        .eq('id', target.id);

      if (updErr) {
        throw new Error(`Không thể cập nhật bản ghi: ${updErr.message}`);
      }

      const { data: auditInserted, error: audErr } = await supabase
        .from('audit_logs')
        .insert({
          admin_id: currentUser.id,
          admin_name: currentUser.full_name,
          target_record_id: target.id,
          target_employee_name: `${target.employee_name} (${target.employee_code})`,
          old_value: oldValue,
          new_value: newValue,
          reason: params.reason,
        })
        .select('*')
        .single();

      if (audErr) {
        throw new Error(`Không thể ghi Audit Log: ${audErr.message}`);
      }

      setLogs((prev) =>
        prev.map((l) =>
          l.id === target.id
            ? {
                ...l,
                server_timestamp: params.newTimestampIso,
                geofence_status: params.newGeofenceStatus,
                note: params.newNote,
                is_adjusted: true,
                adjusted_by: currentUser.full_name,
              }
            : l
        )
      );
      if (auditInserted) {
        setAuditLogs((prev) => [auditInserted as AuditLog, ...prev]);
      }
      return;
    }

    const newAudit: AuditLog = {
      id: `AUD-${Date.now()}`,
      edited_at: new Date().toISOString(),
      admin_id: currentUser.id,
      admin_name: currentUser.full_name,
      target_record_id: target.id,
      target_employee_name: `${target.employee_name} (${target.employee_code})`,
      old_value: oldValue,
      new_value: newValue,
      reason: params.reason,
    };

    setLogs((prev) =>
      prev.map((l) =>
        l.id === target.id
          ? {
              ...l,
              server_timestamp: params.newTimestampIso,
              geofence_status: params.newGeofenceStatus,
              note: params.newNote,
              is_adjusted: true,
              adjusted_by: currentUser.full_name,
            }
          : l
      )
    );
    setAuditLogs((prev) => [newAudit, ...prev]);
  };

  const handleSaveEmployee = async (emp: Employee, isNew: boolean) => {
    if (isSupabaseConfigured && supabase) {
      if (isNew) {
        const { id: _ignored, ...rest } = emp;
        const { data, error } = await supabase
          .from('employees')
          .insert(rest)
          .select('*')
          .single();
        if (error) throw new Error(error.message);
        setEmployees((prev) => [...prev, data as Employee]);
      } else {
        const { data, error } = await supabase
          .from('employees')
          .update(emp)
          .eq('id', emp.id)
          .select('*')
          .single();
        if (error) throw new Error(error.message);
        setEmployees((prev) =>
          prev.map((item) => (item.id === emp.id ? (data as Employee) : item))
        );
      }
      return;
    }

    if (isNew) {
      setEmployees((prev) => [...prev, emp]);
    } else {
      setEmployees((prev) =>
        prev.map((item) => (item.id === emp.id ? emp : item))
      );
    }
  };

  const handleSaveSettings = async (newSettings: CompanySettings) => {
    if (isSupabaseConfigured && supabase) {
      const hasValidUuid = UUID_REGEX.test(newSettings.id);
      if (hasValidUuid) {
        const { data, error } = await supabase
          .from('company_settings')
          .upsert(newSettings, { onConflict: 'id' })
          .select('*')
          .single();
        if (error) throw new Error(error.message);
        if (data) {
          setSettings(data as CompanySettings);
          return;
        }
      } else {
        const { data: existingRow } = await supabase
          .from('company_settings')
          .select('id')
          .limit(1)
          .maybeSingle();

        const { id: _ignored, ...rest } = newSettings;
        if (existingRow?.id) {
          const { data, error } = await supabase
            .from('company_settings')
            .update(rest)
            .eq('id', existingRow.id)
            .select('*')
            .single();
          if (error) throw new Error(error.message);
          if (data) {
            setSettings(data as CompanySettings);
            return;
          }
        } else {
          const { data, error } = await supabase
            .from('company_settings')
            .insert(rest)
            .select('*')
            .single();
          if (error) throw new Error(error.message);
          if (data) {
            setSettings(data as CompanySettings);
            return;
          }
        }
      }
    }
    setSettings(newSettings);
  };

  const handleAttendeeEnter = async (
    fullName: string,
    autoStartCamera: boolean
  ) => {
    const cleanName = cleanDisplayName(fullName);
    const normalized = normalizeFullName(cleanName);

    let targetEmp = employees.find(
      (e) => normalizeFullName(e.full_name) === normalized && e.is_active
    );

    if (autoStartCamera) {
      if (!targetEmp) {
        targetEmp = await ensureEmployeeExists(cleanName);
      }

      const todayKey = getVNDateKey(new Date().toISOString());
      const todayEmpLogs = logs
        .filter(
          (l) =>
            (l.employee_id === targetEmp!.id ||
              l.employee_code === targetEmp!.employee_code ||
              normalizeFullName(l.employee_name) === normalized) &&
            getVNDateKey(l.server_timestamp) === todayKey
        )
        .sort(
          (a, b) =>
            new Date(b.server_timestamp).getTime() -
            new Date(a.server_timestamp).getTime()
        );
      const isInShift = todayEmpLogs[0]?.action === 'check_in';
      setEmployeeInitialTab('checkin');
      setPendingAutoStart(isInShift ? 'check_out' : 'check_in');
      setCurrentUser(targetEmp);
      return;
    }

    // Lookup mode ("Xem trạng thái ca / Ra ca & Lịch sử"): do NOT auto-create employee row
    if (!targetEmp) {
      const matchingLog = logs.find(
        (l) => normalizeFullName(l.employee_name) === normalized
      );
      targetEmp = {
        id: matchingLog?.employee_id || 'lookup-temp',
        employee_code: matchingLog?.employee_code || 'TRA-CUU',
        full_name: matchingLog?.employee_name || cleanName,
        email: '',
        department: matchingLog?.department || 'Tạp vụ Nhà hàng',
        position: 'Nhân sự Đối tác (BNC)',
        role: 'employee',
        pin_code: '0000',
        pay_type: 'hourly',
        base_rate_vnd: 65000,
        ot_multiplier: 1.5,
        is_active: true,
        created_at: new Date().toISOString(),
      };
    }

    setEmployeeInitialTab('history');
    setPendingAutoStart(null);
    setCurrentUser(targetEmp);
  };

  const handleSwitchLookupName = async (newFullName: string) => {
    await handleAttendeeEnter(newFullName, false);
  };

  const handleAdminLogin = (password: string): boolean => {
    if (password !== '070707') {
      return false;
    }

    const adminAccount: Employee = employees.find(
      (e) => e.role === 'admin' && e.is_active
    ) || {
      id: 'emp-admin',
      employee_code: 'ADMIN',
      full_name: 'Quản trị viên Hệ thống',
      email: 'admin@banahills.vn',
      department: 'Ban Giám Đốc',
      position: 'Quản trị viên Toàn quyền',
      role: 'admin',
      pin_code: '',
      pay_type: 'daily',
      base_rate_vnd: 0,
      ot_multiplier: 1.5,
      is_active: true,
      created_at: new Date().toISOString(),
    };

    setPendingAutoStart(null);
    setCurrentUser(adminAccount);
    return true;
  };

  const handleLogout = async () => {
    if (isSupabaseConfigured && supabase) {
      await supabase.auth.signOut();
    }
    setEmployeeInitialTab('checkin');
    setPendingAutoStart(null);
    setCurrentUser(null);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Top Bar & Demo Mode Banner: Visible ONLY inside Admin workspace */}
      {currentUser?.role === 'admin' && (
        <>
          {!isSupabaseConfigured && (
            <div className="border-b border-amber-200 bg-amber-50 px-3.5 py-1.5 text-[11px] text-amber-900 sm:px-4 sm:py-2 sm:text-xs">
              <div className="mx-auto flex max-w-7xl items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-1.5 font-medium">
                  <Database className="h-3.5 w-3.5 shrink-0 text-amber-700" />
                  <span className="truncate">
                    Chế độ Demo (Chưa kết nối Supabase)
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setSetupModalOpen(true)}
                  className="shrink-0 font-semibold text-indigo-700 underline-offset-2 hover:underline"
                >
                  Hướng dẫn SQL
                </button>
              </div>
            </div>
          )}

          <header className="border-b border-slate-200 bg-white">
            <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-3 px-3.5 sm:h-16 sm:px-6">
              <div className="flex items-center gap-2.5 whitespace-nowrap shrink-0">
                <img
                  src="/logo-square.png"
                  alt="Logo Điểm Danh"
                  className="h-9 w-9 rounded-xl border border-slate-200 object-cover"
                />
                <span className="text-sm font-bold tracking-tight text-slate-900 sm:text-lg">
                  HỆ THỐNG ĐIỂM DANH
                </span>
              </div>

              <div className="hidden items-center gap-6 text-sm text-slate-500 md:flex">
                <span className="max-w-sm truncate">{settings.company_name}</span>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setSetupModalOpen(true)}
                  className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 whitespace-nowrap hover:bg-slate-50"
                >
                  <Database className="h-3.5 w-3.5 text-indigo-600" />
                  <span className="hidden sm:inline">Cấu hình Supabase</span>
                  <span className="sm:hidden">Supabase</span>
                </button>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white whitespace-nowrap transition-colors hover:bg-slate-800"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  <span>Đăng xuất</span>
                </button>
              </div>
            </div>
          </header>
        </>
      )}

      {/* Supabase loading / error state */}
      {isSupabaseConfigured && loadingSupabase && (
        <div className="mx-auto flex max-w-md flex-col items-center justify-center py-24 text-center">
          <RefreshCw className="h-8 w-8 animate-spin text-indigo-600" />
          <p className="mt-3 text-sm font-semibold text-slate-900">
            Đang đồng bộ dữ liệu từ Supabase...
          </p>
        </div>
      )}

      {isSupabaseConfigured && !loadingSupabase && supabaseError && (
        <div className="mx-auto my-8 max-w-xl rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-800">
          <p className="font-bold">Lỗi kết nối Supabase</p>
          <p className="mt-1">{supabaseError}</p>
          <div className="mt-4 flex gap-3">
            <button
              type="button"
              onClick={loadSupabaseData}
              className="rounded-lg bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-700"
            >
              Thử kết nối lại
            </button>
            <button
              type="button"
              onClick={() => setSetupModalOpen(true)}
              className="rounded-lg border border-rose-300 bg-white px-4 py-2 text-xs font-semibold text-rose-800"
            >
              Kiểm tra SQL Schema
            </button>
          </div>
        </div>
      )}

      {/* Main Content Routing */}
      {(!isSupabaseConfigured || (!loadingSupabase && !supabaseError)) && (
        <>
          {!currentUser && (
            <LoginScreen
              companyName={settings.company_name}
              onAttendeeEnter={handleAttendeeEnter}
              onAdminLogin={handleAdminLogin}
            />
          )}

          {currentUser && currentUser.role === 'employee' && (
            <EmployeeAttendanceView
              employee={currentUser}
              settings={settings}
              logs={logs}
              isDemoMode={!isSupabaseConfigured}
              initialTab={employeeInitialTab}
              autoStartAction={pendingAutoStart}
              onAutoStartConsumed={() => setPendingAutoStart(null)}
              onSwitchLookupName={handleSwitchLookupName}
              onSubmitAttendance={handleSubmitAttendance}
              onInspectLog={(log) => setInspectedLog(log)}
              onLogout={handleLogout}
            />
          )}

          {currentUser && currentUser.role === 'admin' && (
            <AdminDashboardView
              currentAdmin={currentUser}
              employees={employees}
              settings={settings}
              logs={logs}
              auditLogs={auditLogs}
              onInspectLog={(log) => setInspectedLog(log)}
              onAdjustLog={(log) => setAdjustingLog(log)}
              onSaveEmployee={handleSaveEmployee}
              onSaveSettings={handleSaveSettings}
              onOpenSupabaseSetup={() => setSetupModalOpen(true)}
            />
          )}
        </>
      )}

      {/* Modals */}
      <SupabaseSetupModal
        isOpen={setupModalOpen}
        onClose={() => setSetupModalOpen(false)}
      />

      <EvidenceInspectorModal
        log={inspectedLog}
        allLogs={logs}
        onClose={() => setInspectedLog(null)}
        onRequestAdjust={
          currentUser?.role === 'admin'
            ? (log) => {
                setInspectedLog(null);
                setAdjustingLog(log);
              }
            : undefined
        }
      />

      <ManualAdjustModal
        log={adjustingLog}
        onClose={() => setAdjustingLog(null)}
        onSaveAdjustment={handleSaveAdjustment}
      />

      <OfflineIndicator />
    </div>
  );
}
