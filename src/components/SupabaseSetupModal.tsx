import React, { useState } from 'react';
import { Check, Copy, Database, X } from 'lucide-react';
import { SUPABASE_SETUP_SQL } from '../lib/supabase';

interface SupabaseSetupModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SupabaseSetupModal: React.FC<SupabaseSetupModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleCopySql = async () => {
    try {
      await navigator.clipboard.writeText(SUPABASE_SETUP_SQL);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback ignored
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="supabase-setup-title"
    >
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
              <Database className="h-5 w-5" />
            </div>
            <div>
              <h2
                id="supabase-setup-title"
                className="text-lg font-semibold text-slate-900"
              >
                Hướng dẫn kết nối Supabase (Database & Storage)
              </h2>
              <p className="text-xs text-slate-500">
                Thiết lập biến môi trường và khởi tạo các bảng lưu trữ pháp lý
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
            aria-label="Đóng cửa sổ"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-6">
          <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <h3 className="text-sm font-semibold text-slate-900">
              Bước 1: Cấu hình biến môi trường
            </h3>
            <p className="text-sm text-slate-600">
              Thêm 2 khóa sau vào phần Secrets / Biến môi trường của ứng dụng và khởi động lại máy chủ phát triển:
            </p>
            <pre className="overflow-x-auto rounded-lg border border-slate-200 bg-white p-3 font-mono text-xs text-slate-800">
{`VITE_SUPABASE_URL="https://<ma-du-an>.supabase.co"
VITE_SUPABASE_ANON_KEY="<supabase-anon-public-key>"`}
            </pre>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">
                Bước 2: Chạy mã SQL trong Supabase SQL Editor
              </h3>
              <button
                type="button"
                onClick={handleCopySql}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
              >
                {copied ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-600" />
                    <span className="text-emerald-700">Đã sao chép SQL</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    <span>Sao chép toàn bộ SQL</span>
                  </>
                )}
              </button>
            </div>
            <pre className="max-h-80 overflow-auto rounded-xl border border-slate-200 bg-slate-900 p-4 font-mono text-xs leading-relaxed text-slate-100">
              {SUPABASE_SETUP_SQL}
            </pre>
          </div>
        </div>

        <div className="flex items-center justify-end border-t border-slate-200 bg-slate-50 px-6 py-3.5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
          >
            Đã hiểu
          </button>
        </div>
      </div>
    </div>
  );
};
