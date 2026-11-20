import React, { useState } from 'react';
import { Download, PlusSquare, Share, Smartphone, WifiOff, X } from 'lucide-react';
import { useOnlineStatus, usePWAInstall } from '../hooks/usePWAInstall';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuideModal, setShowGuideModal] = useState(false);

  if (isInstalled) {
    return null;
  }

  const handleClick = async () => {
    if (isInstallable) {
      await install();
      return;
    }
    setShowGuideModal(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs font-semibold text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-100"
      >
        <Smartphone className="h-4 w-4 shrink-0 text-[#0B1E36]" />
        <span>
          {isInstallable
            ? 'Cài đặt ứng dụng lên Màn hình chính'
            : 'Hướng dẫn Thêm ra Màn hình chính'}
        </span>
        <Download className="h-3.5 w-3.5 shrink-0 text-slate-400" />
      </button>

      {showGuideModal && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/65 p-0 backdrop-blur-xs sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pwa-guide-title"
        >
          <div className="w-full max-w-md overflow-hidden rounded-t-3xl border border-slate-200 bg-white sm:rounded-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 bg-[#0B1E36] px-5 py-4 text-white">
              <div className="flex items-center gap-3">
                <img
                  src="/logo-square.png"
                  alt="Logo Ứng dụng Điểm Danh"
                  className="h-11 w-11 rounded-xl border border-white/20 object-cover"
                />
                <div>
                  <h2 id="pwa-guide-title" className="text-sm font-bold">
                    Thêm ra Màn hình chính
                  </h2>
                  <p className="text-xs text-slate-300">
                    Mở nhanh như ứng dụng trên điện thoại
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowGuideModal(false)}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-300 hover:bg-white/10 hover:text-white"
                aria-label="Đóng hướng dẫn"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4 p-5 text-sm text-slate-700">
              {isIOS ? (
                <div className="space-y-3">
                  <p className="font-semibold text-slate-900">
                    Trên iPhone / iPad (Trình duyệt Safari):
                  </p>
                  <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <Share className="mt-0.5 h-5 w-5 shrink-0 text-indigo-600" />
                    <p className="text-xs leading-relaxed">
                      <strong>Bước 1:</strong> Nhấn nút <strong>Chia sẻ (Share)</strong> ở thanh công cụ phía dưới trình duyệt Safari.
                    </p>
                  </div>
                  <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <PlusSquare className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                    <p className="text-xs leading-relaxed">
                      <strong>Bước 2:</strong> Cuộn xuống chọn <strong>Thêm vào MH chính (Add to Home Screen)</strong> rồi nhấn <strong>Thêm</strong>.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="font-semibold text-slate-900">
                    Trên điện thoại Android (Chrome / Edge):
                  </p>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-xs leading-relaxed">
                    <strong>Bước 1:</strong> Nhấn biểu tượng menu <strong>3 chấm (⋮)</strong> ở góc trên bên phải trình duyệt.
                    <br />
                    <strong className="mt-1.5 inline-block">Bước 2:</strong> Chọn{' '}
                    <strong>Thêm vào màn hình chính</strong> hoặc{' '}
                    <strong>Cài đặt ứng dụng</strong>.
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={() => setShowGuideModal(false)}
                className="min-h-[48px] w-full rounded-xl bg-[#0B1E36] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#132C4E]"
              >
                Đã hiểu
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      role="status"
      className="fixed bottom-20 left-4 z-50 flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-2 text-xs font-semibold text-amber-900 shadow-sm lg:bottom-4"
    >
      <WifiOff className="h-4 w-4 text-amber-700" />
      <span>Mất kết nối mạng · Vui lòng bật 4G/Wi-Fi để gửi ảnh điểm danh</span>
    </div>
  );
};
