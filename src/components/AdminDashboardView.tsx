import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Database,
  Eye,
  FileEdit,
  FileSpreadsheet,
  History,
  LayoutDashboard,
  MapPin,
  Navigation,
  Plus,
  Search,
  Settings,
  ShieldAlert,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import {
  AttendanceLog,
  AuditLog,
  CompanySettings,
  DateRangePreset,
  Employee,
  PayType,
  UserRole,
} from '../types';
import {
  formatDateTimeVN,
  formatVnd,
  getVNDateKey,
  reverseGeocodeNominatim,
} from '../utils/forensics';
import {
  calculateDashboardKpis,
  calculatePayrollSummary,
  resolveDateBounds,
} from '../utils/payroll';
import { exportLegalAttendanceExcel } from '../utils/excelExport';

interface AdminDashboardViewProps {
  currentAdmin: Employee;
  employees: Employee[];
  settings: CompanySettings;
  logs: AttendanceLog[];
  auditLogs: AuditLog[];
  onInspectLog: (log: AttendanceLog) => void;
  onAdjustLog: (log: AttendanceLog) => void;
  onSaveEmployee: (emp: Employee, isNew: boolean) => Promise<void>;
  onSaveSettings: (newSettings: CompanySettings) => Promise<void>;
  onOpenSupabaseSetup: () => void;
}

type AdminSection = 'overview' | 'logs' | 'employees' | 'settings' | 'audit';

export const AdminDashboardView: React.FC<AdminDashboardViewProps> = ({
  employees,
  settings,
  logs,
  auditLogs,
  onInspectLog,
  onAdjustLog,
  onSaveEmployee,
  onSaveSettings,
  onOpenSupabaseSetup,
}) => {
  const [section, setSection] = useState<AdminSection>('overview');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Filters
  const [datePreset, setDatePreset] = useState<DateRangePreset>('month');
  const [customStart, setCustomStart] = useState(() => {
    const today = getVNDateKey(new Date().toISOString());
    return `${today.slice(0, 7)}-01`;
  });
  const [customEnd, setCustomEnd] = useState(() =>
    getVNDateKey(new Date().toISOString())
  );
  const [departmentFilter, setDepartmentFilter] = useState('all');
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [alertOnlyFilter, setAlertOnlyFilter] = useState(false);

  // Employee modal state
  const [empModalOpen, setEmpModalOpen] = useState(false);
  const [editingEmp, setEditingEmp] = useState<Employee | null>(null);
  const [empForm, setEmpForm] = useState({
    employee_code: '',
    full_name: '',
    email: '',
    department: 'Kỹ thuật',
    position: '',
    role: 'employee' as UserRole,
    pin_code: '1234',
    pay_type: 'hourly' as PayType,
    base_rate_vnd: 75000,
    ot_multiplier: 1.5,
    is_active: true,
  });
  const [empError, setEmpError] = useState('');
  const [empSaving, setEmpSaving] = useState(false);

  // Settings form state
  const [settingsForm, setSettingsForm] = useState<CompanySettings>(settings);
  const [settingsSavedMsg, setSettingsSavedMsg] = useState('');
  const [settingsError, setSettingsError] = useState('');
  const [gpsFetching, setGpsFetching] = useState(false);

  const departments = useMemo(() => {
    const set = new Set(employees.map((e) => e.department).filter(Boolean));
    return Array.from(set).sort();
  }, [employees]);

  const { startDateKey, endDateKey } = useMemo(
    () => resolveDateBounds(datePreset, customStart, customEnd),
    [datePreset, customStart, customEnd]
  );

  const kpis = useMemo(
    () => calculateDashboardKpis(employees, logs, settings),
    [employees, logs, settings]
  );

  const filteredEmployees = useMemo(() => {
    const q = employeeSearch.trim().toLowerCase();
    return employees.filter((emp) => {
      if (departmentFilter !== 'all' && emp.department !== departmentFilter) {
        return false;
      }
      if (
        q &&
        !emp.full_name.toLowerCase().includes(q) &&
        !emp.employee_code.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [employees, departmentFilter, employeeSearch]);

  const payrollRows = useMemo(
    () =>
      calculatePayrollSummary(
        filteredEmployees,
        logs,
        settings,
        startDateKey,
        endDateKey
      ),
    [filteredEmployees, logs, settings, startDateKey, endDateKey]
  );

  const payrollTotals = useMemo(() => {
    return payrollRows.reduce(
      (acc, r) => ({
        shifts: acc.shifts + r.totalShifts,
        hours: acc.hours + r.totalWorkHours,
        late: acc.late + r.lateMinutes,
        ot: acc.ot + r.overtimeHours,
        cost: acc.cost + r.laborCostVnd,
      }),
      { shifts: 0, hours: 0, late: 0, ot: 0, cost: 0 }
    );
  }, [payrollRows]);

  const filteredLogs = useMemo(() => {
    const q = employeeSearch.trim().toLowerCase();
    return logs
      .filter((l) => {
        const dateKey = getVNDateKey(l.server_timestamp);
        if (dateKey < startDateKey || dateKey > endDateKey) return false;
        if (departmentFilter !== 'all' && l.department !== departmentFilter) {
          return false;
        }
        if (
          q &&
          !l.employee_name.toLowerCase().includes(q) &&
          !l.employee_code.toLowerCase().includes(q)
        ) {
          return false;
        }
        if (
          alertOnlyFilter &&
          l.geofence_status === 'valid' &&
          !l.clock_tamper_flag &&
          l.gps_accuracy_m <= settings.max_gps_accuracy_m
        ) {
          return false;
        }
        return true;
      })
      .sort(
        (a, b) =>
          new Date(b.server_timestamp).getTime() -
          new Date(a.server_timestamp).getTime()
      );
  }, [
    logs,
    startDateKey,
    endDateKey,
    departmentFilter,
    employeeSearch,
    alertOnlyFilter,
    settings.max_gps_accuracy_m,
  ]);

  const handleExportExcel = () => {
    const label = `${startDateKey}_den_${endDateKey}`;
    exportLegalAttendanceExcel(payrollRows, filteredLogs, auditLogs, label);
  };

  const openAddEmployee = () => {
    setEditingEmp(null);
    setEmpError('');
    setEmpForm({
      employee_code: `NV00${employees.length + 1}`,
      full_name: '',
      email: '',
      department: 'Kỹ thuật',
      position: 'Chuyên viên',
      role: 'employee',
      pin_code: '1234',
      pay_type: 'hourly',
      base_rate_vnd: 75000,
      ot_multiplier: 1.5,
      is_active: true,
    });
    setEmpModalOpen(true);
  };

  const openEditEmployee = (emp: Employee) => {
    setEditingEmp(emp);
    setEmpError('');
    setEmpForm({
      employee_code: emp.employee_code,
      full_name: emp.full_name,
      email: emp.email,
      department: emp.department,
      position: emp.position,
      role: emp.role,
      pin_code: emp.pin_code,
      pay_type: emp.pay_type,
      base_rate_vnd: emp.base_rate_vnd,
      ot_multiplier: emp.ot_multiplier,
      is_active: emp.is_active,
    });
    setEmpModalOpen(true);
  };

  const handleEmpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmpError('');
    if (!empForm.employee_code.trim() || !empForm.full_name.trim()) {
      setEmpError('Vui lòng nhập Mã nhân viên và Họ tên.');
      return;
    }
    if (empForm.pin_code.trim().length < 4) {
      setEmpError('Mã PIN phải có ít nhất 4 ký tự số.');
      return;
    }

    setEmpSaving(true);
    try {
      const payload: Employee = {
        id: editingEmp ? editingEmp.id : `emp-${Date.now()}`,
        employee_code: empForm.employee_code.trim().toUpperCase(),
        full_name: empForm.full_name.trim(),
        email:
          empForm.email.trim() ||
          `${empForm.employee_code.trim().toLowerCase()}@viettam.vn`,
        department: empForm.department.trim(),
        position: empForm.position.trim() || 'Nhân viên',
        role: empForm.role,
        pin_code: empForm.pin_code.trim(),
        pay_type: empForm.pay_type,
        base_rate_vnd: Number(empForm.base_rate_vnd) || 0,
        ot_multiplier: Number(empForm.ot_multiplier) || 1.5,
        is_active: empForm.is_active,
        created_at: editingEmp
          ? editingEmp.created_at
          : new Date().toISOString(),
      };
      await onSaveEmployee(payload, !editingEmp);
      setEmpModalOpen(false);
    } catch (err) {
      setEmpError(
        err instanceof Error ? err.message : 'Không thể lưu thông tin nhân sự.'
      );
    } finally {
      setEmpSaving(false);
    }
  };

  const handleFetchCurrentCoords = () => {
    if (!navigator.geolocation) {
      setSettingsError('Trình duyệt không hỗ trợ định vị GPS.');
      return;
    }
    setGpsFetching(true);
    setSettingsError('');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(6));
        const lng = Number(pos.coords.longitude.toFixed(6));
        const addr = await reverseGeocodeNominatim(lat, lng);
        setSettingsForm((prev) => ({
          ...prev,
          latitude: lat,
          longitude: lng,
          office_address: addr,
        }));
        setGpsFetching(false);
      },
      (err) => {
        setSettingsError(`Không lấy được GPS hiện tại: ${err.message}`);
        setGpsFetching(false);
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
    );
  };

  const handleSettingsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSettingsError('');
    setSettingsSavedMsg('');
    try {
      await onSaveSettings({
        ...settingsForm,
        updated_at: new Date().toISOString(),
      });
      setSettingsSavedMsg('Đã lưu cấu hình Geofence & Ca làm việc thành công.');
      window.setTimeout(() => setSettingsSavedMsg(''), 3500);
    } catch (err) {
      setSettingsError(
        err instanceof Error ? err.message : 'Lỗi lưu cấu hình.'
      );
    }
  };

  const navItems: { id: AdminSection; label: string; icon: React.ReactNode }[] = [
    {
      id: 'overview',
      label: 'Tổng quan & Lương',
      icon: <LayoutDashboard className="h-5 w-5" />,
    },
    {
      id: 'logs',
      label: 'Nhật ký chấm công',
      icon: <Clock className="h-5 w-5" />,
    },
    {
      id: 'employees',
      label: 'Quản lý nhân sự',
      icon: <Users className="h-5 w-5" />,
    },
    {
      id: 'settings',
      label: 'Cấu hình Geofence',
      icon: <Settings className="h-5 w-5" />,
    },
    {
      id: 'audit',
      label: 'Nhật ký Audit',
      icon: <History className="h-5 w-5" />,
    },
  ];

  const sectionTitle =
    navItems.find((n) => n.id === section)?.label || 'Bảng điều khiển';

  return (
    <div className="flex min-h-[calc(100vh-4rem)] w-full bg-slate-50">
      {/* DESKTOP SIDEBAR */}
      <aside
        className={`hidden shrink-0 flex-col border-r border-slate-200 bg-white transition-all duration-200 lg:flex ${
          sidebarCollapsed ? 'w-[76px]' : 'w-[256px]'
        }`}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3.5">
          {!sidebarCollapsed && (
            <span className="truncate text-xs font-bold tracking-tight text-slate-500">
              Bảng quản trị nhân sự
            </span>
          )}
          <button
            type="button"
            onClick={() => setSidebarCollapsed((v) => !v)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            aria-label={sidebarCollapsed ? 'Mở rộng thanh bên' : 'Thu gọn thanh bên'}
          >
            {sidebarCollapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronLeft className="h-4 w-4" />
            )}
          </button>
        </div>

        <nav className="flex-1 space-y-1 p-3">
          {navItems.map((item) => {
            const active = section === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setSection(item.id)}
                title={item.label}
                className={`flex min-h-[44px] w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                  active
                    ? 'bg-indigo-50 font-semibold text-indigo-700'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <span className="shrink-0">{item.icon}</span>
                {!sidebarCollapsed && (
                  <span className="truncate whitespace-nowrap">{item.label}</span>
                )}
              </button>
            );
          })}
        </nav>

        {!sidebarCollapsed && (
          <div className="border-t border-slate-100 p-4 text-xs text-slate-500">
            <p className="font-semibold text-slate-800">{settings.company_name}</p>
            <p className="mt-1 font-mono tabular-nums">
              Bán kính: {settings.geofence_radius_m}m · Ca {settings.shift_start_time}
            </p>
          </div>
        )}
      </aside>

      {/* MAIN WORKSPACE VIEWPORT */}
      <main className="min-w-0 flex-1 px-4 pt-5 pb-24 sm:px-6 lg:px-8 lg:pb-10">
        {/* Top Workspace Header & Excel Export CTA */}
        <div className="mb-6 flex flex-col justify-between gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-center">
          <div>
            <p className="text-xs font-medium text-slate-500">
              Quản lý & Kế toán / {sectionTitle}
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
              {sectionTitle}
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={onOpenSupabaseSetup}
              className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 whitespace-nowrap transition-colors hover:bg-slate-50"
            >
              <Database className="h-4 w-4 shrink-0 text-indigo-600" />
              <span>Cấu hình Supabase</span>
            </button>

            <button
              type="button"
              onClick={handleExportExcel}
              className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white whitespace-nowrap transition-colors hover:bg-indigo-700"
            >
              <FileSpreadsheet className="h-4 w-4 shrink-0" />
              <span>Xuất Báo Cáo Excel Pháp Lý (.xlsx)</span>
            </button>
          </div>
        </div>

        {/* FILTER TOOLBAR (Shown on Overview and Logs) */}
        {(section === 'overview' || section === 'logs') && (
          <div className="mb-6 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  { id: 'today', label: 'Hôm nay' },
                  { id: 'week', label: 'Tuần này' },
                  { id: 'month', label: 'Tháng này' },
                  { id: 'custom', label: 'Tùy chọn' },
                ] as { id: DateRangePreset; label: string }[]
              ).map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => setDatePreset(preset.id)}
                  className={`min-h-[38px] rounded-lg px-3.5 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors ${
                    datePreset === preset.id
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {preset.label}
                </button>
              ))}

              {datePreset === 'custom' && (
                <div className="flex flex-wrap items-center gap-2 pl-1">
                  <input
                    type="date"
                    value={customStart}
                    onChange={(e) => setCustomStart(e.target.value)}
                    aria-label="Từ ngày"
                    className="min-h-[38px] rounded-lg border border-slate-200 px-2.5 font-mono text-xs text-slate-900"
                  />
                  <span className="text-xs text-slate-400">đến</span>
                  <input
                    type="date"
                    value={customEnd}
                    onChange={(e) => setCustomEnd(e.target.value)}
                    aria-label="Đến ngày"
                    className="min-h-[38px] rounded-lg border border-slate-200 px-2.5 font-mono text-xs text-slate-900"
                  />
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <select
                value={departmentFilter}
                onChange={(e) => setDepartmentFilter(e.target.value)}
                aria-label="Lọc theo phòng ban"
                className="min-h-[38px] rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 focus:border-indigo-600 focus:outline-none"
              >
                <option value="all">Tất cả phòng ban</option>
                {departments.map((dept) => (
                  <option key={dept} value={dept}>
                    Phòng {dept}
                  </option>
                ))}
              </select>

              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={employeeSearch}
                  onChange={(e) => setEmployeeSearch(e.target.value)}
                  placeholder="Tìm tên hoặc mã NV..."
                  className="min-h-[38px] w-48 rounded-lg border border-slate-200 bg-white py-1.5 pr-3 pl-8 text-xs text-slate-900 focus:border-indigo-600 focus:outline-none"
                />
              </div>

              {section === 'logs' && (
                <button
                  type="button"
                  onClick={() => setAlertOnlyFilter((v) => !v)}
                  className={`min-h-[38px] rounded-lg border px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors ${
                    alertOnlyFilter
                      ? 'border-rose-300 bg-rose-50 text-rose-700'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  Chỉ xem cảnh báo
                </button>
              )}
            </div>
          </div>
        )}

        {/* SECTION 1: OVERVIEW & LABOR COST TABLE */}
        {section === 'overview' && (
          <div className="space-y-6">
            {/* Real-time KPI Row */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-2xl border border-slate-200 bg-white p-5">
                <div className="flex items-center justify-between text-xs font-medium text-slate-500">
                  <span>Tổng nhân sự đang trong ca</span>
                  <UserCheck className="h-4 w-4 text-emerald-600" />
                </div>
                <p className="mt-2 font-mono text-3xl font-bold text-slate-900 tabular-nums">
                  {kpis.activeInShiftCount}
                  <span className="ml-1 text-base font-medium text-slate-400">
                    /{kpis.totalActiveEmployees}
                  </span>
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Cập nhật trực tiếp theo lượt vào/ra ca
                </p>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-5">
                <div className="flex items-center justify-between text-xs font-medium text-slate-500">
                  <span>Đi muộn hôm nay</span>
                  <Clock className="h-4 w-4 text-amber-600" />
                </div>
                <p
                  className={`mt-2 font-mono text-3xl font-bold tabular-nums ${
                    kpis.lateTodayCount > 0 ? 'text-amber-700' : 'text-slate-900'
                  }`}
                >
                  {kpis.lateTodayCount}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Sau giờ chuẩn {settings.shift_start_time} (+{settings.grace_period_minutes}p ân hạn)
                </p>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-5">
                <div className="flex items-center justify-between text-xs font-medium text-slate-500">
                  <span>Cảnh báo GPS / Giờ thiết bị</span>
                  <AlertTriangle className="h-4 w-4 text-rose-600" />
                </div>
                <p
                  className={`mt-2 font-mono text-3xl font-bold tabular-nums ${
                    kpis.alertCount > 0 ? 'text-rose-700' : 'text-emerald-700'
                  }`}
                >
                  {kpis.alertCount}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Ngoài vùng, sai số &gt;{settings.max_gps_accuracy_m}m hoặc lệch giờ &gt;60s
                </p>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-5">
                <div className="flex items-center justify-between text-xs font-medium text-slate-500">
                  <span>Chi phí nhân công (Hôm nay / Tháng)</span>
                  <Building2 className="h-4 w-4 text-indigo-600" />
                </div>
                <p className="mt-2 font-mono text-2xl font-bold text-indigo-700 tabular-nums">
                  {formatVnd(kpis.todayCostVnd)}
                </p>
                <p className="mt-1 font-mono text-xs text-slate-600 tabular-nums">
                  Tháng này: {formatVnd(kpis.monthCostVnd)}
                </p>
              </div>
            </div>

            {/* Interactive Labor Cost & Timesheet Summary Table */}
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-6 py-4">
                <div>
                  <h2 className="text-base font-bold text-slate-900">
                    Bảng Tổng Hợp Công & Chi Phí Nhân Công Thực Tế
                  </h2>
                  <p className="text-xs text-slate-500">
                    Kỳ tính công: {startDateKey} đến {endDateKey} · Đã bao gồm nhân hệ số tăng ca (OT)
                  </p>
                </div>
                <span className="font-mono text-xs text-slate-500 tabular-nums">
                  {payrollRows.length} nhân sự
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] text-left text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                    <tr>
                      <th className="px-6 py-3">Nhân viên</th>
                      <th className="px-4 py-3">Phòng ban</th>
                      <th className="px-4 py-3 text-right">Số ngày công</th>
                      <th className="px-4 py-3 text-right">Tổng giờ thực tế</th>
                      <th className="px-4 py-3 text-right">Đi muộn (phút)</th>
                      <th className="px-4 py-3 text-right">Tăng ca (OT)</th>
                      <th className="px-4 py-3 text-right">Đơn giá lương</th>
                      <th className="px-6 py-3 text-right">Thành tiền (VNĐ)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {payrollRows.length === 0 ? (
                      <tr>
                        <td
                          colSpan={8}
                          className="px-6 py-10 text-center text-sm text-slate-500"
                        >
                          Không có nhân sự phù hợp với bộ lọc hiện tại.
                        </td>
                      </tr>
                    ) : (
                      payrollRows.map((row) => (
                        <tr
                          key={row.employee.id}
                          className="transition-colors hover:bg-slate-50"
                        >
                          <td className="px-6 py-3.5">
                            <p className="font-semibold text-slate-900">
                              {row.employee.full_name}
                            </p>
                            <p className="font-mono text-xs text-slate-500">
                              {row.employee.employee_code} · {row.employee.position}
                              {row.hasActiveShift ? ' · Đang trong ca' : ''}
                            </p>
                          </td>
                          <td className="px-4 py-3.5 text-slate-700">
                            {row.employee.department}
                          </td>
                          <td className="px-4 py-3.5 text-right font-mono font-medium text-slate-900 tabular-nums">
                            {row.totalShifts}
                          </td>
                          <td className="px-4 py-3.5 text-right font-mono font-medium text-slate-900 tabular-nums">
                            {row.totalWorkHours.toFixed(2)}h
                          </td>
                          <td
                            className={`px-4 py-3.5 text-right font-mono font-medium tabular-nums ${
                              row.lateMinutes > 0
                                ? 'text-amber-700'
                                : 'text-slate-500'
                            }`}
                          >
                            {row.lateMinutes}
                          </td>
                          <td
                            className={`px-4 py-3.5 text-right font-mono font-medium tabular-nums ${
                              row.overtimeHours > 0
                                ? 'text-emerald-700'
                                : 'text-slate-500'
                            }`}
                          >
                            {row.overtimeHours.toFixed(2)}h
                          </td>
                          <td className="px-4 py-3.5 text-right font-mono text-xs text-slate-600 tabular-nums">
                            {formatVnd(row.employee.base_rate_vnd)} /{' '}
                            {row.employee.pay_type === 'hourly' ? 'giờ' : 'ngày'}
                          </td>
                          <td className="px-6 py-3.5 text-right font-mono font-bold text-slate-900 tabular-nums">
                            {formatVnd(row.laborCostVnd)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                  {payrollRows.length > 0 && (
                    <tfoot className="border-t border-slate-200 bg-slate-50 font-semibold text-slate-900">
                      <tr>
                        <td className="px-6 py-3.5" colSpan={2}>
                          Tổng cộng toàn bộ bộ lọc
                        </td>
                        <td className="px-4 py-3.5 text-right font-mono tabular-nums">
                          {payrollTotals.shifts}
                        </td>
                        <td className="px-4 py-3.5 text-right font-mono tabular-nums">
                          {payrollTotals.hours.toFixed(2)}h
                        </td>
                        <td className="px-4 py-3.5 text-right font-mono text-amber-700 tabular-nums">
                          {payrollTotals.late}
                        </td>
                        <td className="px-4 py-3.5 text-right font-mono text-emerald-700 tabular-nums">
                          {payrollTotals.ot.toFixed(2)}h
                        </td>
                        <td className="px-4 py-3.5" />
                        <td className="px-6 py-3.5 text-right font-mono text-base font-bold text-indigo-700 tabular-nums">
                          {formatVnd(payrollTotals.cost)}
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>

            {/* Quick Recent Logs Table with Forensic Click */}
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
                <div>
                  <h2 className="text-base font-bold text-slate-900">
                    Dữ liệu Chấm công Gần nhất (Nhấn để kiểm tra chứng cứ)
                  </h2>
                  <p className="text-xs text-slate-500">
                    Hiển thị tối đa 8 bản ghi gần nhất trong kỳ lọc
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSection('logs')}
                  className="text-xs font-semibold text-indigo-600 hover:text-indigo-700"
                >
                  Xem toàn bộ ({filteredLogs.length})
                </button>
              </div>
              <LogsTable
                logs={filteredLogs.slice(0, 8)}
                maxAccuracy={settings.max_gps_accuracy_m}
                onInspectLog={onInspectLog}
                onAdjustLog={onAdjustLog}
              />
            </div>
          </div>
        )}

        {/* SECTION 2: FULL FORENSIC ATTENDANCE LOGS */}
        {section === 'logs' && (
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  Nhật ký Chấm công Gốc & Chứng cứ GPS / Ảnh chụp
                </h2>
                <p className="text-xs text-slate-500">
                  Nhấn vào từng dòng để xem ảnh đóng dấu SHA-256, liên kết Google Maps và đối chiếu giờ máy chủ
                </p>
              </div>
              <span className="font-mono text-xs text-slate-500 tabular-nums">
                {filteredLogs.length} bản ghi
              </span>
            </div>
            <LogsTable
              logs={filteredLogs}
              maxAccuracy={settings.max_gps_accuracy_m}
              onInspectLog={onInspectLog}
              onAdjustLog={onAdjustLog}
            />
          </div>
        )}

        {/* SECTION 3: EMPLOYEE MANAGEMENT */}
        {section === 'employees' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-slate-600">
                Quản lý danh sách nhân viên, phân quyền vai trò và cấu hình đơn giá lương theo giờ hoặc theo ngày.
              </p>
              <button
                type="button"
                onClick={openAddEmployee}
                className="inline-flex min-h-[42px] items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
              >
                <Plus className="h-4 w-4" />
                <span>Thêm nhân viên mới</span>
              </button>
            </div>

            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[780px] text-left text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                    <tr>
                      <th className="px-6 py-3">Mã NV</th>
                      <th className="px-4 py-3">Họ và tên</th>
                      <th className="px-4 py-3">Phòng ban / Chức vụ</th>
                      <th className="px-4 py-3">Vai trò</th>
                      <th className="px-4 py-3 text-right">Đơn giá lương</th>
                      <th className="px-4 py-3 text-right">Hệ số OT</th>
                      <th className="px-4 py-3">Trạng thái</th>
                      <th className="px-6 py-3 text-right">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {employees.map((emp) => (
                      <tr key={emp.id} className="hover:bg-slate-50">
                        <td className="px-6 py-3.5 font-mono font-semibold text-slate-900">
                          {emp.employee_code}
                        </td>
                        <td className="px-4 py-3.5">
                          <p className="font-semibold text-slate-900">
                            {emp.full_name}
                          </p>
                          <p className="text-xs text-slate-500">{emp.email}</p>
                        </td>
                        <td className="px-4 py-3.5 text-slate-700">
                          <p>{emp.department}</p>
                          <p className="text-xs text-slate-500">{emp.position}</p>
                        </td>
                        <td className="px-4 py-3.5 text-xs font-semibold">
                          {emp.role === 'admin' ? (
                            <span className="text-indigo-700">Quản lý / Kế toán</span>
                          ) : (
                            <span className="text-slate-700">Nhân viên</span>
                          )}
                        </td>
                        <td className="px-4 py-3.5 text-right font-mono font-medium text-slate-900 tabular-nums">
                          {formatVnd(emp.base_rate_vnd)} /{' '}
                          {emp.pay_type === 'hourly' ? 'giờ' : 'ngày'}
                        </td>
                        <td className="px-4 py-3.5 text-right font-mono text-slate-700 tabular-nums">
                          x{emp.ot_multiplier}
                        </td>
                        <td className="px-4 py-3.5 text-xs font-semibold">
                          {emp.is_active ? (
                            <span className="text-emerald-700">Đang hoạt động</span>
                          ) : (
                            <span className="text-slate-400">Ngừng hoạt động</span>
                          )}
                        </td>
                        <td className="px-6 py-3.5 text-right">
                          <button
                            type="button"
                            onClick={() => openEditEmployee(emp)}
                            className="text-xs font-semibold text-indigo-600 hover:text-indigo-700"
                          >
                            Chỉnh sửa
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* SECTION 4: GEOFENCE & SHIFT SETTINGS */}
        {section === 'settings' && (
          <form
            onSubmit={handleSettingsSubmit}
            className="max-w-3xl space-y-6 rounded-2xl border border-slate-200 bg-white p-6"
          >
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Thiết lập Tọa độ Công ty, Bán kính Geofence & Ca làm việc
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                Mọi thay đổi sẽ áp dụng ngay lập tức cho quy trình kiểm tra GPS của nhân viên.
              </p>
            </div>

            {settingsSavedMsg && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
                {settingsSavedMsg}
              </div>
            )}

            {settingsError && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
                {settingsError}
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-slate-700">
                  Tên doanh nghiệp
                </label>
                <input
                  type="text"
                  value={settingsForm.company_name}
                  onChange={(e) =>
                    setSettingsForm((p) => ({
                      ...p,
                      company_name: e.target.value,
                    }))
                  }
                  className="mt-1.5 min-h-[42px] w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-indigo-600 focus:outline-none"
                  required
                />
              </div>

              <div className="sm:col-span-2">
                <div className="flex items-center justify-between">
                  <label className="block text-sm font-medium text-slate-700">
                    Địa chỉ văn phòng
                  </label>
                  <button
                    type="button"
                    onClick={handleFetchCurrentCoords}
                    disabled={gpsFetching}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-700"
                  >
                    <Navigation className="h-3.5 w-3.5" />
                    <span>
                      {gpsFetching
                        ? 'Đang lấy tọa độ...'
                        : 'Lấy tọa độ GPS hiện tại'}
                    </span>
                  </button>
                </div>
                <input
                  type="text"
                  value={settingsForm.office_address}
                  onChange={(e) =>
                    setSettingsForm((p) => ({
                      ...p,
                      office_address: e.target.value,
                    }))
                  }
                  className="mt-1.5 min-h-[42px] w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-indigo-600 focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700">
                  Vĩ độ chuẩn (Latitude)
                </label>
                <input
                  type="number"
                  step="0.000001"
                  value={settingsForm.latitude}
                  onChange={(e) =>
                    setSettingsForm((p) => ({
                      ...p,
                      latitude: Number(e.target.value),
                    }))
                  }
                  className="mt-1.5 min-h-[42px] w-full rounded-xl border border-slate-200 px-3.5 py-2 font-mono text-sm text-slate-900 focus:border-indigo-600 focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700">
                  Kinh độ chuẩn (Longitude)
                </label>
                <input
                  type="number"
                  step="0.000001"
                  value={settingsForm.longitude}
                  onChange={(e) =>
                    setSettingsForm((p) => ({
                      ...p,
                      longitude: Number(e.target.value),
                    }))
                  }
                  className="mt-1.5 min-h-[42px] w-full rounded-xl border border-slate-200 px-3.5 py-2 font-mono text-sm text-slate-900 focus:border-indigo-600 focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700">
                  Bán kính Geofence cho phép (mét)
                </label>
                <input
                  type="number"
                  min={20}
                  max={5000}
                  value={settingsForm.geofence_radius_m}
                  onChange={(e) =>
                    setSettingsForm((p) => ({
                      ...p,
                      geofence_radius_m: Number(e.target.value),
                    }))
                  }
                  className="mt-1.5 min-h-[42px] w-full rounded-xl border border-slate-200 px-3.5 py-2 font-mono text-sm text-slate-900 focus:border-indigo-600 focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700">
                  Sai số GPS tối đa cho phép (mét)
                </label>
                <input
                  type="number"
                  min={10}
                  max={200}
                  value={settingsForm.max_gps_accuracy_m}
                  onChange={(e) =>
                    setSettingsForm((p) => ({
                      ...p,
                      max_gps_accuracy_m: Number(e.target.value),
                    }))
                  }
                  className="mt-1.5 min-h-[42px] w-full rounded-xl border border-slate-200 px-3.5 py-2 font-mono text-sm text-slate-900 focus:border-indigo-600 focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700">
                  Giờ bắt đầu ca chuẩn
                </label>
                <input
                  type="time"
                  value={settingsForm.shift_start_time}
                  onChange={(e) =>
                    setSettingsForm((p) => ({
                      ...p,
                      shift_start_time: e.target.value,
                    }))
                  }
                  className="mt-1.5 min-h-[42px] w-full rounded-xl border border-slate-200 px-3.5 py-2 font-mono text-sm text-slate-900 focus:border-indigo-600 focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700">
                  Giờ kết thúc ca chuẩn
                </label>
                <input
                  type="time"
                  value={settingsForm.shift_end_time}
                  onChange={(e) =>
                    setSettingsForm((p) => ({
                      ...p,
                      shift_end_time: e.target.value,
                    }))
                  }
                  className="mt-1.5 min-h-[42px] w-full rounded-xl border border-slate-200 px-3.5 py-2 font-mono text-sm text-slate-900 focus:border-indigo-600 focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700">
                  Số giờ công chuẩn / ngày
                </label>
                <input
                  type="number"
                  step="0.5"
                  min={4}
                  max={12}
                  value={settingsForm.standard_daily_hours}
                  onChange={(e) =>
                    setSettingsForm((p) => ({
                      ...p,
                      standard_daily_hours: Number(e.target.value),
                    }))
                  }
                  className="mt-1.5 min-h-[42px] w-full rounded-xl border border-slate-200 px-3.5 py-2 font-mono text-sm text-slate-900 focus:border-indigo-600 focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700">
                  Thời gian ân hạn đi muộn (phút)
                </label>
                <input
                  type="number"
                  min={0}
                  max={60}
                  value={settingsForm.grace_period_minutes}
                  onChange={(e) =>
                    setSettingsForm((p) => ({
                      ...p,
                      grace_period_minutes: Number(e.target.value),
                    }))
                  }
                  className="mt-1.5 min-h-[42px] w-full rounded-xl border border-slate-200 px-3.5 py-2 font-mono text-sm text-slate-900 focus:border-indigo-600 focus:outline-none"
                  required
                />
              </div>
            </div>

            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <input
                type="checkbox"
                checked={settingsForm.allow_out_of_office_with_note}
                onChange={(e) =>
                  setSettingsForm((p) => ({
                    ...p,
                    allow_out_of_office_with_note: e.target.checked,
                  }))
                }
                className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-600"
              />
              <div>
                <p className="text-sm font-semibold text-slate-900">
                  Cho phép chấm công ngoài vùng Geofence kèm ghi chú bắt buộc
                </p>
                <p className="mt-0.5 text-xs text-slate-600">
                  Khi bật, nhân viên đi công tác hoặc làm việc tại địa điểm khách hàng vẫn có thể chấm công nếu nhập lý do rõ ràng (hệ thống sẽ gắn cờ cảnh báo để Quản lý đối soát).
                </p>
              </div>
            </label>

            <div className="flex justify-end border-t border-slate-100 pt-4">
              <button
                type="submit"
                className="min-h-[44px] rounded-xl bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700"
              >
                Lưu cấu hình Geofence
              </button>
            </div>
          </form>
        )}

        {/* SECTION 5: IMMUTABLE AUDIT LOGS */}
        {section === 'audit' && (
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  Nhật ký Chỉnh sửa Dữ liệu Chấm công (Audit Trail Bất Biến)
                </h2>
                <p className="text-xs text-slate-500">
                  Lưu trữ toàn bộ lịch sử điều chỉnh thủ công với giá trị trước/sau và lý do bắt buộc
                </p>
              </div>
              <span className="font-mono text-xs text-slate-500 tabular-nums">
                {auditLogs.length} sự kiện
              </span>
            </div>

            {auditLogs.length === 0 ? (
              <div className="p-10 text-center text-sm text-slate-500">
                Chưa có sự kiện chỉnh sửa nào được ghi nhận.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[780px] text-left text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                    <tr>
                      <th className="px-6 py-3">Thời gian sửa (UTC+7)</th>
                      <th className="px-4 py-3">Quản trị viên</th>
                      <th className="px-4 py-3">Bản ghi / Nhân viên</th>
                      <th className="px-4 py-3">Giá trị cũ</th>
                      <th className="px-4 py-3">Giá trị mới</th>
                      <th className="px-6 py-3">Lý do điều chỉnh</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {auditLogs.map((audit) => (
                      <tr key={audit.id} className="hover:bg-slate-50">
                        <td className="px-6 py-3.5 font-mono text-xs text-slate-700 tabular-nums">
                          {formatDateTimeVN(audit.edited_at)}
                        </td>
                        <td className="px-4 py-3.5 font-medium text-slate-900">
                          {audit.admin_name}
                        </td>
                        <td className="px-4 py-3.5">
                          <p className="font-mono text-xs font-semibold text-indigo-700">
                            {audit.target_record_id}
                          </p>
                          <p className="text-xs text-slate-600">
                            {audit.target_employee_name}
                          </p>
                        </td>
                        <td className="px-4 py-3.5 text-xs text-rose-700">
                          {audit.old_value}
                        </td>
                        <td className="px-4 py-3.5 text-xs font-medium text-emerald-700">
                          {audit.new_value}
                        </td>
                        <td className="px-6 py-3.5 text-xs text-slate-700">
                          {audit.reason}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </main>

      {/* MOBILE BOTTOM NAVIGATION BAR (<= 15% height) */}
      <nav
        aria-label="Điều hướng quản lý"
        className="fixed right-0 bottom-0 left-0 z-40 grid h-16 grid-cols-5 border-t border-slate-200 bg-white/95 backdrop-blur-md pb-safe lg:hidden"
      >
        {navItems.map((item) => {
          const active = section === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setSection(item.id)}
              className={`flex min-h-[44px] flex-col items-center justify-center gap-0.5 px-1 ${
                active ? 'text-indigo-600' : 'text-slate-500'
              }`}
            >
              {item.icon}
              <span className="max-w-full truncate text-[10px] font-semibold">
                {item.id === 'overview'
                  ? 'Tổng quan'
                  : item.id === 'logs'
                    ? 'Nhật ký'
                    : item.id === 'employees'
                      ? 'Nhân sự'
                      : item.id === 'settings'
                        ? 'Geofence'
                        : 'Audit'}
              </span>
            </button>
          );
        })}
      </nav>

      {/* ADD / EDIT EMPLOYEE MODAL */}
      {empModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
        >
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <h2 className="text-base font-bold text-slate-900">
                {editingEmp ? 'Cập nhật hồ sơ nhân sự' : 'Thêm nhân viên mới'}
              </h2>
              <button
                type="button"
                onClick={() => setEmpModalOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleEmpSubmit} className="space-y-4 p-6">
              {empError && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-medium text-rose-700">
                  {empError}
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Mã nhân viên
                  </label>
                  <input
                    type="text"
                    value={empForm.employee_code}
                    onChange={(e) =>
                      setEmpForm((p) => ({
                        ...p,
                        employee_code: e.target.value,
                      }))
                    }
                    className="mt-1 min-h-[40px] w-full rounded-xl border border-slate-200 px-3 py-2 font-mono text-sm uppercase"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Mã PIN đăng nhập
                  </label>
                  <input
                    type="text"
                    value={empForm.pin_code}
                    onChange={(e) =>
                      setEmpForm((p) => ({ ...p, pin_code: e.target.value }))
                    }
                    className="mt-1 min-h-[40px] w-full rounded-xl border border-slate-200 px-3 py-2 font-mono text-sm"
                    required
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700">
                    Họ và tên
                  </label>
                  <input
                    type="text"
                    value={empForm.full_name}
                    onChange={(e) =>
                      setEmpForm((p) => ({ ...p, full_name: e.target.value }))
                    }
                    className="mt-1 min-h-[40px] w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                    required
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700">
                    Email công ty
                  </label>
                  <input
                    type="email"
                    value={empForm.email}
                    onChange={(e) =>
                      setEmpForm((p) => ({ ...p, email: e.target.value }))
                    }
                    className="mt-1 min-h-[40px] w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Phòng ban
                  </label>
                  <input
                    type="text"
                    value={empForm.department}
                    onChange={(e) =>
                      setEmpForm((p) => ({ ...p, department: e.target.value }))
                    }
                    className="mt-1 min-h-[40px] w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Chức vụ
                  </label>
                  <input
                    type="text"
                    value={empForm.position}
                    onChange={(e) =>
                      setEmpForm((p) => ({ ...p, position: e.target.value }))
                    }
                    className="mt-1 min-h-[40px] w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Vai trò hệ thống
                  </label>
                  <select
                    value={empForm.role}
                    onChange={(e) =>
                      setEmpForm((p) => ({
                        ...p,
                        role: e.target.value as UserRole,
                      }))
                    }
                    className="mt-1 min-h-[40px] w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                  >
                    <option value="employee">Nhân viên</option>
                    <option value="admin">Quản lý / Kế toán</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Hình thức tính lương
                  </label>
                  <select
                    value={empForm.pay_type}
                    onChange={(e) =>
                      setEmpForm((p) => ({
                        ...p,
                        pay_type: e.target.value as PayType,
                      }))
                    }
                    className="mt-1 min-h-[40px] w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                  >
                    <option value="hourly">Theo giờ</option>
                    <option value="daily">Theo ngày</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Đơn giá cơ bản (VNĐ)
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={1000}
                    value={empForm.base_rate_vnd}
                    onChange={(e) =>
                      setEmpForm((p) => ({
                        ...p,
                        base_rate_vnd: Number(e.target.value),
                      }))
                    }
                    className="mt-1 min-h-[40px] w-full rounded-xl border border-slate-200 px-3 py-2 font-mono text-sm"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Hệ số tăng ca (OT)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={4}
                    step={0.1}
                    value={empForm.ot_multiplier}
                    onChange={(e) =>
                      setEmpForm((p) => ({
                        ...p,
                        ot_multiplier: Number(e.target.value),
                      }))
                    }
                    className="mt-1 min-h-[40px] w-full rounded-xl border border-slate-200 px-3 py-2 font-mono text-sm"
                  />
                </div>
              </div>

              <label className="flex items-center gap-2.5 pt-1 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={empForm.is_active}
                  onChange={(e) =>
                    setEmpForm((p) => ({ ...p, is_active: e.target.checked }))
                  }
                  className="h-4 w-4 rounded border-slate-300 text-indigo-600"
                />
                <span>Tài khoản đang hoạt động</span>
              </label>

              <div className="flex justify-end gap-2.5 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={() => setEmpModalOpen(false)}
                  className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={empSaving}
                  className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
                >
                  {empSaving ? 'Đang lưu...' : 'Lưu hồ sơ'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

function LogsTable({
  logs,
  maxAccuracy,
  onInspectLog,
  onAdjustLog,
}: {
  logs: AttendanceLog[];
  maxAccuracy: number;
  onInspectLog: (log: AttendanceLog) => void;
  onAdjustLog: (log: AttendanceLog) => void;
}) {
  if (logs.length === 0) {
    return (
      <div className="px-6 py-10 text-center text-sm text-slate-500">
        Không có bản ghi chấm công nào phù hợp với điều kiện lọc.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[920px] text-left text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
          <tr>
            <th className="px-6 py-3">Thời gian máy chủ (UTC+7)</th>
            <th className="px-4 py-3">Nhân viên</th>
            <th className="px-4 py-3">Hành động</th>
            <th className="px-4 py-3 text-right">Khoảng cách / Sai số</th>
            <th className="px-4 py-3 text-right">Lệch giờ thiết bị</th>
            <th className="px-4 py-3">Trạng thái Geofence</th>
            <th className="px-6 py-3 text-right">Kiểm tra & Audit</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {logs.map((log) => {
            const hasWarning =
              log.clock_tamper_flag ||
              log.geofence_status !== 'valid' ||
              log.gps_accuracy_m > maxAccuracy;

            return (
              <tr
                key={log.id}
                onClick={() => onInspectLog(log)}
                className="cursor-pointer transition-colors hover:bg-slate-50"
              >
                <td className="px-6 py-3.5">
                  <p className="font-mono text-xs font-semibold text-slate-900 tabular-nums">
                    {formatDateTimeVN(log.server_timestamp)}
                  </p>
                  <p className="font-mono text-[11px] text-slate-400">
                    {log.id}
                    {log.is_adjusted ? ' · Đã điều chỉnh' : ''}
                  </p>
                </td>
                <td className="px-4 py-3.5">
                  <p className="font-semibold text-slate-900">
                    {log.employee_name}
                  </p>
                  <p className="font-mono text-xs text-slate-500">
                    {log.employee_code} · {log.department}
                  </p>
                </td>
                <td className="px-4 py-3.5 font-semibold">
                  {log.action === 'check_in' ? (
                    <span className="text-emerald-700">Vào ca</span>
                  ) : (
                    <span className="text-indigo-700">Ra ca</span>
                  )}
                </td>
                <td className="px-4 py-3.5 text-right font-mono text-xs tabular-nums">
                  <span className="font-semibold text-slate-900">
                    {Math.round(log.distance_to_office_m)}m
                  </span>
                  <span className="text-slate-400"> / </span>
                  <span
                    className={
                      log.gps_accuracy_m > maxAccuracy
                        ? 'font-semibold text-rose-700'
                        : 'text-slate-600'
                    }
                  >
                    ±{Math.round(log.gps_accuracy_m)}m
                  </span>
                </td>
                <td
                  className={`px-4 py-3.5 text-right font-mono text-xs font-semibold tabular-nums ${
                    log.clock_tamper_flag ? 'text-rose-700' : 'text-slate-600'
                  }`}
                >
                  {log.clock_drift_seconds}s
                  {log.clock_tamper_flag ? ' (Cảnh báo)' : ''}
                </td>
                <td className="px-4 py-3.5 text-xs">
                  {log.geofence_status === 'valid' && !hasWarning ? (
                    <span className="font-semibold text-emerald-700">
                      Hợp lệ trong vùng
                    </span>
                  ) : log.geofence_status === 'out_of_range_noted' ? (
                    <span className="inline-flex items-center gap-1 font-semibold text-amber-700">
                      <MapPin className="h-3.5 w-3.5" />
                      Ngoài vùng (Có ghi chú)
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 font-semibold text-rose-700">
                      <ShieldAlert className="h-3.5 w-3.5" />
                      Cảnh báo xác thực
                    </span>
                  )}
                </td>
                <td
                  className="px-6 py-3.5 text-right"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="inline-flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onInspectLog(log)}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      <span>Chứng cứ</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onAdjustLog(log)}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-50"
                    >
                      <FileEdit className="h-3.5 w-3.5" />
                      <span>Điều chỉnh</span>
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
