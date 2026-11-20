import React, { useState } from 'react';
import {
  ArrowRight,
  Camera,
  Lock,
  Search,
  ShieldCheck,
  User,
  X,
} from 'lucide-react';
import { PWAInstallButton } from './PWAInstallButton';

interface LoginScreenProps {
  companyName?: string;
  onAttendeeEnter: (fullName: string, autoStartCamera: boolean) => Promise<void>;
  onAdminLogin: (password: string) => boolean;
}

type EntryTab = 'attendee' | 'admin';

export const LoginScreen: React.FC<LoginScreenProps> = ({
  onAttendeeEnter,
  onAdminLogin,
}) => {
  const [entryTab, setEntryTab] = useState<EntryTab>('attendee');
  const [fullName, setFullName] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Lookup modal when user clicks "Xem trạng thái ca / Ra ca & Lịch sử" directly
  const [lookupModalOpen, setLookupModalOpen] = useState(false);
  const [lookupName, setLookupName] = useState('');
  const [lookupError, setLookupError] = useState('');

  const handleAttendeeSubmit = async (
    e: React.FormEvent,
    autoStartCamera: boolean
  ) => {
    e.preventDefault();
    setErrorMsg('');

    const trimmed = fullName.trim();
    if (!autoStartCamera && trimmed.length < 2) {
      setLookupName(trimmed);
      setLookupError('');
      setLookupModalOpen(true);
      return;
    }

    if (trimmed.length < 2) {
      setErrorMsg('Vui lòng nhập đầy đủ Họ và tên của bạn để vào điểm danh.');
      return;
    }

    setSubmitting(true);
    try {
      await onAttendeeEnter(trimmed, autoStartCamera);
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Không thể khởi tạo phiên điểm danh. Vui lòng thử lại.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleLookupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLookupError('');
    const trimmed = lookupName.trim();
    if (trimmed.length < 2) {
      setLookupError('Vui lòng nhập đúng Họ và tên nhân sự cần tra cứu.');
      return;
    }

    setSubmitting(true);
    try {
      await onAttendeeEnter(trimmed, false);
      setLookupModalOpen(false);
    } catch (err) {
      setLookupError(
        err instanceof Error
          ? err.message
          : 'Không thể tra cứu dữ liệu điểm danh. Vui lòng thử lại.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleAdminSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (!adminPassword.trim()) {
      setErrorMsg('Vui lòng nhập mật khẩu quản trị.');
      return;
    }

    const ok = onAdminLogin(adminPassword.trim());
    if (!ok) {
      setErrorMsg('Mật khẩu quản trị không chính xác.');
      setAdminPassword('');
    }
  };

  return (
    <div className="flex min-h-[100dvh] items-start justify-center bg-slate-100/70 px-3.5 py-4 sm:items-center sm:px-6 sm:py-8 lg:px-8">
      <div className="grid w-full max-w-4xl grid-cols-1 overflow-hidden rounded-3xl border border-slate-200/90 bg-white shadow-sm lg:grid-cols-12">
        {/* Brand Identity Panel: Deep Royal Navy matching official logo */}
        <div className="flex flex-col justify-center bg-gradient-to-br from-[#0B1E36] via-[#0E2645] to-[#071A33] px-5 py-5 text-white sm:p-8 lg:col-span-5">
          <div className="flex items-center gap-4 lg:flex-col lg:items-start lg:gap-5">
            <img
              src="/logo-square.png"
              alt="Logo Tạp vụ Nhà hàng - Chấm công"
              className="h-16 w-16 shrink-0 rounded-2xl border border-white/15 object-cover shadow-md sm:h-20 sm:w-20 lg:h-24 lg:w-24"
            />
            <div className="min-w-0">
              <h1 className="text-base font-bold tracking-tight text-white sm:text-xl lg:text-2xl">
                HỆ THỐNG ĐIỂM DANH
              </h1>
              <p className="mt-1 text-sm font-semibold text-amber-300 sm:mt-2 sm:text-base">
                Tạp vụ Nhà hàng - Sun World Ba Na Hills
              </p>
              <p className="mt-1 text-xs leading-relaxed text-slate-300 sm:text-sm">
                dành cho nhân sự Đối tác nhận việc chưa ghi nhận vân tay tại hệ thống chấm công BNC
              </p>
            </div>
          </div>
        </div>

        {/* Form Panel: Mobile-optimized thumb-friendly inputs & CTAs */}
        <div className="flex flex-col justify-center p-5 sm:p-8 lg:col-span-7 lg:p-10">
          <div className="mx-auto w-full max-w-md space-y-5">
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => {
                  setEntryTab('attendee');
                  setErrorMsg('');
                }}
                className={`min-h-[44px] rounded-lg px-3 py-2 text-xs font-semibold transition-all whitespace-nowrap sm:text-sm ${
                  entryTab === 'attendee'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Người điểm danh
              </button>
              <button
                type="button"
                onClick={() => {
                  setEntryTab('admin');
                  setErrorMsg('');
                }}
                className={`min-h-[44px] rounded-lg px-3 py-2 text-xs font-semibold transition-all whitespace-nowrap sm:text-sm ${
                  entryTab === 'admin'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Quản trị (Admin)
              </button>
            </div>

            {errorMsg && (
              <div
                role="alert"
                className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700"
              >
                {errorMsg}
              </div>
            )}

            {entryTab === 'attendee' ? (
              <form
                onSubmit={(e) => handleAttendeeSubmit(e, true)}
                className="space-y-4"
              >
                <div>
                  <label
                    htmlFor="attendee-full-name"
                    className="block text-sm font-semibold text-slate-800"
                  >
                    Họ và tên nhân sự <span className="text-rose-600">*</span>
                  </label>
                  <div className="relative mt-2">
                    <User className="pointer-events-none absolute top-1/2 left-3.5 h-5 w-5 -translate-y-1/2 text-slate-400" />
                    <input
                      id="attendee-full-name"
                      type="text"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Nhập đầy đủ họ và tên"
                      autoComplete="name"
                      className="min-h-[52px] w-full rounded-xl border border-slate-300 bg-white py-3 pr-4 pl-11 text-base text-slate-900 transition-colors focus:border-indigo-600 focus:ring-2 focus:ring-indigo-600/20 focus:outline-none"
                      required
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="flex min-h-[56px] w-full items-center justify-center gap-2.5 rounded-xl bg-emerald-600 px-5 py-3.5 text-base font-bold text-white transition-all hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-60"
                >
                  <Camera className="h-5 w-5 shrink-0" />
                  <span>
                    {submitting
                      ? 'Đang mở camera điểm danh...'
                      : 'Vào chụp ảnh điểm danh ngay'}
                  </span>
                </button>

                <button
                  type="button"
                  disabled={submitting}
                  onClick={(e) => handleAttendeeSubmit(e, false)}
                  className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60"
                >
                  <Search className="h-4 w-4 shrink-0 text-indigo-600" />
                  <span>Xem trạng thái ca / Ra ca & Lịch sử</span>
                  <ArrowRight className="h-4 w-4 shrink-0" />
                </button>

                <div className="pt-1">
                  <PWAInstallButton />
                </div>
              </form>
            ) : (
              <form onSubmit={handleAdminSubmit} className="space-y-4">
                <div>
                  <label
                    htmlFor="admin-password"
                    className="block text-sm font-semibold text-slate-800"
                  >
                    Mật khẩu Quản trị viên
                  </label>
                  <div className="relative mt-2">
                    <Lock className="pointer-events-none absolute top-1/2 left-3.5 h-5 w-5 -translate-y-1/2 text-slate-400" />
                    <input
                      id="admin-password"
                      type="password"
                      value={adminPassword}
                      onChange={(e) => setAdminPassword(e.target.value)}
                      placeholder="Nhập mật khẩu Admin"
                      autoComplete="current-password"
                      className="min-h-[52px] w-full rounded-xl border border-slate-300 bg-white py-3 pr-4 pl-11 font-mono text-base text-slate-900 transition-colors focus:border-indigo-600 focus:ring-2 focus:ring-indigo-600/20 focus:outline-none"
                      required
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-[#0B1E36] px-5 py-3 text-base font-semibold text-white transition-all hover:bg-[#132C4E] active:scale-[0.99]"
                >
                  <ShieldCheck className="h-5 w-5 shrink-0" />
                  <span>Đăng nhập Quản trị hệ thống</span>
                </button>
              </form>
            )}
          </div>
        </div>
      </div>

      {/* Modal Tra cứu Trạng thái Ca & Lịch sử theo Họ và tên */}
      {lookupModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/60 p-0 backdrop-blur-xs sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="lookup-modal-title"
        >
          <div className="w-full max-w-md overflow-hidden rounded-t-3xl border border-slate-200 bg-white sm:rounded-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <h2
                  id="lookup-modal-title"
                  className="text-base font-bold text-slate-900"
                >
                  Tra cứu & Trích xuất Dữ liệu Điểm danh
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Nhập đúng Họ và tên để xem chi tiết giờ vào/ra ca, ảnh và vị trí GPS
                </p>
              </div>
              <button
                type="button"
                onClick={() => setLookupModalOpen(false)}
                className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                aria-label="Đóng hộp thoại tra cứu"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleLookupSubmit} className="space-y-4 p-5 pb-safe">
              {lookupError && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-medium text-rose-700">
                  {lookupError}
                </div>
              )}

              <div>
                <label
                  htmlFor="lookup-full-name"
                  className="block text-sm font-semibold text-slate-800"
                >
                  Họ và tên người đã điểm danh <span className="text-rose-600">*</span>
                </label>
                <div className="relative mt-2">
                  <User className="pointer-events-none absolute top-1/2 left-3.5 h-5 w-5 -translate-y-1/2 text-slate-400" />
                  <input
                    id="lookup-full-name"
                    type="text"
                    autoFocus
                    value={lookupName}
                    onChange={(e) => setLookupName(e.target.value)}
                    placeholder="Ví dụ: Nguyễn Minh Tuấn"
                    autoComplete="name"
                    className="min-h-[52px] w-full rounded-xl border border-slate-300 bg-white py-3 pr-4 pl-11 text-base text-slate-900 focus:border-indigo-600 focus:ring-2 focus:ring-indigo-600/20 focus:outline-none"
                    required
                  />
                </div>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row-reverse">
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex min-h-[50px] flex-1 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-60"
                >
                  <Search className="h-4 w-4" />
                  <span>
                    {submitting ? 'Đang trích xuất...' : 'Xem toàn bộ dữ liệu'}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setLookupModalOpen(false)}
                  className="min-h-[46px] rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Đóng
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
