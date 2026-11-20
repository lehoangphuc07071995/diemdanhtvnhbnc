import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  History,
  LogIn,
  LogOut,
  LogOut as ExitIcon,
  MapPin,
  RefreshCw,
  Search,
  User,
  X,
} from 'lucide-react';
import {
  AttendanceAction,
  AttendanceLog,
  CompanySettings,
  DateRangePreset,
  Employee,
  GeofenceStatus,
} from '../types';
import {
  burnForensicWatermarkAndCompress,
  formatDateTimeVN,
  formatDateVN,
  formatTimeVN,
  formatVnd,
  getVNDateKey,
  haversineDistanceMeters,
  normalizeFullName,
  reverseGeocodeNominatim,
} from '../utils/forensics';
import { calculatePayrollSummary, resolveDateBounds } from '../utils/payroll';
import { exportPersonalAttendanceExcel } from '../utils/excelExport';

interface EmployeeAttendanceViewProps {
  employee: Employee;
  settings: CompanySettings;
  logs: AttendanceLog[];
  isDemoMode: boolean;
  initialTab?: EmployeeTab;
  autoStartAction?: AttendanceAction | null;
  onAutoStartConsumed?: () => void;
  onSwitchLookupName?: (fullName: string) => Promise<void>;
  onSubmitAttendance: (payload: {
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
  }) => Promise<AttendanceLog>;
  onInspectLog: (log: AttendanceLog) => void;
  onLogout: () => void;
}

type EmployeeTab = 'checkin' | 'history' | 'profile';
type HistoryRangePreset = 'all' | DateRangePreset;
type FlowStep = 'idle' | 'camera_live' | 'submitting' | 'receipt';

interface GpsReading {
  latitude: number;
  longitude: number;
  accuracy: number;
  distance: number;
  address: string;
}

interface DailyShiftCard {
  id: string;
  dateKey: string;
  dateLabel: string;
  checkIn: AttendanceLog | null;
  checkOut: AttendanceLog | null;
  durationLabel: string;
}

function formatSimpleLocationStatus(status: GeofenceStatus): {
  label: string;
  className: string;
} {
  if (status === 'valid') {
    return { label: 'Đúng vị trí', className: 'text-emerald-700' };
  }
  if (status === 'out_of_range_noted') {
    return { label: 'Ngoài khu vực (có lý do)', className: 'text-amber-700' };
  }
  return { label: 'Ngoài vị trí', className: 'text-rose-700' };
}

function formatWeekdayDateVN(dateKey: string): string {
  const d = new Date(`${dateKey}T12:00:00+07:00`);
  if (Number.isNaN(d.getTime())) return dateKey;
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d);
}

function buildDailyShiftCards(logs: AttendanceLog[], todayKey: string): DailyShiftCard[] {
  const byDate = new Map<string, AttendanceLog[]>();
  const chronological = [...logs].sort(
    (a, b) =>
      new Date(a.server_timestamp).getTime() - new Date(b.server_timestamp).getTime()
  );

  for (const log of chronological) {
    const key = getVNDateKey(log.server_timestamp);
    const list = byDate.get(key) || [];
    list.push(log);
    byDate.set(key, list);
  }

  const cards: DailyShiftCard[] = [];
  const sortedDates = Array.from(byDate.keys()).sort((a, b) => b.localeCompare(a));

  for (const dateKey of sortedDates) {
    const dayLogs = byDate.get(dateKey) || [];
    const dateLabel = formatWeekdayDateVN(dateKey);
    let pendingIn: AttendanceLog | null = null;
    let pairIndex = 0;

    for (const log of dayLogs) {
      if (log.action === 'check_in') {
        if (pendingIn) {
          cards.push({
            id: `${dateKey}-${pairIndex++}`,
            dateKey,
            dateLabel,
            checkIn: pendingIn,
            checkOut: null,
            durationLabel: 'Chưa chấm ra ca',
          });
        }
        pendingIn = log;
      } else if (log.action === 'check_out') {
        if (pendingIn) {
          const diffHrs = Math.max(
            0,
            (new Date(log.server_timestamp).getTime() -
              new Date(pendingIn.server_timestamp).getTime()) /
              3600000
          );
          cards.push({
            id: `${dateKey}-${pairIndex++}`,
            dateKey,
            dateLabel,
            checkIn: pendingIn,
            checkOut: log,
            durationLabel: `${diffHrs.toFixed(1)} giờ`,
          });
          pendingIn = null;
        } else {
          cards.push({
            id: `${dateKey}-${pairIndex++}`,
            dateKey,
            dateLabel,
            checkIn: null,
            checkOut: log,
            durationLabel: 'Chỉ ghi nhận ra ca',
          });
        }
      }
    }

    if (pendingIn) {
      cards.push({
        id: `${dateKey}-${pairIndex++}`,
        dateKey,
        dateLabel,
        checkIn: pendingIn,
        checkOut: null,
        durationLabel: dateKey === todayKey ? 'Đang trong ca' : 'Chưa chấm ra ca',
      });
    }
  }

  // Sort newest shift first
  return cards.sort((a, b) => {
    const aTime = new Date(
      (a.checkOut || a.checkIn)!.server_timestamp
    ).getTime();
    const bTime = new Date(
      (b.checkOut || b.checkIn)!.server_timestamp
    ).getTime();
    return bTime - aTime;
  });
}

export const EmployeeAttendanceView: React.FC<EmployeeAttendanceViewProps> = ({
  employee,
  settings,
  logs,
  isDemoMode,
  initialTab = 'checkin',
  autoStartAction,
  onAutoStartConsumed,
  onSwitchLookupName,
  onSubmitAttendance,
  onInspectLog,
  onLogout,
}) => {
  const [activeTab, setActiveTab] = useState<EmployeeTab>(initialTab);
  const [now, setNow] = useState(() => new Date());

  // History lookup & extraction state
  const [lookupInput, setLookupInput] = useState<string>(employee.full_name);
  const [historyRange, setHistoryRange] = useState<HistoryRangePreset>('all');
  const [customStart, setCustomStart] = useState<string>(() => {
    const today = getVNDateKey(new Date().toISOString());
    return `${today.slice(0, 7)}-01`;
  });
  const [customEnd, setCustomEnd] = useState<string>(() =>
    getVNDateKey(new Date().toISOString())
  );
  const [copiedSummary, setCopiedSummary] = useState<boolean>(false);

  // Unified Camera + GPS Flow state
  const [pendingAction, setPendingAction] = useState<AttendanceAction>('check_in');
  const [flowStep, setFlowStep] = useState<FlowStep>('idle');
  const [gpsLoading, setGpsLoading] = useState<boolean>(false);
  const [gpsReading, setGpsReading] = useState<GpsReading | null>(null);
  const [gpsError, setGpsError] = useState<string>('');
  const [outOfRangeNote, setOutOfRangeNote] = useState<string>('');
  const [cameraError, setCameraError] = useState<string>('');
  const [cameraReady, setCameraReady] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string>('');
  const [receiptLog, setReceiptLog] = useState<AttendanceLog | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    setLookupInput(employee.full_name);
  }, [employee.full_name]);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  // Live clock tick every second
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const stopCameraStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraReady(false);
  }, []);

  useEffect(() => {
    return () => stopCameraStream();
  }, [stopCameraStream]);

  const myLogs = useMemo(() => {
    const normalizedName = normalizeFullName(employee.full_name);
    return logs
      .filter(
        (l) =>
          l.employee_id === employee.id ||
          (employee.employee_code !== 'TRA-CUU' &&
            l.employee_code === employee.employee_code) ||
          normalizeFullName(l.employee_name) === normalizedName
      )
      .sort(
        (a, b) =>
          new Date(b.server_timestamp).getTime() -
          new Date(a.server_timestamp).getTime()
      );
  }, [logs, employee]);

  const historyBounds = useMemo(() => {
    if (historyRange === 'all') {
      return { startDateKey: '2000-01-01', endDateKey: '2099-12-31' };
    }
    return resolveDateBounds(historyRange, customStart, customEnd);
  }, [historyRange, customStart, customEnd]);

  const filteredMyLogs = useMemo(() => {
    if (historyRange === 'all') return myLogs;
    return myLogs.filter((l) => {
      const k = getVNDateKey(l.server_timestamp);
      return k >= historyBounds.startDateKey && k <= historyBounds.endDateKey;
    });
  }, [myLogs, historyRange, historyBounds]);

  const historySummary = useMemo(() => {
    const rows = calculatePayrollSummary(
      [employee],
      filteredMyLogs,
      settings,
      historyBounds.startDateKey,
      historyBounds.endDateKey
    );
    return rows[0];
  }, [employee, filteredMyLogs, settings, historyBounds]);

  const todayKey = getVNDateKey(now.toISOString());
  const todayLogs = useMemo(
    () => myLogs.filter((l) => getVNDateKey(l.server_timestamp) === todayKey),
    [myLogs, todayKey]
  );

  const todayCheckInLog = useMemo(
    () => todayLogs.find((l) => l.action === 'check_in') || null,
    [todayLogs]
  );
  const todayCheckOutLog = useMemo(
    () => todayLogs.find((l) => l.action === 'check_out') || null,
    [todayLogs]
  );

  const latestTodayLog = todayLogs[0] || null;
  const isCurrentlyInShift = latestTodayLog?.action === 'check_in';
  const hasCompletedToday = latestTodayLog?.action === 'check_out';

  const dailyShiftCards = useMemo(
    () => buildDailyShiftCards(filteredMyLogs, todayKey),
    [filteredMyLogs, todayKey]
  );

  const monthStartKey = `${todayKey.slice(0, 7)}-01`;
  const monthSummary = useMemo(() => {
    const rows = calculatePayrollSummary(
      [employee],
      logs,
      settings,
      monthStartKey,
      todayKey
    );
    return rows[0];
  }, [employee, logs, settings, monthStartKey, todayKey]);

  const acquireGps = useCallback(() => {
    setGpsLoading(true);
    setGpsError('');
    setGpsReading(null);

    if (!navigator.geolocation) {
      setGpsError('Thiết bị này không hỗ trợ định vị GPS.');
      setGpsLoading(false);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const acc = Math.round(pos.coords.accuracy);
        const dist = haversineDistanceMeters(
          lat,
          lng,
          settings.latitude,
          settings.longitude
        );
        const address = await reverseGeocodeNominatim(lat, lng);
        setGpsReading({
          latitude: lat,
          longitude: lng,
          accuracy: acc,
          distance: dist,
          address,
        });
        setGpsLoading(false);
      },
      (err) => {
        let msg = 'Chưa lấy được vị trí GPS.';
        if (err.code === err.PERMISSION_DENIED) {
          msg =
            'Bạn chưa cho phép quyền Vị trí (GPS). Vui lòng bật Vị trí trên điện thoại và cho phép trình duyệt truy cập.';
        } else if (err.code === err.TIMEOUT) {
          msg =
            'Tín hiệu GPS hơi yếu. Vui lòng đứng ra chỗ thoáng hơn rồi bấm "Lấy lại vị trí".';
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          msg = 'Chưa bật định vị GPS trên điện thoại.';
        }
        setGpsError(msg);
        setGpsLoading(false);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 10000,
      }
    );
  }, [settings.latitude, settings.longitude]);

  const openLiveCamera = useCallback(async () => {
    setCameraError('');
    setCameraReady(false);
    stopCameraStream();

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError('Trình duyệt không hỗ trợ mở camera trực tiếp.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setCameraReady(true);
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Chưa được cấp quyền Camera';
      setCameraError(
        `Không mở được camera: ${message}. Vui lòng bấm Cho phép Camera để chụp ảnh.`
      );
    }
  }, [stopCameraStream]);

  // Unified 1-step flow: open Camera immediately AND lock GPS in parallel
  const startAttendanceFlow = useCallback(
    (action: AttendanceAction) => {
      setPendingAction(action);
      setOutOfRangeNote('');
      setCameraError('');
      setSubmitError('');
      setReceiptLog(null);
      setFlowStep('camera_live');
      acquireGps();
      openLiveCamera();
    },
    [acquireGps, openLiveCamera]
  );

  useEffect(() => {
    if (autoStartAction) {
      startAttendanceFlow(autoStartAction);
      onAutoStartConsumed?.();
    }
  }, [autoStartAction, onAutoStartConsumed, startAttendanceFlow]);

  const handleUseDemoOfficeGps = () => {
    setGpsError('');
    setGpsLoading(false);
    const lat = settings.latitude + 0.00008;
    const lng = settings.longitude + 0.00006;
    const dist = haversineDistanceMeters(
      lat,
      lng,
      settings.latitude,
      settings.longitude
    );
    setGpsReading({
      latitude: lat,
      longitude: lng,
      accuracy: 12,
      distance: dist,
      address: settings.office_address,
    });
  };

  const isAccuracyValid = gpsReading
    ? gpsReading.accuracy <= settings.max_gps_accuracy_m
    : false;
  const isInsideGeofence = gpsReading
    ? gpsReading.distance <= settings.geofence_radius_m
    : false;
  const requiresNote = Boolean(
    gpsReading &&
      isAccuracyValid &&
      !isInsideGeofence &&
      settings.allow_out_of_office_with_note
  );
  const canProceedToCapture = Boolean(
    gpsReading &&
      isAccuracyValid &&
      (isInsideGeofence ||
        (settings.allow_out_of_office_with_note &&
          outOfRangeNote.trim().length >= 8))
  );

  const handleCaptureAndConfirm = async (useFallbackDemoCanvas = false) => {
    if (!gpsReading || !canProceedToCapture) return;
    setSubmitError('');

    const deviceTimestamp = new Date().toISOString();
    const actionLabel =
      pendingAction === 'check_in' ? 'VÀO CA (CHECK-IN)' : 'RA CA (CHECK-OUT)';

    let sourceEl: HTMLVideoElement | HTMLCanvasElement;

    if (!useFallbackDemoCanvas && videoRef.current && cameraReady) {
      sourceEl = videoRef.current;
    } else if (useFallbackDemoCanvas && isDemoMode) {
      const fallbackCanvas = document.createElement('canvas');
      fallbackCanvas.width = 960;
      fallbackCanvas.height = 720;
      const ctx = fallbackCanvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#0F172A';
        ctx.fillRect(0, 0, 960, 720);
        ctx.fillStyle = '#1E293B';
        ctx.fillRect(40, 40, 880, 640);
        ctx.fillStyle = '#E2E8F0';
        ctx.font = 'bold 30px "Plus Jakarta Sans", sans-serif';
        ctx.fillText('ẢNH XÁC THỰC CHẾ ĐỘ DEMO', 240, 320);
        ctx.font = '22px "Plus Jakarta Sans", sans-serif';
        ctx.fillStyle = '#94A3B8';
        ctx.fillText(employee.full_name, 330, 370);
      }
      sourceEl = fallbackCanvas;
    } else {
      setSubmitError('Camera đang bật, vui lòng chờ 1 giây rồi bấm lại.');
      return;
    }

    setFlowStep('submitting');
    try {
      const captured = await burnForensicWatermarkAndCompress(sourceEl, {
        employeeName: employee.full_name,
        employeeCode: employee.employee_code,
        actionLabel,
        timestampIso: deviceTimestamp,
        latitude: gpsReading.latitude,
        longitude: gpsReading.longitude,
        accuracyMeters: gpsReading.accuracy,
        distanceMeters: gpsReading.distance,
        addressText: gpsReading.address,
      });

      const geofenceStatus: GeofenceStatus = isInsideGeofence
        ? 'valid'
        : settings.allow_out_of_office_with_note
          ? 'out_of_range_noted'
          : 'violation';

      const created = await onSubmitAttendance({
        action: pendingAction,
        deviceTimestamp,
        latitude: gpsReading.latitude,
        longitude: gpsReading.longitude,
        gpsAccuracyM: gpsReading.accuracy,
        distanceToOfficeM: gpsReading.distance,
        geofenceStatus,
        addressText: gpsReading.address,
        photoBlob: captured.blob,
        photoDataUrl: captured.dataUrl,
        integrityHash: captured.integrityHash,
        note: outOfRangeNote.trim(),
      });

      stopCameraStream();
      setReceiptLog(created);
      setFlowStep('receipt');
    } catch (err) {
      setSubmitError(
        err instanceof Error
          ? err.message
          : 'Lưu điểm danh chưa thành công. Vui lòng thử lại.'
      );
      setFlowStep('camera_live');
    }
  };

  const closeFlow = () => {
    stopCameraStream();
    setFlowStep('idle');
    setGpsLoading(false);
    setGpsReading(null);
    setGpsError('');
    setCameraError('');
    setSubmitError('');
  };

  const vnTimeString = new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(now);

  const vnDateString = new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(now);

  // Determine clear capture button label
  const captureButtonLabel = (() => {
    if (flowStep === 'submitting') return 'Đang chụp & lưu ghi nhận...';
    if (gpsLoading) return 'Đang lấy vị trí GPS...';
    if (!gpsReading || !isAccuracyValid) return 'Chưa có vị trí hợp lệ';
    if (!isInsideGeofence && !settings.allow_out_of_office_with_note) {
      return 'Đang ở ngoài khu vực làm việc';
    }
    if (requiresNote && outOfRangeNote.trim().length < 8) {
      return 'Vui lòng nhập lý do bên trên';
    }
    if (!cameraReady) return 'Đang bật Camera...';
    return pendingAction === 'check_in'
      ? 'CHỤP ẢNH & LƯU VÀO CA'
      : 'CHỤP ẢNH & LƯU RA CA';
  })();

  return (
    <div className="mx-auto w-full max-w-5xl px-3.5 pt-3.5 pb-24 sm:px-6 sm:pt-5 lg:pb-10">
      {/* Mobile compact identity header */}
      <div className="mb-3.5 flex items-center justify-between gap-2.5 rounded-2xl border border-slate-200 bg-white px-3.5 py-2.5 md:hidden">
        <div className="flex min-w-0 items-center gap-2.5">
          <img
            src="/logo-square.png"
            alt="Logo Điểm Danh"
            className="h-10 w-10 shrink-0 rounded-xl border border-slate-200 object-cover"
          />
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-slate-900">
              {employee.full_name}
            </p>
            <p
              className={`text-xs font-semibold ${
                isCurrentlyInShift
                  ? 'text-emerald-700'
                  : hasCompletedToday
                    ? 'text-indigo-700'
                    : 'text-slate-500'
              }`}
            >
              {isCurrentlyInShift
                ? `Đang làm việc · Vào lúc ${formatTimeVN(latestTodayLog.server_timestamp)}`
                : hasCompletedToday
                  ? `Đã xong ca · Ra lúc ${formatTimeVN(latestTodayLog.server_timestamp)}`
                  : 'Chưa chấm vào ca hôm nay'}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onLogout}
          className="inline-flex min-h-[38px] shrink-0 items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
        >
          <ExitIcon className="h-3.5 w-3.5" />
          <span>Thoát</span>
        </button>
      </div>

      {/* Desktop inline view switcher */}
      <div className="mb-6 hidden items-center justify-between gap-4 border-b border-slate-200 pb-4 md:flex">
        <div className="flex items-center gap-3.5">
          <img
            src="/logo-square.png"
            alt="Logo Điểm Danh"
            className="h-11 w-11 shrink-0 rounded-xl border border-slate-200 object-cover"
          />
          <div>
            <h1 className="text-xl font-bold text-slate-900">
              {employee.full_name}
            </h1>
            <p className="mt-0.5 text-sm text-slate-500">
              {employee.department} · Giờ làm chuẩn {settings.shift_start_time} – {settings.shift_end_time}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => setActiveTab('checkin')}
              className={`min-h-[40px] rounded-lg px-4 py-2 text-sm font-semibold whitespace-nowrap transition-colors ${
                activeTab === 'checkin'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Chấm công
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('history')}
              className={`min-h-[40px] rounded-lg px-4 py-2 text-sm font-semibold whitespace-nowrap transition-colors ${
                activeTab === 'history'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Vào / Ra & Lịch sử ({myLogs.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('profile')}
              className={`min-h-[40px] rounded-lg px-4 py-2 text-sm font-semibold whitespace-nowrap transition-colors ${
                activeTab === 'profile'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Cá nhân
            </button>
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 whitespace-nowrap hover:bg-slate-50"
          >
            <ExitIcon className="h-3.5 w-3.5" />
            <span>Thoát</span>
          </button>
        </div>
      </div>

      {/* TAB 1: SIMPLE 1-TAP CHECK-IN / CHECK-OUT */}
      {activeTab === 'checkin' && (
        <div className="space-y-4 sm:space-y-5">
          {/* Clock & Main Action Card */}
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="flex flex-wrap items-center justify-between gap-3 bg-gradient-to-r from-[#0B1E36] to-[#122D4F] px-4 py-4 text-white sm:px-7 sm:py-6">
              <div>
                <p className="text-xs font-medium text-slate-300 capitalize">
                  {vnDateString}
                </p>
                <p className="mt-0.5 font-mono text-3xl font-bold tracking-tight text-white tabular-nums sm:mt-1 sm:text-5xl">
                  {vnTimeString}
                </p>
              </div>

              <div className="text-left sm:text-right">
                <p className="text-xs text-slate-300">Trạng thái hôm nay</p>
                {isCurrentlyInShift ? (
                  <p className="mt-1 inline-flex items-center gap-1.5 text-sm font-bold text-emerald-300 sm:text-base">
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                    <span>
                      Đã vào ca lúc {formatTimeVN(latestTodayLog.server_timestamp)}
                    </span>
                  </p>
                ) : hasCompletedToday ? (
                  <p className="mt-1 inline-flex items-center gap-1.5 text-sm font-bold text-amber-300 sm:text-base">
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                    <span>
                      Đã ra ca lúc {formatTimeVN(latestTodayLog.server_timestamp)}
                    </span>
                  </p>
                ) : (
                  <p className="mt-1 inline-flex items-center gap-1.5 text-sm font-semibold text-slate-200 sm:text-base">
                    <Clock className="h-4 w-4 shrink-0 text-slate-300" />
                    <span>Chưa chấm vào ca</span>
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-4 p-4 sm:p-6">
              {/* Two Big, Unmistakable Camera Action Buttons */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
                <button
                  type="button"
                  onClick={() => startAttendanceFlow('check_in')}
                  className={`flex min-h-[76px] w-full items-center justify-center gap-3 rounded-2xl px-5 py-4 text-base font-bold transition-all active:scale-[0.99] ${
                    !isCurrentlyInShift
                      ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                      : 'border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <Camera className="h-6 w-6 shrink-0" />
                  <span>MỞ CAMERA CHẤM VÀO CA</span>
                </button>

                <button
                  type="button"
                  onClick={() => startAttendanceFlow('check_out')}
                  className={`flex min-h-[76px] w-full items-center justify-center gap-3 rounded-2xl px-5 py-4 text-base font-bold transition-all active:scale-[0.99] ${
                    isCurrentlyInShift
                      ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                      : 'border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <Camera className="h-6 w-6 shrink-0" />
                  <span>MỞ CAMERA CHẤM RA CA</span>
                </button>
              </div>

              <p className="text-center text-xs text-slate-500">
                Bấm nút phía trên để mở Camera chụp ảnh khuôn mặt trực tiếp và lưu giờ chấm công.
              </p>
            </div>
          </div>

          {/* Today's Clear Check-In & Check-Out Pair Card */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-900 sm:text-base">
                Chấm vào / Chấm ra hôm nay ({formatDateVN(now.toISOString())})
              </h2>
              <button
                type="button"
                onClick={() => setActiveTab('history')}
                className="text-xs font-semibold text-indigo-600 hover:underline"
              >
                Xem tất cả ngày
              </button>
            </div>

            <div className="mt-3.5 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {/* Today Check-in Box */}
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5">
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700">
                    <LogIn className="h-4 w-4" />
                    GIỜ VÀO CA
                  </span>
                  {todayCheckInLog && (
                    <span
                      className={`text-xs font-semibold ${
                        formatSimpleLocationStatus(todayCheckInLog.geofence_status)
                          .className
                      }`}
                    >
                      {
                        formatSimpleLocationStatus(todayCheckInLog.geofence_status)
                          .label
                      }
                    </span>
                  )}
                </div>

                {todayCheckInLog ? (
                  <button
                    type="button"
                    onClick={() => onInspectLog(todayCheckInLog)}
                    className="mt-2.5 flex w-full items-center gap-3 text-left"
                  >
                    <img
                      src={todayCheckInLog.photo_url}
                      alt="Ảnh vào ca hôm nay"
                      referrerPolicy="no-referrer"
                      className="h-14 w-16 shrink-0 rounded-lg border border-slate-200 object-cover"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-xl font-bold text-slate-900 tabular-nums">
                        {formatTimeVN(todayCheckInLog.server_timestamp)}
                      </p>
                      <p className="truncate text-xs text-slate-500">
                        {todayCheckInLog.address_text}
                      </p>
                      <span className="text-[11px] font-semibold text-indigo-600">
                        Chạm để xem ảnh lớn
                      </span>
                    </div>
                  </button>
                ) : (
                  <p className="mt-3 text-sm text-slate-400">Chưa chấm vào ca</p>
                )}
              </div>

              {/* Today Check-out Box */}
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5">
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold text-indigo-700">
                    <LogOut className="h-4 w-4" />
                    GIỜ RA CA
                  </span>
                  {todayCheckOutLog && (
                    <span
                      className={`text-xs font-semibold ${
                        formatSimpleLocationStatus(todayCheckOutLog.geofence_status)
                          .className
                      }`}
                    >
                      {
                        formatSimpleLocationStatus(todayCheckOutLog.geofence_status)
                          .label
                      }
                    </span>
                  )}
                </div>

                {todayCheckOutLog ? (
                  <button
                    type="button"
                    onClick={() => onInspectLog(todayCheckOutLog)}
                    className="mt-2.5 flex w-full items-center gap-3 text-left"
                  >
                    <img
                      src={todayCheckOutLog.photo_url}
                      alt="Ảnh ra ca hôm nay"
                      referrerPolicy="no-referrer"
                      className="h-14 w-16 shrink-0 rounded-lg border border-slate-200 object-cover"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-xl font-bold text-slate-900 tabular-nums">
                        {formatTimeVN(todayCheckOutLog.server_timestamp)}
                      </p>
                      <p className="truncate text-xs text-slate-500">
                        {todayCheckOutLog.address_text}
                      </p>
                      <span className="text-[11px] font-semibold text-indigo-600">
                        Chạm để xem ảnh lớn
                      </span>
                    </div>
                  </button>
                ) : (
                  <p className="mt-3 text-sm text-slate-400">Chưa chấm ra ca</p>
                )}
              </div>
            </div>

            <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs text-slate-500">
              <span>Điểm làm việc: {settings.office_address}</span>
              <span className="font-mono font-semibold text-slate-700 tabular-nums">
                Tháng này: {monthSummary?.totalShifts ?? 0} ngày ({monthSummary?.totalWorkHours ?? 0} giờ)
              </span>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: SIMPLE & CLEAR DAILY CHECK-IN / CHECK-OUT HISTORY + EXTRACTION */}
      {activeTab === 'history' && (
        <div className="space-y-4 sm:space-y-5">
          {/* Quick Lookup by Exact Full Name */}
          {onSwitchLookupName && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (lookupInput.trim().length >= 2) {
                  onSwitchLookupName(lookupInput.trim());
                }
              }}
              className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5"
            >
              <label
                htmlFor="history-name-lookup"
                className="block text-sm font-bold text-slate-800"
              >
                Xem dữ liệu chấm công theo Họ và tên
              </label>
              <div className="mt-2.5 flex flex-col gap-2.5 sm:flex-row">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    id="history-name-lookup"
                    type="text"
                    value={lookupInput}
                    onChange={(e) => setLookupInput(e.target.value)}
                    placeholder="Nhập đúng Họ và tên cần xem..."
                    className="min-h-[48px] w-full rounded-xl border border-slate-300 bg-white py-2.5 pr-4 pl-10 text-base text-slate-900 focus:border-indigo-600 focus:ring-2 focus:ring-indigo-600/20 focus:outline-none sm:text-sm"
                  />
                </div>
                <button
                  type="submit"
                  className="inline-flex min-h-[48px] shrink-0 items-center justify-center gap-2 rounded-xl bg-[#0B1E36] px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#132C4E]"
                >
                  <Search className="h-4 w-4" />
                  <span>Xem dữ liệu</span>
                </button>
              </div>
            </form>
          )}

          {/* Current Shift Status & 1-Tap Camera Button */}
          <div className="flex flex-col justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:p-5">
            <div>
              <p className="text-xs text-slate-500">
                Nhân sự:{' '}
                <span className="font-bold text-slate-900">{employee.full_name}</span>
              </p>
              {isCurrentlyInShift ? (
                <p className="mt-1 inline-flex items-center gap-1.5 text-sm font-bold text-emerald-700">
                  <CheckCircle2 className="h-4 w-4" />
                  <span>
                    Hôm nay đang trong ca (Vào lúc {formatTimeVN(latestTodayLog.server_timestamp)})
                  </span>
                </p>
              ) : hasCompletedToday ? (
                <p className="mt-1 inline-flex items-center gap-1.5 text-sm font-bold text-indigo-700">
                  <CheckCircle2 className="h-4 w-4" />
                  <span>
                    Hôm nay đã xong ca (Ra lúc {formatTimeVN(latestTodayLog.server_timestamp)})
                  </span>
                </p>
              ) : (
                <p className="mt-1 inline-flex items-center gap-1.5 text-sm font-semibold text-slate-700">
                  <Clock className="h-4 w-4 text-slate-400" />
                  <span>Hôm nay chưa chấm vào ca</span>
                </p>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              {!isCurrentlyInShift ? (
                <button
                  type="button"
                  onClick={() => startAttendanceFlow('check_in')}
                  className="inline-flex min-h-[46px] flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 sm:flex-initial"
                >
                  <Camera className="h-4 w-4" />
                  <span>Chụp chấm VÀO CA</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => startAttendanceFlow('check_out')}
                  className="inline-flex min-h-[46px] flex-1 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-indigo-700 sm:flex-initial"
                >
                  <Camera className="h-4 w-4" />
                  <span>Chụp chấm RA CA</span>
                </button>
              )}
            </div>
          </div>

          {/* Filter, Totals & Excel Export */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  Lịch sử Chấm vào — Chấm ra của {employee.full_name}
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Hiển thị gọn gàng theo từng ngày làm việc. Chạm vào ảnh để xem chi tiết.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={filteredMyLogs.length === 0}
                  onClick={async () => {
                    const lines = [
                      `BẢNG CHẤM CÔNG - ${employee.full_name.toUpperCase()}`,
                      `Số ngày công: ${historySummary?.totalShifts ?? 0} | Tổng giờ: ${historySummary?.totalWorkHours ?? 0} giờ`,
                      '----------------------------------------',
                      ...dailyShiftCards.map((card) => {
                        const inTxt = card.checkIn
                          ? `Vào: ${formatTimeVN(card.checkIn.server_timestamp)}`
                          : 'Vào: Chưa chấm';
                        const outTxt = card.checkOut
                          ? `Ra: ${formatTimeVN(card.checkOut.server_timestamp)}`
                          : 'Ra: Chưa chấm';
                        return `${card.dateLabel}\n  • ${inTxt} | ${outTxt} (${card.durationLabel})`;
                      }),
                    ].join('\n');
                    try {
                      await navigator.clipboard.writeText(lines);
                      setCopiedSummary(true);
                      window.setTimeout(() => setCopiedSummary(false), 2500);
                    } catch {
                      // Ignore clipboard errors
                    }
                  }}
                  className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  {copiedSummary ? (
                    <>
                      <Check className="h-4 w-4 text-emerald-600" />
                      <span className="text-emerald-700">Đã sao chép</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4" />
                      <span>Sao chép</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const periodLabel =
                      historyRange === 'all'
                        ? 'Tat_Ca'
                        : `${historyBounds.startDateKey}_den_${historyBounds.endDateKey}`;
                    exportPersonalAttendanceExcel({
                      employeeName: employee.full_name,
                      employeeCode: employee.employee_code,
                      department: employee.department,
                      summaryRow: historySummary,
                      logs: filteredMyLogs,
                      periodLabel,
                    });
                  }}
                  className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-emerald-700"
                >
                  <Download className="h-4 w-4" />
                  <span>Tải file Excel</span>
                </button>
              </div>
            </div>

            {/* Date Filter Buttons */}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {(
                [
                  { key: 'all', label: 'Tất cả' },
                  { key: 'today', label: 'Hôm nay' },
                  { key: 'week', label: 'Tuần này' },
                  { key: 'month', label: 'Tháng này' },
                  { key: 'custom', label: 'Chọn ngày' },
                ] as const
              ).map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setHistoryRange(item.key)}
                  className={`min-h-[38px] rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                    historyRange === item.key
                      ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>

            {historyRange === 'custom' && (
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="history-custom-start"
                    className="block text-xs font-medium text-slate-600"
                  >
                    Từ ngày
                  </label>
                  <input
                    id="history-custom-start"
                    type="date"
                    value={customStart}
                    onChange={(e) => setCustomStart(e.target.value)}
                    className="mt-1 min-h-[42px] w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900"
                  />
                </div>
                <div>
                  <label
                    htmlFor="history-custom-end"
                    className="block text-xs font-medium text-slate-600"
                  >
                    Đến ngày
                  </label>
                  <input
                    id="history-custom-end"
                    type="date"
                    value={customEnd}
                    onChange={(e) => setCustomEnd(e.target.value)}
                    className="mt-1 min-h-[42px] w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900"
                  />
                </div>
              </div>
            )}

            {/* Simple 3-Number Summary */}
            <div className="mt-4 grid grid-cols-3 gap-2.5 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:gap-4 sm:p-4">
              <div>
                <p className="text-[11px] text-slate-500 sm:text-xs">Số ngày công</p>
                <p className="mt-0.5 font-mono text-base font-bold text-slate-900 tabular-nums sm:text-xl">
                  {historySummary?.totalShifts ?? 0} ca
                </p>
              </div>
              <div>
                <p className="text-[11px] text-slate-500 sm:text-xs">Tổng giờ làm</p>
                <p className="mt-0.5 font-mono text-base font-bold text-indigo-700 tabular-nums sm:text-xl">
                  {historySummary?.totalWorkHours ?? 0} giờ
                </p>
              </div>
              <div>
                <p className="text-[11px] text-slate-500 sm:text-xs">Tổng lượt bấm</p>
                <p className="mt-0.5 font-mono text-base font-bold text-slate-900 tabular-nums sm:text-xl">
                  {filteredMyLogs.length} lượt
                </p>
              </div>
            </div>
          </div>

          {/* Daily Check-in / Check-out Cards */}
          {dailyShiftCards.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
              <p className="text-sm font-semibold text-slate-800">
                Chưa có dữ liệu chấm công cho &ldquo;{employee.full_name}&rdquo;
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Kiểm tra lại đúng Họ và tên có dấu, hoặc bấm nút Chụp chấm VÀO CA phía trên để bắt đầu.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {dailyShiftCards.map((card) => (
                <div
                  key={card.id}
                  className="overflow-hidden rounded-2xl border border-slate-200 bg-white"
                >
                  {/* Card Header: Date & Hours */}
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2.5 sm:px-5">
                    <span className="text-xs font-bold text-slate-900 capitalize sm:text-sm">
                      {card.dateLabel}
                    </span>
                    <span className="font-mono text-xs font-bold text-indigo-700 tabular-nums">
                      {card.durationLabel}
                    </span>
                  </div>

                  {/* Two Simple Columns: VÀO CA & RA CA */}
                  <div className="grid grid-cols-1 divide-y divide-slate-100 sm:grid-cols-2 sm:divide-x sm:divide-y-0">
                    {/* VÀO CA */}
                    <div className="p-3.5 sm:p-4">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-emerald-700">
                          VÀO CA
                        </span>
                        {card.checkIn && (
                          <span
                            className={`text-[11px] font-semibold ${
                              formatSimpleLocationStatus(card.checkIn.geofence_status)
                                .className
                            }`}
                          >
                            {
                              formatSimpleLocationStatus(card.checkIn.geofence_status)
                                .label
                            }
                          </span>
                        )}
                      </div>

                      {card.checkIn ? (
                        <button
                          type="button"
                          onClick={() => onInspectLog(card.checkIn!)}
                          className="mt-2 flex w-full items-center gap-3 rounded-xl p-1 text-left transition-colors hover:bg-slate-50"
                        >
                          <img
                            src={card.checkIn.photo_url}
                            alt={`Ảnh vào ca ${card.dateLabel}`}
                            referrerPolicy="no-referrer"
                            className="h-16 w-20 shrink-0 rounded-lg border border-slate-200 object-cover"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="font-mono text-lg font-bold text-slate-900 tabular-nums">
                              {formatTimeVN(card.checkIn.server_timestamp)}
                            </p>
                            <p className="truncate text-xs text-slate-500">
                              {card.checkIn.address_text}
                            </p>
                            {card.checkIn.note && (
                              <p className="mt-0.5 truncate text-[11px] text-amber-700">
                                Lý do: {card.checkIn.note}
                              </p>
                            )}
                            <span className="mt-0.5 inline-block text-[11px] font-semibold text-indigo-600">
                              Xem ảnh & chi tiết
                            </span>
                          </div>
                        </button>
                      ) : (
                        <p className="mt-3 text-xs text-slate-400">
                          Không có lượt vào ca
                        </p>
                      )}
                    </div>

                    {/* RA CA */}
                    <div className="p-3.5 sm:p-4">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-indigo-700">
                          RA CA
                        </span>
                        {card.checkOut && (
                          <span
                            className={`text-[11px] font-semibold ${
                              formatSimpleLocationStatus(
                                card.checkOut.geofence_status
                              ).className
                            }`}
                          >
                            {
                              formatSimpleLocationStatus(
                                card.checkOut.geofence_status
                              ).label
                            }
                          </span>
                        )}
                      </div>

                      {card.checkOut ? (
                        <button
                          type="button"
                          onClick={() => onInspectLog(card.checkOut!)}
                          className="mt-2 flex w-full items-center gap-3 rounded-xl p-1 text-left transition-colors hover:bg-slate-50"
                        >
                          <img
                            src={card.checkOut.photo_url}
                            alt={`Ảnh ra ca ${card.dateLabel}`}
                            referrerPolicy="no-referrer"
                            className="h-16 w-20 shrink-0 rounded-lg border border-slate-200 object-cover"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="font-mono text-lg font-bold text-slate-900 tabular-nums">
                              {formatTimeVN(card.checkOut.server_timestamp)}
                            </p>
                            <p className="truncate text-xs text-slate-500">
                              {card.checkOut.address_text}
                            </p>
                            {card.checkOut.note && (
                              <p className="mt-0.5 truncate text-[11px] text-amber-700">
                                Lý do: {card.checkOut.note}
                              </p>
                            )}
                            <span className="mt-0.5 inline-block text-[11px] font-semibold text-indigo-600">
                              Xem ảnh & chi tiết
                            </span>
                          </div>
                        </button>
                      ) : (
                        <p className="mt-3 text-xs text-slate-400">
                          Chưa chấm ra ca
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: SIMPLE WORKER PROFILE */}
      {activeTab === 'profile' && (
        <div className="grid grid-cols-1 gap-4 sm:gap-6 md:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
            <h2 className="text-base font-bold text-slate-900">
              Thông tin nhân sự
            </h2>
            <dl className="mt-4 space-y-3 text-sm">
              <div className="flex justify-between border-b border-slate-100 pb-2">
                <dt className="text-slate-500">Họ và tên</dt>
                <dd className="font-semibold text-slate-900">{employee.full_name}</dd>
              </div>
              <div className="flex justify-between border-b border-slate-100 pb-2">
                <dt className="text-slate-500">Mã nhân sự</dt>
                <dd className="font-mono font-semibold text-slate-900">
                  {employee.employee_code}
                </dd>
              </div>
              <div className="flex justify-between border-b border-slate-100 pb-2">
                <dt className="text-slate-500">Bộ phận</dt>
                <dd className="font-medium text-slate-900">
                  {employee.department}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Địa điểm làm việc</dt>
                <dd className="max-w-[60%] text-right font-medium text-slate-900">
                  {settings.office_address}
                </dd>
              </div>
            </dl>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
            <h2 className="text-base font-bold text-slate-900">
              Tổng kết tháng này
            </h2>
            <dl className="mt-4 space-y-3 text-sm">
              <div className="flex justify-between border-b border-slate-100 pb-2">
                <dt className="text-slate-500">Số ngày đã đi làm</dt>
                <dd className="font-mono font-semibold text-slate-900 tabular-nums">
                  {monthSummary?.totalShifts ?? 0} ca
                </dd>
              </div>
              <div className="flex justify-between border-b border-slate-100 pb-2">
                <dt className="text-slate-500">Tổng giờ làm thực tế</dt>
                <dd className="font-mono font-semibold text-slate-900 tabular-nums">
                  {monthSummary?.totalWorkHours ?? 0} giờ
                </dd>
              </div>
              <div className="flex justify-between pt-1">
                <dt className="font-semibold text-slate-900">Thu nhập tạm tính</dt>
                <dd className="font-mono text-lg font-bold text-indigo-700 tabular-nums">
                  {formatVnd(monthSummary?.laborCostVnd ?? 0)}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      )}

      {/* MOBILE BOTTOM NAVIGATION BAR */}
      <nav
        aria-label="Điều hướng nhân viên"
        className="fixed right-0 bottom-0 left-0 z-40 grid h-16 grid-cols-3 border-t border-slate-200 bg-white/95 backdrop-blur-md pb-safe md:hidden"
      >
        <button
          type="button"
          onClick={() => setActiveTab('checkin')}
          className={`flex min-h-[44px] flex-col items-center justify-center gap-1 ${
            activeTab === 'checkin' ? 'text-indigo-600' : 'text-slate-500'
          }`}
        >
          <Camera className="h-5 w-5" />
          <span className="text-[11px] font-semibold">Chấm công</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('history')}
          className={`flex min-h-[44px] flex-col items-center justify-center gap-1 ${
            activeTab === 'history' ? 'text-indigo-600' : 'text-slate-500'
          }`}
        >
          <History className="h-5 w-5" />
          <span className="text-[11px] font-semibold">Vào / Ra</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('profile')}
          className={`flex min-h-[44px] flex-col items-center justify-center gap-1 ${
            activeTab === 'profile' ? 'text-indigo-600' : 'text-slate-500'
          }`}
        >
          <User className="h-5 w-5" />
          <span className="text-[11px] font-semibold">Cá nhân</span>
        </button>
      </nav>

      {/* UNIFIED 1-STEP CAMERA + GPS BOTTOM SHEET (OPENS CAMERA & CAPTURE BUTTON IMMEDIATELY) */}
      {flowStep !== 'idle' && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/75 backdrop-blur-xs sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="attendance-flow-title"
        >
          <div className="flex h-[94dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl border border-slate-200 bg-white sm:h-auto sm:max-h-[92dvh] sm:rounded-2xl">
            {/* Mobile Sheet Drag Handle */}
            <div className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-slate-300 sm:hidden" />

            {/* Clean Header */}
            <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-4 py-3 sm:px-5">
              <div className="min-w-0">
                <h2
                  id="attendance-flow-title"
                  className="truncate text-base font-bold text-slate-900"
                >
                  {pendingAction === 'check_in'
                    ? 'Chụp ảnh Chấm VÀO CA'
                    : 'Chụp ảnh Chấm RA CA'}
                </h2>
                <p className="truncate text-xs text-slate-500">
                  {employee.full_name}
                </p>
              </div>
              <button
                type="button"
                onClick={closeFlow}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                aria-label="Đóng camera"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 space-y-3 overflow-y-auto p-3.5 sm:p-5">
              {(flowStep === 'camera_live' || flowStep === 'submitting') && (
                <>
                  {submitError && (
                    <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-medium text-rose-700">
                      {submitError}
                    </div>
                  )}

                  {/* LIVE CAMERA VIEWFINDER RIGHT AT TOP */}
                  {cameraError ? (
                    <div className="space-y-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-center">
                      <Camera className="mx-auto h-8 w-8 text-rose-600" />
                      <p className="text-xs font-medium text-rose-800">
                        {cameraError}
                      </p>
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <button
                          type="button"
                          onClick={openLiveCamera}
                          className="min-h-[46px] flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-800 hover:bg-slate-50"
                        >
                          Bật lại Camera
                        </button>
                        {isDemoMode && (
                          <button
                            type="button"
                            disabled={!canProceedToCapture}
                            onClick={() => handleCaptureAndConfirm(true)}
                            className="min-h-[46px] flex-1 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-700 disabled:opacity-50"
                          >
                            Chụp ảnh mẫu (Demo)
                          </button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-900">
                      <video
                        ref={videoRef}
                        autoPlay
                        playsInline
                        muted
                        className="aspect-[3/4] max-h-[46dvh] w-full -scale-x-100 object-cover sm:aspect-[4/3]"
                      />
                      {!cameraReady && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900/80 text-white">
                          <Camera className="h-8 w-8 animate-pulse text-slate-300" />
                          <p className="mt-2 text-xs font-medium text-slate-200">
                            Đang mở camera trước...
                          </p>
                        </div>
                      )}
                      <div className="absolute right-0 bottom-0 left-0 bg-gradient-to-t from-slate-950/85 to-transparent px-3.5 py-2.5 text-xs text-white">
                        <p className="font-semibold">{employee.full_name}</p>
                        <p className="text-[11px] text-slate-300">
                          {pendingAction === 'check_in' ? 'Vào ca' : 'Ra ca'} ·{' '}
                          {vnTimeString}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* SIMPLE LOCATION STATUS STRIP BELOW CAMERA */}
                  {gpsLoading && (
                    <div className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-700">
                      <RefreshCw className="h-4 w-4 shrink-0 animate-spin text-indigo-600" />
                      <span className="font-medium">
                        Đang tự động xác định vị trí của bạn...
                      </span>
                    </div>
                  )}

                  {!gpsLoading && gpsError && (
                    <div className="space-y-2.5 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
                        <p className="leading-relaxed font-medium">{gpsError}</p>
                      </div>
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <button
                          type="button"
                          onClick={acquireGps}
                          className="min-h-[42px] flex-1 rounded-lg border border-rose-300 bg-white px-3 py-1.5 font-bold text-rose-800 hover:bg-rose-100"
                        >
                          Lấy lại vị trí
                        </button>
                        {isDemoMode && (
                          <button
                            type="button"
                            onClick={handleUseDemoOfficeGps}
                            className="min-h-[42px] flex-1 rounded-lg bg-indigo-600 px-3 py-1.5 font-bold text-white hover:bg-indigo-700"
                          >
                            Dùng vị trí mẫu (Demo)
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {!gpsLoading && gpsReading && (
                    <div className="space-y-2.5">
                      {!isAccuracyValid ? (
                        <div className="flex items-center justify-between gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-800">
                          <span>
                            Vị trí chưa rõ (sai số ±{gpsReading.accuracy}m). Vui lòng ra chỗ thoáng.
                          </span>
                          <button
                            type="button"
                            onClick={acquireGps}
                            className="shrink-0 rounded-lg border border-rose-300 bg-white px-2.5 py-1.5 font-bold text-rose-800"
                          >
                            Thử lại
                          </button>
                        </div>
                      ) : isInsideGeofence ? (
                        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs font-semibold text-emerald-800">
                          <MapPin className="h-4 w-4 shrink-0 text-emerald-600" />
                          <span className="truncate">
                            Đúng vị trí làm việc · Cách điểm {gpsReading.distance}m
                          </span>
                        </div>
                      ) : settings.allow_out_of_office_with_note ? (
                        <div className="space-y-1.5 rounded-xl border border-amber-200 bg-amber-50 p-3">
                          <label
                            htmlFor="out-of-range-note"
                            className="block text-xs font-bold text-amber-900"
                          >
                            Bạn đang ở ngoài khu vực (cách {gpsReading.distance}m). Nhập lý do:
                          </label>
                          <input
                            id="out-of-range-note"
                            type="text"
                            value={outOfRangeNote}
                            onChange={(e) => setOutOfRangeNote(e.target.value)}
                            placeholder="Ví dụ: Làm tại nhà hàng tầng 2..."
                            className="min-h-[44px] w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-base text-slate-900 focus:border-indigo-600 focus:outline-none sm:text-sm"
                          />
                          <p className="text-[11px] text-amber-800">
                            Nhập ít nhất 8 ký tự ({outOfRangeNote.trim().length}/8)
                          </p>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-semibold text-rose-800">
                          <span>
                            Bạn đang ở ngoài khu vực làm việc (cách {gpsReading.distance}m).
                          </span>
                          <button
                            type="button"
                            onClick={acquireGps}
                            className="shrink-0 rounded-lg border border-rose-300 bg-white px-2.5 py-1.5 font-bold"
                          >
                            Kiểm tra lại
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}

              {/* RECEIPT CONFIRMATION */}
              {flowStep === 'receipt' && receiptLog && (
                <div className="space-y-3.5">
                  <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                    <CheckCircle2 className="h-8 w-8 shrink-0 text-emerald-600" />
                    <div>
                      <p className="text-base font-bold text-emerald-900">
                        {receiptLog.action === 'check_in'
                          ? 'Đã lưu CHẤM VÀO CA thành công!'
                          : 'Đã lưu CHẤM RA CA thành công!'}
                      </p>
                      <p className="mt-0.5 text-xs text-emerald-800">
                        Giờ ghi nhận:{' '}
                        <span className="font-mono font-bold tabular-nums">
                          {formatDateTimeVN(receiptLog.server_timestamp)}
                        </span>
                      </p>
                    </div>
                  </div>

                  <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-900">
                    <img
                      src={receiptLog.photo_url}
                      alt="Ảnh chấm công đã lưu"
                      referrerPolicy="no-referrer"
                      className="aspect-[4/3] max-h-[40dvh] w-full object-cover"
                    />
                  </div>

                  <div className="space-y-1.5 rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-xs">
                    <div className="flex justify-between gap-2">
                      <span className="text-slate-500">Họ và tên:</span>
                      <span className="font-bold text-slate-900">
                        {receiptLog.employee_name}
                      </span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-slate-500">Địa điểm:</span>
                      <span className="max-w-[68%] truncate text-right text-slate-800">
                        {receiptLog.address_text}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* STICKY THUMB-ZONE CAPTURE BUTTON (VISIBLE IMMEDIATELY WHEN CAMERA OPENS) */}
            {((flowStep === 'camera_live' || flowStep === 'submitting') && !cameraError) ||
            (flowStep === 'receipt' && receiptLog) ? (
              <div className="shrink-0 border-t border-slate-200 bg-white px-4 py-3 pb-safe sm:px-5 sm:py-4">
                {(flowStep === 'camera_live' || flowStep === 'submitting') &&
                  !cameraError && (
                    <button
                      type="button"
                      disabled={
                        !cameraReady ||
                        !canProceedToCapture ||
                        flowStep === 'submitting'
                      }
                      onClick={() => handleCaptureAndConfirm(false)}
                      className={`flex min-h-[58px] w-full items-center justify-center gap-2.5 rounded-2xl px-5 py-3.5 text-base font-bold text-white transition-all active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600 ${
                        pendingAction === 'check_in'
                          ? 'bg-emerald-600 hover:bg-emerald-700'
                          : 'bg-indigo-600 hover:bg-indigo-700'
                      }`}
                    >
                      <Camera className="h-6 w-6 shrink-0" />
                      <span>{captureButtonLabel}</span>
                    </button>
                  )}

                {flowStep === 'receipt' && receiptLog && (
                  <button
                    type="button"
                    onClick={closeFlow}
                    className="min-h-[54px] w-full rounded-2xl bg-[#0B1E36] px-5 py-3 text-base font-bold text-white hover:bg-[#132C4E] active:scale-[0.99]"
                  >
                    Xong
                  </button>
                )}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
};
