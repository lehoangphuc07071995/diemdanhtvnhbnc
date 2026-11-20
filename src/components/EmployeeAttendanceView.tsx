import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  ExternalLink,
  History,
  LogIn,
  LogOut,
  LogOut as ExitIcon,
  MapPin,
  Navigation,
  RefreshCw,
  Search,
  ShieldCheck,
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
type FlowStep = 'idle' | 'gps_checking' | 'gps_ready' | 'camera_live' | 'submitting' | 'receipt';

interface GpsReading {
  latitude: number;
  longitude: number;
  accuracy: number;
  distance: number;
  address: string;
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

  // Flow state
  const [pendingAction, setPendingAction] = useState<AttendanceAction>('check_in');
  const [flowStep, setFlowStep] = useState<FlowStep>('idle');
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

  const latestTodayLog = todayLogs[0] || null;
  const isCurrentlyInShift = latestTodayLog?.action === 'check_in';
  const hasCompletedToday = latestTodayLog?.action === 'check_out';

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

  const acquireGps = useCallback(async () => {
    setFlowStep('gps_checking');
    setGpsError('');
    setGpsReading(null);

    if (!navigator.geolocation) {
      setGpsError('Thiết bị hoặc trình duyệt này không hỗ trợ định vị GPS.');
      setFlowStep('gps_ready');
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
        setFlowStep('gps_ready');
      },
      (err) => {
        let msg = 'Không thể lấy tọa độ GPS chính xác.';
        if (err.code === err.PERMISSION_DENIED) {
          msg =
            'Trình duyệt đã bị từ chối quyền truy cập Vị trí (GPS). Vui lòng cấp quyền định vị và thử lại.';
        } else if (err.code === err.TIMEOUT) {
          msg =
            'Hết thời gian chờ tín hiệu GPS chính xác cao (10 giây). Vui lòng di chuyển ra khu vực thoáng hơn.';
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          msg = 'Không tìm thấy tín hiệu vệ tinh / vị trí trên thiết bị này.';
        }
        setGpsError(msg);
        setFlowStep('gps_ready');
      },
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 10000,
      }
    );
  }, [settings.latitude, settings.longitude]);

  const startAttendanceFlow = useCallback(
    (action: AttendanceAction) => {
      setPendingAction(action);
      setOutOfRangeNote('');
      setCameraError('');
      setSubmitError('');
      setReceiptLog(null);
      acquireGps();
    },
    [acquireGps]
  );

  useEffect(() => {
    if (autoStartAction) {
      startAttendanceFlow(autoStartAction);
      onAutoStartConsumed?.();
    }
  }, [autoStartAction, onAutoStartConsumed, startAttendanceFlow]);

  const handleUseDemoOfficeGps = async () => {
    setFlowStep('gps_checking');
    setGpsError('');
    const lat = settings.latitude + 0.00008;
    const lng = settings.longitude + 0.00006;
    const dist = haversineDistanceMeters(
      lat,
      lng,
      settings.latitude,
      settings.longitude
    );
    const addr = settings.office_address;
    setGpsReading({
      latitude: lat,
      longitude: lng,
      accuracy: 12,
      distance: dist,
      address: addr,
    });
    setFlowStep('gps_ready');
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
  const canProceedToCamera = Boolean(
    gpsReading &&
      isAccuracyValid &&
      (isInsideGeofence ||
        (settings.allow_out_of_office_with_note &&
          outOfRangeNote.trim().length >= 8))
  );

  const openLiveCamera = useCallback(async () => {
    setFlowStep('camera_live');
    setCameraError('');
    setCameraReady(false);
    stopCameraStream();

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError(
        'Trình duyệt không hỗ trợ mở camera trực tiếp (getUserMedia).'
      );
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
        err instanceof Error ? err.message : 'Không thể truy cập camera trước';
      setCameraError(
        `Không mở được camera trực tiếp: ${message}. Vui lòng cấp quyền Camera để chụp ảnh xác thực.`
      );
    }
  }, [stopCameraStream]);

  const handleCaptureAndConfirm = async (useFallbackDemoCanvas = false) => {
    if (!gpsReading) return;
    setSubmitError('');

    const deviceTimestamp = new Date().toISOString();
    const actionLabel =
      pendingAction === 'check_in' ? 'VÀO CA (CHECK-IN)' : 'RA CA (CHECK-OUT)';

    let sourceEl: HTMLVideoElement | HTMLCanvasElement;

    if (!useFallbackDemoCanvas && videoRef.current && cameraReady) {
      sourceEl = videoRef.current;
    } else if (useFallbackDemoCanvas && isDemoMode) {
      // Fallback canvas only when hardware camera is absent in Demo Mode
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
        ctx.fillText('KHUNG HÌNH XÁC THỰC DEMO', 240, 320);
        ctx.font = '20px "Plus Jakarta Sans", sans-serif';
        ctx.fillStyle = '#94A3B8';
        ctx.fillText(
          `${employee.full_name} (${employee.employee_code})`,
          310,
          370
        );
      }
      sourceEl = fallbackCanvas;
    } else {
      setSubmitError('Camera chưa sẵn sàng. Vui lòng thử lại.');
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
          : 'Gửi dữ liệu chấm công thất bại. Vui lòng thử lại.'
      );
      setFlowStep('camera_live');
    }
  };

  const closeFlow = () => {
    stopCameraStream();
    setFlowStep('idle');
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

  return (
    <div className="mx-auto w-full max-w-6xl px-3.5 pt-3.5 pb-24 sm:px-6 sm:pt-5 lg:pb-10">
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
            <p className="font-mono text-[11px] text-slate-500">
              {employee.employee_code} ·{' '}
              <span
                className={`font-semibold ${
                  isCurrentlyInShift
                    ? 'text-emerald-700'
                    : hasCompletedToday
                      ? 'text-indigo-700'
                      : 'text-slate-600'
                }`}
              >
                {isCurrentlyInShift
                  ? 'Đang trong ca'
                  : hasCompletedToday
                    ? 'Đã ra ca'
                    : 'Chưa vào ca'}
              </span>
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

      {/* Desktop inline view switcher (mobile uses fixed bottom bar) */}
      <div className="mb-6 hidden items-center justify-between gap-4 border-b border-slate-200 pb-4 md:flex">
        <div className="flex items-center gap-3.5">
          <img
            src="/logo-square.png"
            alt="Logo Điểm Danh"
            className="h-11 w-11 shrink-0 rounded-xl border border-slate-200 object-cover"
          />
          <div>
            <h1 className="text-xl font-bold text-slate-900">
              Điểm danh Cá nhân · {employee.full_name}
            </h1>
            <p className="mt-0.5 text-sm text-slate-500">
              Mã NV: {employee.employee_code} · Bộ phận {employee.department} · Ca chuẩn {settings.shift_start_time} – {settings.shift_end_time}
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
              Chấm công 1 chạm
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
              Lịch sử chấm công ({myLogs.length})
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
              Công & Thu nhập tạm tính
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

      {/* TAB 1: 1-TAP CHECK-IN / CHECK-OUT */}
      {activeTab === 'checkin' && (
        <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-12">
          {/* Primary Action Column */}
          <div className="space-y-4 sm:space-y-5 lg:col-span-7">
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
                  <p className="text-xs text-slate-300">Trạng thái ca hiện tại</p>
                  {isCurrentlyInShift ? (
                    <p className="mt-1 inline-flex items-center gap-1.5 text-sm font-bold text-emerald-300">
                      <CheckCircle2 className="h-4 w-4" />
                      <span>
                        Đang trong ca từ {formatTimeVN(latestTodayLog.server_timestamp)}
                      </span>
                    </p>
                  ) : hasCompletedToday ? (
                    <p className="mt-1 inline-flex items-center gap-1.5 text-sm font-bold text-amber-300">
                      <ShieldCheck className="h-4 w-4" />
                      <span>
                        Đã hoàn thành ca lúc {formatTimeVN(latestTodayLog.server_timestamp)}
                      </span>
                    </p>
                  ) : (
                    <p className="mt-1 inline-flex items-center gap-1.5 text-sm font-semibold text-slate-200">
                      <Clock className="h-4 w-4 text-slate-300" />
                      <span>Chưa vào ca hôm nay</span>
                    </p>
                  )}
                </div>
              </div>

              <div className="p-4 sm:p-7">
                {/* 1-Tap High Contrast Action Buttons */}
                <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => startAttendanceFlow('check_in')}
                  className={`flex min-h-[76px] w-full items-center justify-center gap-3 rounded-2xl px-5 py-4 text-base font-bold transition-all active:scale-[0.99] ${
                    !isCurrentlyInShift
                      ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                      : 'border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <LogIn className="h-6 w-6 shrink-0" />
                  <span className="text-left leading-tight">
                    CHẤM CÔNG VÀO CA (CHECK-IN)
                  </span>
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
                  <LogOut className="h-6 w-6 shrink-0" />
                  <span className="text-left leading-tight">
                    CHẤM CÔNG RA CA (CHECK-OUT)
                  </span>
                </button>
              </div>

                <div className="mt-5 grid grid-cols-1 gap-3 border-t border-slate-100 pt-4 text-xs text-slate-600 sm:grid-cols-3">
                  <div className="flex items-start gap-2">
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600" />
                    <div>
                      <p className="font-semibold text-slate-800">Bán kính cho phép</p>
                      <p className="font-mono tabular-nums">
                        ≤ {settings.geofence_radius_m}m từ điểm
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <Navigation className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                    <div>
                      <p className="font-semibold text-slate-800">Độ chính xác GPS</p>
                      <p className="font-mono tabular-nums">
                        Yêu cầu sai số ≤ {settings.max_gps_accuracy_m}m
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <Camera className="mt-0.5 h-4 w-4 shrink-0 text-slate-700" />
                    <div>
                      <p className="font-semibold text-slate-800">Xác thực khuôn mặt</p>
                      <p>Chụp trực tiếp · Chặn tải ảnh sẵn</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Today's logs quick timeline */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-slate-900">
                  Lượt chấm công hôm nay ({formatDateVN(now.toISOString())})
                </h2>
                <span className="font-mono text-xs text-slate-500 tabular-nums">
                  {todayLogs.length} lượt
                </span>
              </div>

              {todayLogs.length === 0 ? (
                <p className="mt-4 text-sm text-slate-500">
                  Bạn chưa ghi nhận lượt chấm công nào trong ngày hôm nay. Nhấn nút phía trên để bắt đầu ca làm việc.
                </p>
              ) : (
                <div className="mt-3 divide-y divide-slate-100">
                  {todayLogs.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onInspectLog(item)}
                      className="flex min-h-[56px] w-full items-center justify-between gap-3 py-3 text-left transition-colors hover:bg-slate-50"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900">
                          {item.action === 'check_in' ? 'Vào ca (Check-in)' : 'Ra ca (Check-out)'}
                          <span className="ml-2 font-mono text-xs font-normal text-slate-500 tabular-nums">
                            {formatTimeVN(item.server_timestamp)}
                          </span>
                        </p>
                        <p className="mt-0.5 truncate text-xs text-slate-500">
                          {item.address_text} · Cách {Math.round(item.distance_to_office_m)}m
                        </p>
                      </div>
                      <span
                        className={`shrink-0 text-xs font-semibold ${
                          item.geofence_status === 'valid'
                            ? 'text-emerald-700'
                            : item.geofence_status === 'out_of_range_noted'
                              ? 'text-amber-700'
                              : 'text-rose-700'
                        }`}
                      >
                        Xem chứng cứ
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Monthly Snapshot & Office Location Info */}
          <div className="space-y-5 lg:col-span-5">
            <div className="rounded-2xl border border-slate-200 bg-white p-6">
              <h2 className="text-sm font-bold text-slate-900">
                Tổng hợp tháng này của bạn
              </h2>
              <div className="mt-4 grid grid-cols-2 gap-4">
                <div className="border-b border-slate-100 pb-3">
                  <p className="text-xs text-slate-500">Số ngày công</p>
                  <p className="mt-1 font-mono text-2xl font-bold text-slate-900 tabular-nums">
                    {monthSummary?.totalShifts ?? 0}
                  </p>
                </div>
                <div className="border-b border-slate-100 pb-3">
                  <p className="text-xs text-slate-500">Giờ làm thực tế</p>
                  <p className="mt-1 font-mono text-2xl font-bold text-slate-900 tabular-nums">
                    {monthSummary?.totalWorkHours ?? 0}h
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Tổng phút đi muộn</p>
                  <p
                    className={`mt-1 font-mono text-2xl font-bold tabular-nums ${
                      (monthSummary?.lateMinutes ?? 0) > 0
                        ? 'text-amber-700'
                        : 'text-emerald-700'
                    }`}
                  >
                    {monthSummary?.lateMinutes ?? 0}p
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Thu nhập tạm tính</p>
                  <p className="mt-1 font-mono text-xl font-bold text-indigo-700 tabular-nums">
                    {formatVnd(monthSummary?.laborCostVnd ?? 0)}
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-6">
              <h2 className="text-sm font-bold text-slate-900">
                Địa điểm văn phòng cấu hình
              </h2>
              <p className="mt-2 text-sm text-slate-700">{settings.company_name}</p>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">
                {settings.office_address}
              </p>
              <p className="mt-3 font-mono text-xs text-slate-600 tabular-nums">
                Tọa độ: {settings.latitude.toFixed(6)}, {settings.longitude.toFixed(6)}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: HISTORY & DATA EXTRACTION */}
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
                className="block text-xs font-bold tracking-wide text-slate-700 uppercase"
              >
                Tra cứu & trích xuất dữ liệu điểm danh theo Họ và tên
              </label>
              <div className="mt-2.5 flex flex-col gap-2.5 sm:flex-row">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    id="history-name-lookup"
                    type="text"
                    value={lookupInput}
                    onChange={(e) => setLookupInput(e.target.value)}
                    placeholder="Nhập đúng Họ và tên cần xem dữ liệu..."
                    className="min-h-[46px] w-full rounded-xl border border-slate-300 bg-white py-2.5 pr-4 pl-10 text-base text-slate-900 focus:border-indigo-600 focus:ring-2 focus:ring-indigo-600/20 focus:outline-none sm:text-sm"
                  />
                </div>
                <button
                  type="submit"
                  className="inline-flex min-h-[46px] shrink-0 items-center justify-center gap-2 rounded-xl bg-[#0B1E36] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#132C4E]"
                >
                  <Search className="h-4 w-4" />
                  <span>Tra cứu họ tên này</span>
                </button>
              </div>
            </form>
          )}

          {/* Current Shift Status & Quick Check-in / Check-out */}
          <div className="flex flex-col justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:p-5">
            <div>
              <p className="text-xs font-medium text-slate-500">
                Trạng thái ca hôm nay ({formatDateVN(now.toISOString())}) ·{' '}
                <span className="font-semibold text-slate-800">{employee.full_name}</span>
              </p>
              {isCurrentlyInShift ? (
                <p className="mt-1 inline-flex items-center gap-1.5 text-sm font-bold text-emerald-700">
                  <CheckCircle2 className="h-4 w-4" />
                  <span>
                    Đang trong ca từ {formatTimeVN(latestTodayLog.server_timestamp)}
                  </span>
                </p>
              ) : hasCompletedToday ? (
                <p className="mt-1 inline-flex items-center gap-1.5 text-sm font-bold text-indigo-700">
                  <ShieldCheck className="h-4 w-4" />
                  <span>
                    Đã hoàn thành ca (Ra ca lúc {formatTimeVN(latestTodayLog.server_timestamp)})
                  </span>
                </p>
              ) : (
                <p className="mt-1 inline-flex items-center gap-1.5 text-sm font-semibold text-slate-700">
                  <Clock className="h-4 w-4 text-slate-400" />
                  <span>Chưa ghi nhận lượt vào ca hôm nay</span>
                </p>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              {!isCurrentlyInShift ? (
                <button
                  type="button"
                  onClick={() => startAttendanceFlow('check_in')}
                  className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 sm:flex-initial sm:text-sm"
                >
                  <LogIn className="h-4 w-4" />
                  <span>Vào ca ngay</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => startAttendanceFlow('check_out')}
                  className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-700 sm:flex-initial sm:text-sm"
                >
                  <LogOut className="h-4 w-4" />
                  <span>Ra ca ngay</span>
                </button>
              )}
            </div>
          </div>

          {/* Filter, Summary Metrics & Extraction Toolbar */}
          <div className="rounded-2xl border border-slate-200 bg-white">
            <div className="space-y-4 border-b border-slate-200 p-4 sm:p-6">
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                <div>
                  <h2 className="text-base font-bold text-slate-900">
                    Toàn bộ dữ liệu điểm danh: {employee.full_name}
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Hiển thị đầy đủ giờ máy chủ UTC+7, giờ thiết bị, tọa độ GPS, địa chỉ, ảnh xác thực & mã băm SHA-256
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={filteredMyLogs.length === 0}
                    onClick={async () => {
                      const periodLabel =
                        historyRange === 'all'
                          ? 'Tat_Ca'
                          : `${historyBounds.startDateKey}_${historyBounds.endDateKey}`;
                      const lines = [
                        `TRÍCH XUẤT LỊCH SỬ ĐIỂM DANH - ${employee.full_name.toUpperCase()} (${employee.employee_code})`,
                        `Tổng lượt: ${filteredMyLogs.length} | Số ca: ${historySummary?.totalShifts ?? 0} | Tổng giờ: ${historySummary?.totalWorkHours ?? 0}h`,
                        '----------------------------------------',
                        ...filteredMyLogs.map((l) => {
                          const actionTxt = l.action === 'check_in' ? 'VÀO CA' : 'RA CA';
                          const statusTxt =
                            l.geofence_status === 'valid'
                              ? 'Hợp lệ'
                              : l.geofence_status === 'out_of_range_noted'
                                ? 'Ngoài vùng (Có ghi chú)'
                                : 'Vi phạm';
                          return `[${actionTxt}] ${formatDateTimeVN(l.server_timestamp)} (UTC+7)\n  • Mã: ${l.id} | GPS: ${l.latitude.toFixed(6)}, ${l.longitude.toFixed(6)} (±${Math.round(l.gps_accuracy_m)}m, cách ${Math.round(l.distance_to_office_m)}m)\n  • Trạng thái: ${statusTxt}\n  • Địa chỉ: ${l.address_text}${l.note ? `\n  • Ghi chú: ${l.note}` : ''}`;
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
                        <span>Sao chép tóm tắt</span>
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
                    <span>Trích xuất Excel (.xlsx)</span>
                  </button>
                </div>
              </div>

              {/* Date Range Selector */}
              <div className="flex flex-wrap items-center gap-2">
                {(
                  [
                    { key: 'all', label: 'Tất cả thời gian' },
                    { key: 'today', label: 'Hôm nay' },
                    { key: 'week', label: 'Tuần này' },
                    { key: 'month', label: 'Tháng này' },
                    { key: 'custom', label: 'Tùy chọn ngày' },
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
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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

              {/* Summary Strip */}
              <div className="grid grid-cols-2 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3.5 sm:grid-cols-4">
                <div>
                  <p className="text-[11px] text-slate-500">Tổng lượt điểm danh</p>
                  <p className="mt-0.5 font-mono text-lg font-bold text-slate-900 tabular-nums">
                    {filteredMyLogs.length} lượt
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-slate-500">Số ca đã vào</p>
                  <p className="mt-0.5 font-mono text-lg font-bold text-slate-900 tabular-nums">
                    {historySummary?.totalShifts ?? 0} ca
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-slate-500">Tổng giờ làm</p>
                  <p className="mt-0.5 font-mono text-lg font-bold text-indigo-700 tabular-nums">
                    {historySummary?.totalWorkHours ?? 0} giờ
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-slate-500">Đi muộn / Tăng ca</p>
                  <p className="mt-0.5 font-mono text-sm font-bold text-slate-800 tabular-nums">
                    {historySummary?.lateMinutes ?? 0}p · OT {historySummary?.overtimeHours ?? 0}h
                  </p>
                </div>
              </div>
            </div>

            {filteredMyLogs.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-sm font-semibold text-slate-800">
                  Không tìm thấy dữ liệu điểm danh cho &ldquo;{employee.full_name}&rdquo;
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Vui lòng kiểm tra lại đúng chính tả Họ và tên có dấu hoặc chọn lại khoảng thời gian lọc.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-200">
                {filteredMyLogs.map((item) => {
                  const mapsUrl = `https://www.google.com/maps?q=${item.latitude},${item.longitude}`;
                  return (
                    <div
                      key={item.id}
                      className="flex flex-col gap-4 p-4 transition-colors hover:bg-slate-50/70 sm:flex-row sm:items-start sm:p-5"
                    >
                      {/* Thumbnail photo */}
                      <button
                        type="button"
                        onClick={() => onInspectLog(item)}
                        className="group relative h-28 w-full shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-900 sm:h-28 sm:w-36"
                        title="Xem ảnh chứng cứ phóng lớn"
                      >
                        <img
                          src={item.photo_url}
                          alt={`Ảnh ${item.action === 'check_in' ? 'vào ca' : 'ra ca'} của ${item.employee_name}`}
                          referrerPolicy="no-referrer"
                          className="h-full w-full object-cover transition-transform group-hover:scale-105"
                        />
                        <span className="absolute right-1.5 bottom-1.5 rounded bg-slate-950/80 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                          Phóng to
                        </span>
                      </button>

                      {/* Full Forensic Details */}
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`text-sm font-bold ${
                                item.action === 'check_in'
                                  ? 'text-emerald-700'
                                  : 'text-indigo-700'
                              }`}
                            >
                              {item.action === 'check_in'
                                ? 'VÀO CA (CHECK-IN)'
                                : 'RA CA (CHECK-OUT)'}
                            </span>
                            <span aria-hidden="true" className="text-slate-300">
                              ·
                            </span>
                            <span className="font-mono text-sm font-bold text-slate-900 tabular-nums">
                              {formatDateTimeVN(item.server_timestamp)}
                            </span>
                            <span className="font-mono text-[11px] text-slate-400">
                              #{item.id}
                            </span>
                          </div>

                          <span
                            className={`text-xs font-bold ${
                              item.geofence_status === 'valid'
                                ? 'text-emerald-700'
                                : item.geofence_status === 'out_of_range_noted'
                                  ? 'text-amber-700'
                                  : 'text-rose-700'
                            }`}
                          >
                            {item.geofence_status === 'valid'
                              ? 'Hợp lệ trong vùng'
                              : item.geofence_status === 'out_of_range_noted'
                                ? 'Ngoài vùng (Có ghi chú)'
                                : 'Cảnh báo vi phạm vùng'}
                          </span>
                        </div>

                        <div className="grid grid-cols-1 gap-1.5 text-xs text-slate-600 sm:grid-cols-2">
                          <p>
                            <span className="text-slate-400">Người điểm danh:</span>{' '}
                            <span className="font-semibold text-slate-800">
                              {item.employee_name}
                            </span>{' '}
                            ({item.employee_code})
                          </p>
                          <p className="font-mono tabular-nums">
                            <span className="font-sans text-slate-400">Giờ thiết bị:</span>{' '}
                            {formatDateTimeVN(item.device_timestamp)} ·{' '}
                            <span
                              className={
                                item.clock_tamper_flag
                                  ? 'font-semibold text-rose-700'
                                  : 'text-emerald-700'
                              }
                            >
                              Lệch {item.clock_drift_seconds}s
                            </span>
                          </p>
                          <p className="sm:col-span-2">
                            <span className="text-slate-400">Địa chỉ GPS:</span>{' '}
                            <span className="text-slate-800">{item.address_text}</span>
                          </p>
                          <p className="flex flex-wrap items-center gap-2 font-mono tabular-nums sm:col-span-2">
                            <span className="font-sans text-slate-400">Tọa độ:</span>
                            <a
                              href={mapsUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 font-semibold text-indigo-600 hover:underline"
                            >
                              <span>
                                {item.latitude.toFixed(6)}, {item.longitude.toFixed(6)}
                              </span>
                              <ExternalLink className="h-3 w-3" />
                            </a>
                            <span className="text-slate-400">·</span>
                            <span>
                              Khoảng cách {Math.round(item.distance_to_office_m)}m (Sai số ±
                              {Math.round(item.gps_accuracy_m)}m)
                            </span>
                          </p>
                          {item.note && (
                            <p className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-amber-900 sm:col-span-2">
                              <span className="font-semibold">Ghi chú: </span>
                              {item.note}
                            </p>
                          )}
                          {item.is_adjusted && (
                            <p className="text-amber-700 sm:col-span-2">
                              Đã được điều chỉnh bởi Quản trị viên: {item.adjusted_by}
                            </p>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2">
                          <span className="font-mono text-[11px] text-slate-400">
                            SHA-256: {item.integrity_hash.slice(0, 20)}...
                          </span>
                          <button
                            type="button"
                            onClick={() => onInspectLog(item)}
                            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-50"
                          >
                            <ShieldCheck className="h-3.5 w-3.5" />
                            <span>Mở trình kiểm tra chứng cứ</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: PROFILE & ESTIMATED PAY */}
      {activeTab === 'profile' && (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-6">
            <h2 className="text-base font-bold text-slate-900">
              Thông tin nhân sự
            </h2>
            <dl className="mt-4 space-y-3 text-sm">
              <div className="flex justify-between border-b border-slate-100 pb-2">
                <dt className="text-slate-500">Họ và tên</dt>
                <dd className="font-semibold text-slate-900">{employee.full_name}</dd>
              </div>
              <div className="flex justify-between border-b border-slate-100 pb-2">
                <dt className="text-slate-500">Mã nhân viên</dt>
                <dd className="font-mono font-semibold text-slate-900">
                  {employee.employee_code}
                </dd>
              </div>
              <div className="flex justify-between border-b border-slate-100 pb-2">
                <dt className="text-slate-500">Phòng ban / Chức vụ</dt>
                <dd className="font-medium text-slate-900">
                  {employee.department} · {employee.position}
                </dd>
              </div>
              <div className="flex justify-between border-b border-slate-100 pb-2">
                <dt className="text-slate-500">Hình thức tính lương</dt>
                <dd className="font-medium text-slate-900">
                  {employee.pay_type === 'hourly' ? 'Theo giờ thực tế' : 'Theo ngày công'}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Đơn giá cơ bản</dt>
                <dd className="font-mono font-bold text-indigo-700 tabular-nums">
                  {formatVnd(employee.base_rate_vnd)} /{' '}
                  {employee.pay_type === 'hourly' ? 'giờ' : 'ngày'}
                </dd>
              </div>
            </dl>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-6">
            <h2 className="text-base font-bold text-slate-900">
              Thống kê công tháng hiện tại
            </h2>
            <dl className="mt-4 space-y-3 text-sm">
              <div className="flex justify-between border-b border-slate-100 pb-2">
                <dt className="text-slate-500">Tổng số ca đã chấm</dt>
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
              <div className="flex justify-between border-b border-slate-100 pb-2">
                <dt className="text-slate-500">Giờ tăng ca (OT x{employee.ot_multiplier})</dt>
                <dd className="font-mono font-semibold text-emerald-700 tabular-nums">
                  {monthSummary?.overtimeHours ?? 0} giờ
                </dd>
              </div>
              <div className="flex justify-between border-b border-slate-100 pb-2">
                <dt className="text-slate-500">Số phút đi muộn</dt>
                <dd className="font-mono font-semibold text-amber-700 tabular-nums">
                  {monthSummary?.lateMinutes ?? 0} phút
                </dd>
              </div>
              <div className="flex justify-between pt-1">
                <dt className="font-semibold text-slate-900">Tổng thu nhập tạm tính</dt>
                <dd className="font-mono text-lg font-bold text-indigo-700 tabular-nums">
                  {formatVnd(monthSummary?.laborCostVnd ?? 0)}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      )}

      {/* MOBILE BOTTOM NAVIGATION BAR (<= 15% height, >= 44px touch targets) */}
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
          <MapPin className="h-5 w-5" />
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
          <span className="text-[11px] font-semibold">Lịch sử</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('profile')}
          className={`flex min-h-[44px] flex-col items-center justify-center gap-1 ${
            activeTab === 'profile' ? 'text-indigo-600' : 'text-slate-500'
          }`}
        >
          <User className="h-5 w-5" />
          <span className="text-[11px] font-semibold">Bảng công</span>
        </button>
      </nav>

      {/* MULTI-STEP TAMPER-PROOF CHECK-IN / CHECK-OUT MOBILE BOTTOM SHEET */}
      {flowStep !== 'idle' && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/75 backdrop-blur-xs sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="attendance-flow-title"
        >
          <div className="flex h-[92dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-3xl border border-slate-200 bg-white sm:h-auto sm:max-h-[90dvh] sm:rounded-2xl">
            {/* Mobile Sheet Drag Handle */}
            <div className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-slate-300 sm:hidden" />

            {/* Modal Header */}
            <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-4 py-3 sm:px-5 sm:py-4">
              <div className="min-w-0">
                <h2
                  id="attendance-flow-title"
                  className="truncate text-base font-bold text-slate-900"
                >
                  {pendingAction === 'check_in'
                    ? 'Xác thực Chấm công Vào ca'
                    : 'Xác thực Chấm công Ra ca'}
                </h2>
                <p className="truncate text-xs text-slate-500">
                  {employee.full_name} ({employee.employee_code})
                </p>
              </div>
              <button
                type="button"
                onClick={closeFlow}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                aria-label="Hủy quy trình chấm công"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Scrollable Body */}
            <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
              {/* STEP 1: GPS & GEOFENCE LOCK */}
              {(flowStep === 'gps_checking' || flowStep === 'gps_ready') && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-bold text-slate-900">
                      Bước 1/2: Khóa tọa độ GPS
                    </span>
                    <button
                      type="button"
                      onClick={acquireGps}
                      disabled={flowStep === 'gps_checking'}
                      className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      <RefreshCw
                        className={`h-3.5 w-3.5 ${
                          flowStep === 'gps_checking' ? 'animate-spin' : ''
                        }`}
                      />
                      <span>Lấy lại GPS</span>
                    </button>
                  </div>

                  {flowStep === 'gps_checking' && (
                    <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 px-4 py-10 text-center">
                      <Navigation className="h-9 w-9 animate-pulse text-indigo-600" />
                      <p className="mt-3 text-sm font-semibold text-slate-900">
                        Đang đo tín hiệu GPS độ chính xác cao...
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        Yêu cầu sai số ≤ {settings.max_gps_accuracy_m}m
                      </p>
                    </div>
                  )}

                  {flowStep === 'gps_ready' && gpsError && (
                    <div className="space-y-3 rounded-2xl border border-rose-200 bg-rose-50 p-4">
                      <div className="flex items-start gap-2.5 text-sm text-rose-800">
                        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" />
                        <div>
                          <p className="font-semibold">Không thể khóa vị trí GPS</p>
                          <p className="mt-1 text-xs leading-relaxed">{gpsError}</p>
                        </div>
                      </div>
                      {isDemoMode && (
                        <button
                          type="button"
                          onClick={handleUseDemoOfficeGps}
                          className="min-h-[48px] w-full rounded-xl border border-indigo-200 bg-white px-4 py-2.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-50"
                        >
                          Dùng tọa độ điểm mẫu để tiếp tục kiểm thử (Chỉ Demo)
                        </button>
                      )}
                    </div>
                  )}

                  {flowStep === 'gps_ready' && gpsReading && (
                    <div className="space-y-3.5">
                      <div className="grid grid-cols-2 gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3.5 sm:p-4">
                        <div>
                          <p className="text-xs text-slate-500">Sai số GPS</p>
                          <p
                            className={`mt-1 font-mono text-xl font-bold tabular-nums ${
                              isAccuracyValid ? 'text-emerald-700' : 'text-rose-700'
                            }`}
                          >
                            ±{gpsReading.accuracy}m
                          </p>
                          <p className="text-[11px] text-slate-500">
                            Giới hạn ≤ {settings.max_gps_accuracy_m}m
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-500">Khoảng cách điểm</p>
                          <p
                            className={`mt-1 font-mono text-xl font-bold tabular-nums ${
                              isInsideGeofence ? 'text-emerald-700' : 'text-amber-700'
                            }`}
                          >
                            {gpsReading.distance}m
                          </p>
                          <p className="text-[11px] text-slate-500">
                            Cho phép ≤ {settings.geofence_radius_m}m
                          </p>
                        </div>
                        <div className="col-span-2 border-t border-slate-200 pt-2.5">
                          <p className="text-xs text-slate-500">Địa chỉ xác định</p>
                          <p className="mt-0.5 text-xs leading-relaxed font-medium text-slate-900 sm:text-sm">
                            {gpsReading.address}
                          </p>
                          <p className="mt-1 font-mono text-[11px] text-slate-500 tabular-nums">
                            {gpsReading.latitude.toFixed(6)}, {gpsReading.longitude.toFixed(6)}
                          </p>
                        </div>
                      </div>

                      {!isAccuracyValid && (
                        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-xs text-rose-800">
                          <p className="font-bold">
                            Từ chối chấm công: Sai số GPS (±{gpsReading.accuracy}m) vượt ngưỡng {settings.max_gps_accuracy_m}m.
                          </p>
                          <p className="mt-1">
                            Vui lòng di chuyển ra khu vực thoáng hơn và nhấn &ldquo;Lấy lại GPS&rdquo;.
                          </p>
                        </div>
                      )}

                      {isAccuracyValid &&
                        !isInsideGeofence &&
                        !settings.allow_out_of_office_with_note && (
                          <div className="rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-xs text-rose-800">
                            <p className="font-bold">
                              Ngoài vùng Geofence cho phép ({gpsReading.distance}m &gt; {settings.geofence_radius_m}m).
                            </p>
                            <p className="mt-1">
                              Quản trị viên hiện đang tắt chế độ chấm công ngoài khu vực.
                            </p>
                          </div>
                        )}

                      {requiresNote && (
                        <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3.5">
                          <label
                            htmlFor="out-of-range-note"
                            className="block text-xs font-bold text-amber-900"
                          >
                            Ngoài vùng quy định ({gpsReading.distance}m). Nhập lý do bắt buộc:
                          </label>
                          <textarea
                            id="out-of-range-note"
                            rows={2}
                            value={outOfRangeNote}
                            onChange={(e) => setOutOfRangeNote(e.target.value)}
                            placeholder="Ví dụ: Hỗ trợ khu vực nhà hàng tầng 2..."
                            className="w-full rounded-xl border border-amber-300 bg-white px-3 py-2 text-base text-slate-900 focus:border-indigo-600 focus:outline-none sm:text-sm"
                          />
                          <p className="text-[11px] text-amber-800">
                            Tối thiểu 8 ký tự ({outOfRangeNote.trim().length}/8).
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* STEP 2 & 3: AUTO LIVE CAMERA (NO FILE UPLOAD) */}
              {(flowStep === 'camera_live' || flowStep === 'submitting') && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-slate-900">
                      Bước 2/2: Chụp ảnh xác thực
                    </span>
                    <span className="font-mono text-xs text-emerald-700 tabular-nums">
                      GPS ±{gpsReading?.accuracy}m
                    </span>
                  </div>

                  {submitError && (
                    <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-medium text-rose-700">
                      {submitError}
                    </div>
                  )}

                  {cameraError ? (
                    <div className="space-y-3 rounded-2xl border border-rose-200 bg-rose-50 p-4">
                      <p className="text-xs font-medium text-rose-800">
                        {cameraError}
                      </p>
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <button
                          type="button"
                          onClick={openLiveCamera}
                          className="min-h-[48px] flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50"
                        >
                          Thử mở lại Camera
                        </button>
                        {isDemoMode && (
                          <button
                            type="button"
                            onClick={() => handleCaptureAndConfirm(true)}
                            className="min-h-[48px] flex-1 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700"
                          >
                            Tạo ảnh xác thực mẫu (Chỉ Demo)
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
                        className="aspect-[3/4] max-h-[48dvh] w-full -scale-x-100 object-cover sm:aspect-[4/3]"
                      />
                      <div className="absolute right-0 bottom-0 left-0 bg-gradient-to-t from-slate-950/90 to-transparent px-3.5 py-2.5 text-xs text-white">
                        <p className="font-semibold">
                          {employee.full_name} · {employee.employee_code}
                        </p>
                        <p className="font-mono text-[11px] text-slate-300 tabular-nums">
                          {gpsReading?.latitude.toFixed(5)}, {gpsReading?.longitude.toFixed(5)} · Cách {gpsReading?.distance}m
                        </p>
                      </div>
                    </div>
                  )}

                  <p className="text-center text-[11px] text-slate-500 sm:text-xs">
                    Tự động đóng dấu thời gian thực, GPS & SHA-256. Không cho phép chọn ảnh có sẵn.
                  </p>
                </div>
              )}

              {/* STEP 4: RECEIPT CONFIRMATION */}
              {flowStep === 'receipt' && receiptLog && (
                <div className="space-y-3.5">
                  <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-3.5">
                    <CheckCircle2 className="h-7 w-7 shrink-0 text-emerald-600" />
                    <div>
                      <p className="text-sm font-bold text-emerald-900">
                        Điểm danh thành công!
                      </p>
                      <p className="text-xs text-emerald-800">
                        Giờ máy chủ:{' '}
                        <span className="font-mono font-semibold tabular-nums">
                          {formatDateTimeVN(receiptLog.server_timestamp)}
                        </span>
                      </p>
                    </div>
                  </div>

                  <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-900">
                    <img
                      src={receiptLog.photo_url}
                      alt="Ảnh xác thực đã đóng dấu pháp lý"
                      referrerPolicy="no-referrer"
                      className="aspect-[4/3] max-h-[42dvh] w-full object-cover"
                    />
                  </div>

                  <div className="space-y-1.5 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Mã bản ghi:</span>
                      <span className="font-mono font-semibold text-slate-900">
                        {receiptLog.id}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Mã băm SHA-256:</span>
                      <span className="font-mono text-slate-700">
                        {receiptLog.integrity_hash.slice(0, 18)}...
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* STICKY THUMB-ZONE ACTION FOOTER (Always reachable on small phone screens) */}
            {(flowStep === 'gps_ready' && gpsReading) ||
            ((flowStep === 'camera_live' || flowStep === 'submitting') && !cameraError) ||
            (flowStep === 'receipt' && receiptLog) ? (
              <div className="shrink-0 border-t border-slate-200 bg-white px-4 py-3 pb-safe sm:px-5 sm:py-4">
                {flowStep === 'gps_ready' && gpsReading && (
                  <button
                    type="button"
                    disabled={!canProceedToCamera}
                    onClick={openLiveCamera}
                    className="flex min-h-[54px] w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-base font-bold text-white transition-colors hover:bg-indigo-700 active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    <Camera className="h-5 w-5" />
                    <span>Mở Camera Trực Tiếp (Bước 2/2)</span>
                  </button>
                )}

                {(flowStep === 'camera_live' || flowStep === 'submitting') &&
                  !cameraError && (
                    <button
                      type="button"
                      disabled={!cameraReady || flowStep === 'submitting'}
                      onClick={() => handleCaptureAndConfirm(false)}
                      className="flex min-h-[56px] w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 text-base font-bold text-white transition-colors hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-60"
                    >
                      <Camera className="h-5 w-5" />
                      <span>
                        {flowStep === 'submitting'
                          ? 'Đang đóng dấu SHA-256 & lưu...'
                          : 'Chụp ảnh & Xác nhận'}
                      </span>
                    </button>
                  )}

                {flowStep === 'receipt' && receiptLog && (
                  <button
                    type="button"
                    onClick={closeFlow}
                    className="min-h-[52px] w-full rounded-xl bg-indigo-600 px-5 py-3 text-base font-bold text-white hover:bg-indigo-700 active:scale-[0.99]"
                  >
                    Hoàn tất
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
