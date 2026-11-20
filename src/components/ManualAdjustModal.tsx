import React, { useEffect, useState } from 'react';
import { FileEdit, ShieldAlert, X } from 'lucide-react';
import { AttendanceLog, GeofenceStatus } from '../types';
import { formatDateTimeVN } from '../utils/forensics';

interface ManualAdjustModalProps {
  log: AttendanceLog | null;
  onClose: () => void;
  onSaveAdjustment: (params: {
    logId: string;
    newTimestampIso: string;
    newGeofenceStatus: GeofenceStatus;
    newNote: string;
    reason: string;
  }) => Promise<void>;
}

function isoToVNDatetimeLocal(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  // Format in Asia/Ho_Chi_Minh as YYYY-MM-DDTHH:mm
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const get = (t: string) => parts.find((p) => p.type === t)?.value || '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

export const ManualAdjustModal: React.FC<ManualAdjustModalProps> = ({
  log,
  onClose,
  onSaveAdjustment,
}) => {
  const [datetimeLocal, setDatetimeLocal] = useState('');
  const [geofenceStatus, setGeofenceStatus] = useState<GeofenceStatus>('valid');
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (log) {
      setDatetimeLocal(isoToVNDatetimeLocal(log.server_timestamp));
      setGeofenceStatus(log.geofence_status);
      setNote(log.note || '');
      setReason('');
      setError('');
    }
  }, [log]);

  if (!log) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!datetimeLocal) {
      setError('Vui lòng chọn thời gian điều chỉnh hợp lệ.');
      return;
    }

    if (reason.trim().length < 5) {
      setError(
        'Vui lòng nhập Lý do điều chỉnh rõ ràng (tối thiểu 5 ký tự) để lưu vết Audit bất biến.'
      );
      return;
    }

    const newIso = new Date(`${datetimeLocal}:00+07:00`).toISOString();

    setSaving(true);
    try {
      await onSaveAdjustment({
        logId: log.id,
        newTimestampIso: newIso,
        newGeofenceStatus: geofenceStatus,
        newNote: note.trim(),
        reason: reason.trim(),
      });
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Không thể lưu điều chỉnh.'
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="adjust-modal-title"
    >
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <FileEdit className="h-5 w-5 text-indigo-600" />
            <div>
              <h2
                id="adjust-modal-title"
                className="text-base font-bold text-slate-900"
              >
                Điều chỉnh bản ghi chấm công
              </h2>
              <p className="text-xs text-slate-500">
                {log.employee_name} ({log.employee_code}) · {log.id}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            aria-label="Đóng"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-6">
          <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <div>
              Mọi thay đổi đều ghi lại giá trị cũ và mới vào bảng{' '}
              <span className="font-semibold">Nhật ký Audit bất biến</span>. Hệ thống không cho phép xóa bản ghi chấm công.
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
            Thời gian gốc hiện tại:{' '}
            <span className="font-mono font-semibold text-slate-900 tabular-nums">
              {formatDateTimeVN(log.server_timestamp)}
            </span>
          </div>

          {error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-medium text-rose-700">
              {error}
            </div>
          )}

          <div>
            <label
              htmlFor="adjust-datetime"
              className="block text-sm font-medium text-slate-700"
            >
              Thời gian hợp lệ mới (UTC+7)
            </label>
            <input
              id="adjust-datetime"
              type="datetime-local"
              value={datetimeLocal}
              onChange={(e) => setDatetimeLocal(e.target.value)}
              className="mt-1.5 min-h-[42px] w-full rounded-xl border border-slate-200 px-3.5 py-2 font-mono text-sm text-slate-900 focus:border-indigo-600 focus:ring-2 focus:ring-indigo-600/20 focus:outline-none"
              required
            />
          </div>

          <div>
            <label
              htmlFor="adjust-geofence"
              className="block text-sm font-medium text-slate-700"
            >
              Trạng thái vùng Geofence
            </label>
            <select
              id="adjust-geofence"
              value={geofenceStatus}
              onChange={(e) => setGeofenceStatus(e.target.value as GeofenceStatus)}
              className="mt-1.5 min-h-[42px] w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-indigo-600 focus:ring-2 focus:ring-indigo-600/20 focus:outline-none"
            >
              <option value="valid">Hợp lệ trong vùng</option>
              <option value="out_of_range_noted">Ngoài vùng (Có ghi chú)</option>
              <option value="violation">Cảnh báo vi phạm vùng</option>
            </select>
          </div>

          <div>
            <label
              htmlFor="adjust-note"
              className="block text-sm font-medium text-slate-700"
            >
              Ghi chú kèm bản ghi
            </label>
            <input
              id="adjust-note"
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Ghi chú bổ sung (nếu có)"
              className="mt-1.5 min-h-[42px] w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-indigo-600 focus:ring-2 focus:ring-indigo-600/20 focus:outline-none"
            />
          </div>

          <div>
            <label
              htmlFor="adjust-reason"
              className="block text-sm font-medium text-slate-700"
            >
              Lý do điều chỉnh <span className="text-rose-600">*</span>
            </label>
            <textarea
              id="adjust-reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ví dụ: Nhân viên quên ra ca khi đi gặp khách hàng, đã đối chiếu log bảo vệ sảnh."
              className="mt-1.5 w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm text-slate-900 focus:border-indigo-600 focus:ring-2 focus:ring-indigo-600/20 focus:outline-none"
              required
            />
          </div>

          <div className="flex items-center justify-end gap-2.5 border-t border-slate-200 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Hủy bỏ
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {saving ? 'Đang lưu...' : 'Xác nhận điều chỉnh'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
