import React, { useState } from 'react';
import {
  AlertTriangle,
  Camera,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  MapPin,
  Shield,
  Smartphone,
  X,
} from 'lucide-react';
import { AttendanceLog } from '../types';
import { formatDateTimeVN, getVNDateKey, normalizeFullName } from '../utils/forensics';

interface EvidenceInspectorModalProps {
  log: AttendanceLog | null;
  allLogs: AttendanceLog[];
  onClose: () => void;
  onRequestAdjust?: (log: AttendanceLog) => void;
}

function PhotoFrame({
  label,
  log,
}: {
  label: string;
  log: AttendanceLog | null;
}) {
  const [imgError, setImgError] = useState(false);

  if (!log) {
    return (
      <div className="flex flex-col justify-between rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4">
        <span className="text-xs font-semibold text-slate-600">{label}</span>
        <div className="my-8 flex flex-col items-center justify-center text-center text-slate-400">
          <Camera className="mb-2 h-8 w-8 stroke-1" />
          <p className="text-sm font-medium text-slate-600">
            Chưa có dữ liệu ảnh đối ứng
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Nhân viên đang trong ca hoặc chưa chấm công đầu/cuối ca
          </p>
        </div>
        <div className="text-xs text-slate-400">—</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-2.5">
        <span className="text-xs font-semibold text-slate-800">{label}</span>
        <span className="font-mono text-xs text-slate-500 tabular-nums">
          {formatDateTimeVN(log.server_timestamp)}
        </span>
      </div>

      <div className="relative aspect-[4/3] w-full bg-slate-900">
        {!imgError && log.photo_url ? (
          <img
            src={log.photo_url}
            alt={`Ảnh ${label} của ${log.employee_name}`}
            referrerPolicy="no-referrer"
            onError={() => setImgError(true)}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center bg-slate-800 p-4 text-center text-slate-300">
            <Camera className="mb-2 h-8 w-8 text-slate-400" />
            <p className="text-sm font-medium">Không thể tải ảnh từ Storage</p>
            <p className="mt-1 font-mono text-xs text-slate-400">
              {log.employee_name} · {log.employee_code}
            </p>
          </div>
        )}

        {/* Forensic watermark summary strip if image is a raw demo sample without burned bar */}
        <div className="absolute right-0 bottom-0 left-0 bg-gradient-to-t from-slate-950/90 via-slate-950/70 to-transparent px-3 py-2.5 text-white">
          <div className="flex items-center justify-between gap-2 text-[11px] font-medium">
            <span className="truncate">
              {log.employee_name} ({log.employee_code})
            </span>
            <span className="shrink-0 font-mono text-emerald-300 tabular-nums">
              ±{Math.round(log.gps_accuracy_m)}m · {Math.round(log.distance_to_office_m)}m
            </span>
          </div>
          <div className="mt-0.5 flex items-center justify-between gap-2 font-mono text-[10px] text-slate-300 tabular-nums">
            <span>
              {log.latitude.toFixed(6)}, {log.longitude.toFixed(6)}
            </span>
            <span>SHA-256: {log.integrity_hash.slice(0, 12).toUpperCase()}</span>
          </div>
        </div>
      </div>

      <div className="space-y-1.5 p-3.5 text-xs">
        <div className="flex items-center justify-between text-slate-600">
          <span>Trạng thái vùng:</span>
          {log.geofence_status === 'valid' ? (
            <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Hợp lệ trong vùng
            </span>
          ) : log.geofence_status === 'out_of_range_noted' ? (
            <span className="inline-flex items-center gap-1 font-semibold text-amber-700">
              <AlertTriangle className="h-3.5 w-3.5" />
              Ngoài vùng (Có ghi chú)
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 font-semibold text-rose-700">
              <AlertTriangle className="h-3.5 w-3.5" />
              Cảnh báo vi phạm
            </span>
          )}
        </div>
        <div className="flex items-center justify-between text-slate-600">
          <span>Khoảng cách & Sai số GPS:</span>
          <span className="font-mono font-medium text-slate-900 tabular-nums">
            {Math.round(log.distance_to_office_m)}m · ±{Math.round(log.gps_accuracy_m)}m
          </span>
        </div>
        {log.note && (
          <div className="border-t border-slate-100 pt-1.5 text-slate-700">
            <span className="font-medium text-slate-500">Ghi chú: </span>
            {log.note}
          </div>
        )}
      </div>
    </div>
  );
}

export const EvidenceInspectorModal: React.FC<EvidenceInspectorModalProps> = ({
  log,
  allLogs,
  onClose,
  onRequestAdjust,
}) => {
  const [copiedHash, setCopiedHash] = useState(false);

  if (!log) return null;

  const targetDateKey = getVNDateKey(log.server_timestamp);
  const partnerAction = log.action === 'check_in' ? 'check_out' : 'check_in';
  const normalizedTargetName = normalizeFullName(log.employee_name);
  const partnerLog =
    allLogs.find(
      (item) =>
        item.id !== log.id &&
        (item.employee_code === log.employee_code ||
          normalizeFullName(item.employee_name) === normalizedTargetName) &&
        item.action === partnerAction &&
        getVNDateKey(item.server_timestamp) === targetDateKey
    ) || null;

  const checkInLog = log.action === 'check_in' ? log : partnerLog;
  const checkOutLog = log.action === 'check_out' ? log : partnerLog;

  const mapsUrl = `https://www.google.com/maps?q=${log.latitude},${log.longitude}`;

  const handleCopyHash = async () => {
    try {
      await navigator.clipboard.writeText(log.integrity_hash);
      setCopiedHash(true);
      window.setTimeout(() => setCopiedHash(false), 2000);
    } catch {
      // Ignore clipboard failure
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="evidence-modal-title"
    >
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h2
              id="evidence-modal-title"
              className="text-lg font-bold text-slate-900"
            >
              Trình Kiểm Tra Chứng Cứ Chấm Công
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {log.employee_name} · Mã NV: {log.employee_code} · Phòng {log.department} · Bản ghi {log.id}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
            aria-label="Đóng trình kiểm tra"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto p-6">
          {/* Side-by-side forensic photos */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <PhotoFrame label="Ảnh Chấm Công Vào Ca (Check-in)" log={checkInLog} />
            <PhotoFrame label="Ảnh Chấm Công Ra Ca (Check-out)" log={checkOutLog} />
          </div>

          {/* Forensic Telemetry Details */}
          <div className="grid grid-cols-1 gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4 md:grid-cols-2">
            <div className="space-y-3">
              <div className="flex items-start gap-2.5">
                <Clock className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600" />
                <div className="space-y-1 text-xs">
                  <p className="font-semibold text-slate-900">
                    Đối chiếu thời gian máy chủ & thiết bị
                  </p>
                  <p className="text-slate-600">
                    Giờ máy chủ (Chuẩn pháp lý):{' '}
                    <span className="font-mono font-semibold text-slate-900 tabular-nums">
                      {formatDateTimeVN(log.server_timestamp)}
                    </span>
                  </p>
                  <p className="text-slate-600">
                    Giờ thiết bị gửi lên:{' '}
                    <span className="font-mono text-slate-800 tabular-nums">
                      {formatDateTimeVN(log.device_timestamp)}
                    </span>
                  </p>
                  <p
                    className={`font-mono font-semibold tabular-nums ${
                      log.clock_tamper_flag ? 'text-rose-700' : 'text-emerald-700'
                    }`}
                  >
                    Độ lệch đồng hồ: {log.clock_drift_seconds} giây{' '}
                    {log.clock_tamper_flag
                      ? '(Cảnh báo sai lệch > 60 giây)'
                      : '(Bình thường)'}
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-2.5">
                <Smartphone className="mt-0.5 h-4 w-4 shrink-0 text-slate-600" />
                <div className="space-y-0.5 text-xs">
                  <p className="font-semibold text-slate-900">Thiết bị ghi nhận</p>
                  <p className="text-slate-600">
                    {log.device_info || 'Trình duyệt di động chuẩn'}
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-start gap-2.5">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                <div className="space-y-1 text-xs">
                  <p className="font-semibold text-slate-900">
                    Vị trí GPS & Địa chỉ OpenStreetMap
                  </p>
                  <p className="text-slate-700">{log.address_text}</p>
                  <a
                    href={mapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 font-mono font-medium text-indigo-600 hover:text-indigo-700 hover:underline"
                  >
                    <span>
                      {log.latitude.toFixed(6)}, {log.longitude.toFixed(6)}
                    </span>
                    <ExternalLink className="h-3.5 w-3.5" />
                    <span>Mở trên Google Maps</span>
                  </a>
                </div>
              </div>

              <div className="flex items-start gap-2.5">
                <Shield className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600" />
                <div className="min-w-0 flex-1 space-y-1 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold text-slate-900">
                      Mã băm toàn vẹn SHA-256
                    </p>
                    <button
                      type="button"
                      onClick={handleCopyHash}
                      className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-700"
                    >
                      {copiedHash ? (
                        <>
                          <Check className="h-3 w-3" />
                          <span>Đã chép</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" />
                          <span>Sao chép</span>
                        </>
                      )}
                    </button>
                  </div>
                  <p className="break-all rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-[11px] text-slate-700">
                    {log.integrity_hash}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-6 py-3.5">
          <p className="text-xs text-slate-500">
            Dữ liệu gốc không thể xóa cứng nhằm bảo đảm tính pháp lý kiểm toán.
          </p>
          <div className="flex items-center gap-2.5">
            {onRequestAdjust && (
              <button
                type="button"
                onClick={() => onRequestAdjust(log)}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100"
              >
                Điều chỉnh giờ & Ghi Audit
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
            >
              Đóng
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
