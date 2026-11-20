import * as XLSX from 'xlsx';
import { AttendanceLog, AuditLog, PayrollSummaryRow } from '../types';
import { formatDateTimeVN } from './forensics';

function translateGeofenceStatus(status: AttendanceLog['geofence_status']): string {
  switch (status) {
    case 'valid':
      return 'Hợp lệ trong vùng';
    case 'out_of_range_noted':
      return 'Ngoài vùng (Có ghi chú lý do)';
    case 'violation':
      return 'Cảnh báo vi phạm vùng';
  }
}

export function exportLegalAttendanceExcel(
  summaryRows: PayrollSummaryRow[],
  logs: AttendanceLog[],
  auditLogs: AuditLog[],
  periodLabel: string
): void {
  const wb = XLSX.utils.book_new();

  // Sheet 1: Tong_Hop_Cong_Chi_Phi
  const sheet1Data = summaryRows.map((row) => ({
    'Mã nhân viên': row.employee.employee_code,
    'Họ và tên': row.employee.full_name,
    'Phòng ban': row.employee.department,
    'Chức vụ': row.employee.position,
    'Số ngày công': row.totalShifts,
    'Tổng giờ làm thực tế': row.totalWorkHours,
    'Số phút đi muộn': row.lateMinutes,
    'Giờ tăng ca (OT)': row.overtimeHours,
    'Hình thức lương': row.employee.pay_type === 'hourly' ? 'Theo giờ' : 'Theo ngày',
    'Đơn giá lương (VNĐ)': row.employee.base_rate_vnd,
    'Thành tiền chi phí thực tế (VNĐ)': row.laborCostVnd,
  }));

  const ws1 = XLSX.utils.json_to_sheet(
    sheet1Data.length > 0
      ? sheet1Data
      : [
          {
            'Mã nhân viên': 'Không có dữ liệu trong kỳ lọc',
          },
        ]
  );
  ws1['!cols'] = [
    { wch: 15 },
    { wch: 24 },
    { wch: 18 },
    { wch: 20 },
    { wch: 14 },
    { wch: 20 },
    { wch: 16 },
    { wch: 16 },
    { wch: 16 },
    { wch: 22 },
    { wch: 28 },
  ];
  XLSX.utils.book_append_sheet(wb, ws1, 'Tong_Hop_Cong_Chi_Phi');

  // Sheet 2: Du_Lieu_Cham_Cong_Goc
  const sheet2Data = logs.map((log) => ({
    'Mã bản ghi': log.id,
    'Mã nhân viên': log.employee_code,
    'Họ và tên': log.employee_name,
    'Hành động': log.action === 'check_in' ? 'Vào ca' : 'Ra ca',
    'Thời gian máy chủ hợp lệ (UTC+7)': formatDateTimeVN(log.server_timestamp),
    'Thời gian thiết bị': formatDateTimeVN(log.device_timestamp),
    'Độ lệch đồng hồ (giây)': log.clock_drift_seconds,
    'Vĩ độ (Latitude)': log.latitude,
    'Kinh độ (Longitude)': log.longitude,
    'Sai số GPS (m)': Math.round(log.gps_accuracy_m),
    'Khoảng cách tới công ty (m)': Math.round(log.distance_to_office_m),
    'Trạng thái Geofence': translateGeofenceStatus(log.geofence_status),
    'Địa chỉ đầy đủ': log.address_text,
    'Liên kết ảnh Supabase': log.photo_url,
    'Mã băm toàn vẹn SHA-256': log.integrity_hash,
    'Ghi chú': log.note || '',
  }));

  const ws2 = XLSX.utils.json_to_sheet(
    sheet2Data.length > 0
      ? sheet2Data
      : [
          {
            'Mã bản ghi': 'Chưa có dữ liệu chấm công trong kỳ lọc',
          },
        ]
  );
  ws2['!cols'] = [
    { wch: 20 },
    { wch: 14 },
    { wch: 22 },
    { wch: 12 },
    { wch: 26 },
    { wch: 24 },
    { wch: 20 },
    { wch: 15 },
    { wch: 15 },
    { wch: 14 },
    { wch: 24 },
    { wch: 24 },
    { wch: 42 },
    { wch: 42 },
    { wch: 36 },
    { wch: 28 },
  ];
  XLSX.utils.book_append_sheet(wb, ws2, 'Du_Lieu_Cham_Cong_Goc');

  // Sheet 3: Nhat_Ky_Chinh_Sua_Audit
  const sheet3Data = auditLogs.map((a) => ({
    'Thời gian chỉnh sửa (UTC+7)': formatDateTimeVN(a.edited_at),
    'Quản trị viên thực hiện': a.admin_name,
    'Mã bản ghi mục tiêu': a.target_record_id,
    'Nhân viên liên quan': a.target_employee_name,
    'Giá trị cũ': a.old_value,
    'Giá trị mới': a.new_value,
    'Lý do điều chỉnh': a.reason,
  }));

  const ws3 = XLSX.utils.json_to_sheet(
    sheet3Data.length > 0
      ? sheet3Data
      : [
          {
            'Thời gian chỉnh sửa (UTC+7)': 'Chưa có lịch sử chỉnh sửa',
          },
        ]
  );
  ws3['!cols'] = [
    { wch: 24 },
    { wch: 24 },
    { wch: 22 },
    { wch: 22 },
    { wch: 32 },
    { wch: 32 },
    { wch: 38 },
  ];
  XLSX.utils.book_append_sheet(wb, ws3, 'Nhat_Ky_Chinh_Sua_Audit');

  const safePeriod = periodLabel.replace(/[^a-zA-Z0-9_-]/g, '_');
  const fileName = `Bao_Cao_Cham_Cong_Phap_Ly_${safePeriod}.xlsx`;
  XLSX.writeFile(wb, fileName);
}

export function exportPersonalAttendanceExcel(params: {
  employeeName: string;
  employeeCode: string;
  department: string;
  summaryRow?: PayrollSummaryRow;
  logs: AttendanceLog[];
  periodLabel: string;
}): void {
  const { employeeName, employeeCode, department, summaryRow, logs, periodLabel } = params;
  const wb = XLSX.utils.book_new();

  const summarySheetData = [
    {
      'Họ và tên': employeeName,
      'Mã nhân viên': employeeCode,
      'Bộ phận': department,
      'Kỳ trích xuất': periodLabel,
      'Tổng lượt điểm danh': logs.length,
      'Số ca ghi nhận': summaryRow?.totalShifts ?? 0,
      'Tổng giờ làm (giờ)': summaryRow?.totalWorkHours ?? 0,
      'Số phút đi muộn': summaryRow?.lateMinutes ?? 0,
      'Giờ tăng ca OT (giờ)': summaryRow?.overtimeHours ?? 0,
      'Chi phí / Thu nhập tạm tính (VNĐ)': summaryRow?.laborCostVnd ?? 0,
    },
  ];
  const wsSummary = XLSX.utils.json_to_sheet(summarySheetData);
  wsSummary['!cols'] = [
    { wch: 24 },
    { wch: 15 },
    { wch: 20 },
    { wch: 22 },
    { wch: 20 },
    { wch: 16 },
    { wch: 18 },
    { wch: 16 },
    { wch: 20 },
    { wch: 30 },
  ];
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Tong_Hop_Ca_Nhan');

  const detailData = logs.map((log) => ({
    'Mã bản ghi': log.id,
    'Họ và tên': log.employee_name,
    'Mã nhân viên': log.employee_code,
    'Bộ phận': log.department,
    'Hành động': log.action === 'check_in' ? 'Vào ca (Check-in)' : 'Ra ca (Check-out)',
    'Thời gian máy chủ (UTC+7)': formatDateTimeVN(log.server_timestamp),
    'Thời gian thiết bị': formatDateTimeVN(log.device_timestamp),
    'Độ lệch đồng hồ (giây)': log.clock_drift_seconds,
    'Cảnh báo đồng hồ': log.clock_tamper_flag ? 'Có (> 60s)' : 'Bình thường',
    'Vĩ độ (Latitude)': log.latitude,
    'Kinh độ (Longitude)': log.longitude,
    'Google Maps': `https://www.google.com/maps?q=${log.latitude},${log.longitude}`,
    'Sai số GPS (m)': Math.round(log.gps_accuracy_m),
    'Khoảng cách tới điểm (m)': Math.round(log.distance_to_office_m),
    'Trạng thái Geofence': translateGeofenceStatus(log.geofence_status),
    'Địa chỉ xác định': log.address_text,
    'Liên kết ảnh xác thực': log.photo_url,
    'Mã băm SHA-256': log.integrity_hash,
    'Thiết bị': log.device_info || '',
    'Ghi chú': log.note || '',
    'Trạng thái hiệu chỉnh': log.is_adjusted
      ? `Đã điều chỉnh bởi ${log.adjusted_by || 'Admin'}`
      : 'Dữ liệu gốc',
  }));

  const wsDetail = XLSX.utils.json_to_sheet(
    detailData.length > 0
      ? detailData
      : [{ 'Mã bản ghi': 'Chưa có dữ liệu điểm danh trong khoảng thời gian đã chọn' }]
  );
  wsDetail['!cols'] = [
    { wch: 18 },
    { wch: 24 },
    { wch: 14 },
    { wch: 18 },
    { wch: 20 },
    { wch: 24 },
    { wch: 22 },
    { wch: 20 },
    { wch: 18 },
    { wch: 14 },
    { wch: 14 },
    { wch: 42 },
    { wch: 14 },
    { wch: 22 },
    { wch: 26 },
    { wch: 44 },
    { wch: 44 },
    { wch: 40 },
    { wch: 28 },
    { wch: 28 },
    { wch: 26 },
  ];
  XLSX.utils.book_append_sheet(wb, wsDetail, 'Chi_Tiet_Diem_Danh');

  const asciiName = employeeName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const safePeriod = periodLabel.replace(/[^a-zA-Z0-9_-]/g, '_');
  XLSX.writeFile(wb, `Diem_Danh_${asciiName || 'Nhan_Su'}_${safePeriod}.xlsx`);
}
