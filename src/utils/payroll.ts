import {
  AttendanceLog,
  CompanySettings,
  DateRangePreset,
  Employee,
  PayrollSummaryRow,
} from '../types';
import { getVNDateKey, getVNMinutesOfDay, normalizeFullName } from './forensics';

export function resolveDateBounds(
  preset: DateRangePreset,
  customStart?: string,
  customEnd?: string
): { startDateKey: string; endDateKey: string } {
  const nowIso = new Date().toISOString();
  const todayKey = getVNDateKey(nowIso);

  if (preset === 'today') {
    return { startDateKey: todayKey, endDateKey: todayKey };
  }

  if (preset === 'week') {
    const now = new Date(`${todayKey}T00:00:00+07:00`);
    const day = now.getDay(); // 0 Sun .. 6 Sat
    const diffToMonday = day === 0 ? 6 : day - 1;
    const monday = new Date(now.getTime() - diffToMonday * 86400000);
    return {
      startDateKey: getVNDateKey(monday.toISOString()),
      endDateKey: todayKey,
    };
  }

  if (preset === 'month') {
    return {
      startDateKey: `${todayKey.slice(0, 7)}-01`,
      endDateKey: todayKey,
    };
  }

  return {
    startDateKey: customStart || `${todayKey.slice(0, 7)}-01`,
    endDateKey: customEnd || todayKey,
  };
}

function parseHHMMToMinutes(hhmm: string): number {
  const [hStr, mStr] = hhmm.split(':');
  const h = Number(hStr) || 8;
  const m = Number(mStr) || 0;
  return h * 60 + m;
}

export function calculatePayrollSummary(
  employees: Employee[],
  logs: AttendanceLog[],
  settings: CompanySettings,
  startDateKey: string,
  endDateKey: string
): PayrollSummaryRow[] {
  const shiftStartMins = parseHHMMToMinutes(settings.shift_start_time);
  const graceMins = settings.grace_period_minutes;
  const standardHours = settings.standard_daily_hours || 8;
  const todayKey = getVNDateKey(new Date().toISOString());
  const nowMs = Date.now();

  const filteredLogs = logs.filter((log) => {
    const key = getVNDateKey(log.server_timestamp);
    return key >= startDateKey && key <= endDateKey;
  });

  return employees.map((emp) => {
    const normalizedEmpName = normalizeFullName(emp.full_name);
    const empLogs = filteredLogs
      .filter(
        (l) =>
          l.employee_id === emp.id ||
          (emp.employee_code !== 'TRA-CUU' && l.employee_code === emp.employee_code) ||
          normalizeFullName(l.employee_name) === normalizedEmpName
      )
      .sort(
        (a, b) =>
          new Date(a.server_timestamp).getTime() -
          new Date(b.server_timestamp).getTime()
      );

    let totalShifts = 0;
    let totalWorkHours = 0;
    let lateMinutes = 0;
    let overtimeHours = 0;
    let laborCostVnd = 0;
    let openCheckIn: AttendanceLog | null = null;

    const shiftDurations: number[] = [];

    for (const log of empLogs) {
      if (log.action === 'check_in') {
        totalShifts += 1;
        const checkInMins = getVNMinutesOfDay(log.server_timestamp);
        if (checkInMins > shiftStartMins + graceMins) {
          lateMinutes += checkInMins - shiftStartMins;
        }
        // If there was an unclosed previous check-in on an earlier day, close it cleanly as 4h or skip
        openCheckIn = log;
      } else if (log.action === 'check_out' && openCheckIn) {
        const startMs = new Date(openCheckIn.server_timestamp).getTime();
        const endMs = new Date(log.server_timestamp).getTime();
        const hours = Math.max(0, Math.min(16, (endMs - startMs) / 3600000));
        shiftDurations.push(hours);
        openCheckIn = null;
      }
    }

    const hasActiveShift = Boolean(
      openCheckIn && getVNDateKey(openCheckIn.server_timestamp) === todayKey
    );

    if (hasActiveShift && openCheckIn) {
      const startMs = new Date(openCheckIn.server_timestamp).getTime();
      const liveHours = Math.max(0, Math.min(12, (nowMs - startMs) / 3600000));
      shiftDurations.push(liveHours);
    }

    for (const hours of shiftDurations) {
      totalWorkHours += hours;
      const ot = Math.max(0, hours - standardHours);
      const regular = Math.max(0, hours - ot);
      overtimeHours += ot;

      if (emp.pay_type === 'hourly') {
        laborCostVnd +=
          regular * emp.base_rate_vnd +
          ot * emp.base_rate_vnd * (emp.ot_multiplier || 1.5);
      } else {
        const hourlyEquivalent = emp.base_rate_vnd / standardHours;
        const dailyRegularRatio = Math.min(1, regular / standardHours);
        laborCostVnd +=
          emp.base_rate_vnd * dailyRegularRatio +
          ot * hourlyEquivalent * (emp.ot_multiplier || 1.5);
      }
    }

    return {
      employee: emp,
      totalShifts,
      totalWorkHours: Number(totalWorkHours.toFixed(2)),
      lateMinutes: Math.round(lateMinutes),
      overtimeHours: Number(overtimeHours.toFixed(2)),
      laborCostVnd: Math.round(laborCostVnd),
      hasActiveShift,
    };
  });
}

export interface DashboardKpis {
  activeInShiftCount: number;
  totalActiveEmployees: number;
  lateTodayCount: number;
  alertCount: number;
  todayCostVnd: number;
  monthCostVnd: number;
}

export function calculateDashboardKpis(
  employees: Employee[],
  logs: AttendanceLog[],
  settings: CompanySettings
): DashboardKpis {
  const todayKey = getVNDateKey(new Date().toISOString());
  const monthStartKey = `${todayKey.slice(0, 7)}-01`;

  const todaySummary = calculatePayrollSummary(
    employees,
    logs,
    settings,
    todayKey,
    todayKey
  );
  const monthSummary = calculatePayrollSummary(
    employees,
    logs,
    settings,
    monthStartKey,
    todayKey
  );

  const activeInShiftCount = todaySummary.filter((r) => r.hasActiveShift).length;
  const lateTodayCount = todaySummary.filter((r) => r.lateMinutes > 0).length;

  const todayLogs = logs.filter((l) => getVNDateKey(l.server_timestamp) === todayKey);
  const alertCount = todayLogs.filter(
    (l) =>
      l.geofence_status !== 'valid' ||
      l.clock_tamper_flag ||
      l.gps_accuracy_m > settings.max_gps_accuracy_m
  ).length;

  const todayCostVnd = todaySummary.reduce((acc, r) => acc + r.laborCostVnd, 0);
  const monthCostVnd = monthSummary.reduce((acc, r) => acc + r.laborCostVnd, 0);

  return {
    activeInShiftCount,
    totalActiveEmployees: employees.filter((e) => e.is_active).length,
    lateTodayCount,
    alertCount,
    todayCostVnd,
    monthCostVnd,
  };
}
