// SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
// SPDX-License-Identifier: Apache-2.0
// Curated, fictional demonstration data for a DISPOSABLE stack (never run it against a stack that holds real data).
// Everything goes through the public API with the real demo identities; nothing touches the database.
// Record ids are derived from a stable key, so re-running is idempotent (create is idempotent per the Platform contract).
// Usage (BFF of the demo stack running): tsx scripts/seed-demo.ts
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { apiLogin, HR, type Api } from "../support/api.ts";
import { localFile } from "../support/settings.ts";

const id = (key: string) => {
  const h = createHash("sha1").update(`opentrix-m62-demo:${key}`).digest();
  h[6] = (h[6]! & 0x0f) | 0x50;
  h[8] = (h[8]! & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
};

const CATEGORIES = [
  { code: "NETWORK", name: "Mạng và VPN", description: "Sự cố kết nối mạng nội bộ, Wi-Fi, VPN", active: true },
  { code: "HARDWARE", name: "Thiết bị phần cứng", description: "Máy tính, màn hình, máy in, thiết bị ngoại vi", active: true },
  { code: "ACCOUNT", name: "Tài khoản và quyền truy cập", description: "Cấp mới, khôi phục mật khẩu, phân quyền hệ thống", active: true },
  { code: "SOFTWARE", name: "Phần mềm và giấy phép", description: "Cài đặt, cập nhật và cấp giấy phép phần mềm", active: true },
  { code: "EMAIL", name: "Email và cộng tác", description: "Hộp thư, lịch họp, nhóm làm việc trực tuyến", active: true },
];

type Step = "start" | "resolve" | "confirm" | "reopen" | "cancel" | "submit" | "discard";
interface Ticket { key: string; who: "requester1" | "requester2" | "dual"; title: string; description: string; categoryCode: string; priority: "LOW" | "NORMAL" | "HIGH" | "URGENT"; steps: Step[] }

const TICKETS: Ticket[] = [
  { key: "t01", who: "requester1", title: "Không kết nối được VPN khi làm việc từ xa", categoryCode: "NETWORK", priority: "URGENT",
    description: "Từ sáng nay laptop báo lỗi 'Authentication failed' khi kết nối VPN công ty.\nĐã thử khởi động lại máy và đổi mạng Wi-Fi nhưng vẫn không vào được.\nCần truy cập hệ thống kế toán trước 11 giờ để đóng sổ cuối tháng.", steps: ["submit"] },
  { key: "t02", who: "requester2", title: "Máy in tầng 3 báo lỗi kẹt giấy liên tục", categoryCode: "HARDWARE", priority: "HIGH",
    description: "Máy in HP LaserJet khu vực phòng Kinh doanh bị kẹt giấy sau mỗi 3–4 trang.\nĐã mở khay kiểm tra, không thấy giấy kẹt. Phòng cần in hợp đồng trong chiều nay.", steps: ["submit"] },
  { key: "t03", who: "requester1", title: "Đề nghị cấp quyền truy cập thư mục dự án Alpha", categoryCode: "ACCOUNT", priority: "NORMAL",
    description: "Tôi vừa được phân công vào dự án Alpha, cần quyền đọc và ghi trên thư mục chia sẻ \\\\fs01\\projects\\alpha.\nNgười duyệt: chị Nguyễn Thanh Mai, Trưởng phòng Vận hành.", steps: ["submit"] },
  { key: "t04", who: "dual", title: "Cài đặt phần mềm thiết kế cho máy mới", categoryCode: "SOFTWARE", priority: "NORMAL",
    description: "Máy tính mới được cấp tuần này chưa có Adobe Illustrator và Figma.\nĐã có phê duyệt giấy phép từ trưởng nhóm thiết kế.", steps: ["submit", "start"] },
  { key: "t05", who: "requester2", title: "Màn hình laptop nhấp nháy khi cắm dock USB-C", categoryCode: "HARDWARE", priority: "HIGH",
    description: "Màn hình bị nhấp nháy khi cắm dock tại phòng họp tầng 3.\nĐã thử đổi cáp nhưng tình trạng không thay đổi.", steps: ["submit", "start"] },
  { key: "t06", who: "requester1", title: "Không nhận được email từ đối tác bên ngoài", categoryCode: "EMAIL", priority: "HIGH",
    description: "Từ hôm qua email của đối tác (miền @tanphat-logistics.example) không về hộp thư của tôi, cả thư rác cũng không có.\nHọ xác nhận đã gửi thành công.", steps: ["submit", "start"] },
  { key: "t07", who: "requester2", title: "Khôi phục mật khẩu tài khoản phần mềm quản lý kho", categoryCode: "ACCOUNT", priority: "NORMAL",
    description: "Tôi quên mật khẩu và hệ thống khóa tài khoản sau 5 lần đăng nhập sai.\nXin hỗ trợ mở khóa và gửi hướng dẫn đặt lại mật khẩu.", steps: ["submit", "start", "resolve"] },
  { key: "t08", who: "requester1", title: "Wi-Fi khu vực phòng họp B chập chờn", categoryCode: "NETWORK", priority: "LOW",
    description: "Tín hiệu Wi-Fi ở phòng họp B tầng 2 thường xuyên mất khi họp trực tuyến.\nXảy ra nhiều nhất vào các buổi chiều.", steps: ["submit", "start", "resolve"] },
  { key: "t09", who: "requester1", title: "Cấp tài khoản cho nhân viên mới bộ phận Kế toán", categoryCode: "ACCOUNT", priority: "NORMAL",
    description: "Nhân viên mới bắt đầu làm việc ngày 01/12 cần tài khoản email, ERP và VPN.", steps: ["submit", "start", "resolve", "confirm"] },
  { key: "t10", who: "requester2", title: "Thay chuột và bàn phím không dây bị hỏng", categoryCode: "HARDWARE", priority: "LOW",
    description: "Bộ chuột và bàn phím không dây bị mất kết nối thường xuyên, đã thay pin mới nhưng không cải thiện.", steps: ["submit", "start", "resolve", "confirm"] },
  { key: "t11", who: "requester1", title: "Cập nhật chứng chỉ số cho phần mềm khai báo thuế", categoryCode: "SOFTWARE", priority: "HIGH",
    description: "Chứng chỉ số sắp hết hạn vào cuối tháng. Cần kỹ thuật viên hỗ trợ cài đặt chứng chỉ mới.", steps: ["submit", "start", "resolve", "confirm"] },
  { key: "t12", who: "requester2", title: "Yêu cầu tạo nhóm email chung cho bộ phận Chăm sóc khách hàng", categoryCode: "EMAIL", priority: "NORMAL",
    description: "Cần nhóm cskh@opentrix.example để nhận và phân phối thư khách hàng cho 8 thành viên.", steps: ["submit", "cancel"] },
  { key: "t13", who: "requester1", title: "Laptop chạy chậm sau khi cập nhật hệ điều hành", categoryCode: "HARDWARE", priority: "NORMAL",
    description: "Sau bản cập nhật tuần trước, máy khởi động mất hơn 5 phút và quạt chạy liên tục.", steps: ["submit", "start", "resolve", "reopen"] },
  { key: "t14", who: "requester2", title: "Đăng ký phần mềm họp trực tuyến cho nhóm dự án", categoryCode: "SOFTWARE", priority: "LOW",
    description: "Nhóm dự án Beta (6 người) cần giấy phép phần mềm họp trực tuyến có ghi hình.", steps: [] },
  { key: "t15", who: "requester1", title: "Báo cáo email lừa đảo giả mạo ngân hàng", categoryCode: "EMAIL", priority: "URGENT",
    description: "Một số nhân viên nhận email giả mạo ngân hàng yêu cầu xác nhận tài khoản.\nĐã chuyển tiếp thư mẫu cho bộ phận an toàn thông tin.", steps: ["submit", "start"] },
  { key: "t16", who: "requester2", title: "Di chuyển dữ liệu từ ổ đĩa cũ sang máy mới", categoryCode: "HARDWARE", priority: "NORMAL",
    description: "Cần sao chép toàn bộ dữ liệu cá nhân từ máy cũ sang máy được cấp mới.", steps: ["discard"] },
];

type LeaveStep = "submit" | "approve" | "reject" | "withdraw" | "discard";
interface Leave { key: string; who: "employee1" | "employee2" | "dual"; kind: "ANNUAL" | "SICK" | "UNPAID"; startDate: string; days: number; reason: string; steps: LeaveStep[]; by?: "manager" }

const LEAVES: Leave[] = [
  { key: "l01", who: "employee1", kind: "ANNUAL", startDate: "2026-12-22", days: 5, reason: "Nghỉ phép năm cùng gia đình về quê đón Tết Dương lịch. Công việc đã bàn giao cho đồng nghiệp trong nhóm.", steps: ["submit"] },
  { key: "l02", who: "employee2", kind: "SICK", startDate: "2026-12-03", days: 2, reason: "Nghỉ điều trị viêm họng theo chỉ định của bác sĩ. Đã gửi lại giấy khám bệnh cho bộ phận nhân sự.", steps: ["submit"] },
  { key: "l03", who: "dual", kind: "ANNUAL", startDate: "2027-01-11", days: 3, reason: "Đi công việc gia đình, đã sắp xếp người trực thay trong thời gian vắng mặt.", steps: ["submit"] },
  { key: "l04", who: "employee1", kind: "ANNUAL", startDate: "2026-12-08", days: 2, reason: "Nghỉ đưa con đi khám sức khỏe định kỳ.", steps: ["submit", "approve"], by: "manager" },
  { key: "l05", who: "employee2", kind: "ANNUAL", startDate: "2026-12-15", days: 4, reason: "Du lịch ngắn ngày cùng gia đình, đã hoàn thành các hạng mục báo cáo quý.", steps: ["submit", "approve"], by: "manager" },
  { key: "l06", who: "employee2", kind: "UNPAID", startDate: "2027-02-01", days: 10, reason: "Xin nghỉ không lương để chăm sóc người thân sau phẫu thuật.", steps: ["submit", "approve"], by: "manager" },
  { key: "l07", who: "employee1", kind: "ANNUAL", startDate: "2026-12-24", days: 7, reason: "Nghỉ kéo dài dịp cuối năm.", steps: ["submit", "reject"], by: "manager" },
  { key: "l08", who: "employee2", kind: "SICK", startDate: "2026-11-30", days: 1, reason: "Mệt mỏi, sốt nhẹ, xin nghỉ một ngày để nghỉ ngơi.", steps: ["submit", "withdraw"] },
  { key: "l09", who: "employee1", kind: "ANNUAL", startDate: "2027-01-18", days: 5, reason: "Dự định nghỉ phép năm, đang chờ xác nhận lịch của dự án trước khi gửi.", steps: [] },
  { key: "l10", who: "employee2", kind: "UNPAID", startDate: "2026-12-29", days: 2, reason: "Nhập nhầm ngày nghỉ, hủy bản nháp.", steps: ["discard"] },
];

const out: Record<string, string> = {};
async function run(api: Api, entity: string, key: string, data: object, steps: string[], actors: Record<string, Api> = {}) {
  const recordId = id(key);
  out[key] = recordId;
  const created = await api.create(entity, data, recordId);
  if (created.status !== 201 && created.status !== 200) throw new Error(`create ${key}: ${created.status} ${JSON.stringify(created.body)}`);
  let version: number = created.body.version;
  for (const step of steps) {
    const actor = actors[step] ?? api;
    const current = await actor.get(`/entities/${entity}/records/${recordId}`);
    if (current.status !== 200) throw new Error(`read ${key}: ${current.status}`);
    version = current.body.version;
    // idempotent re-run: a transition already applied makes the next one fail with TRANSITION_NOT_ALLOWED; skip it.
    const reply = await actor.transition(entity, recordId, step, version);
    if (reply.status !== 200 && reply.status !== 409 && reply.status !== 403) throw new Error(`${key}/${step}: ${reply.status} ${JSON.stringify(reply.body)}`);
  }
}

const admin = await apiLogin("admin");
for (const category of CATEGORIES) {
  const existing = await admin.get(`/entities/category/records?q=${category.code}&limit=20`);
  if (!existing.body.items.some((item: { data: { code: string } }) => item.data.code === category.code)) {
    const reply = await admin.create("category", category, id(`cat-${category.code}`));
    if (reply.status !== 201) throw new Error(`category ${category.code}: ${reply.status}`);
  }
}

const it = { requester1: await apiLogin("requester1"), requester2: await apiLogin("requester2"), dual: await apiLogin("dual"), agent: await apiLogin("agent") };
for (const ticket of TICKETS) {
  const owner = it[ticket.who];
  const staffSteps = new Set(["start", "resolve"]);
  const actors = Object.fromEntries([...staffSteps].map((step) => [step, it.agent]));
  await run(owner, "ticket", ticket.key, { title: ticket.title, description: ticket.description, categoryCode: ticket.categoryCode, priority: ticket.priority }, ticket.steps, actors);
}

const hrActors = { employee1: (await apiLogin("employee1")).forApp(HR), employee2: (await apiLogin("employee2")).forApp(HR), dual: it.dual.forApp(HR), manager: (await apiLogin("manager")).forApp(HR) };
for (const leave of LEAVES) {
  const owner = hrActors[leave.who];
  const manager = hrActors.manager;
  await run(owner, "leaveRequest", leave.key, { kind: leave.kind, startDate: leave.startDate, days: leave.days, reason: leave.reason }, leave.steps, { approve: manager, reject: manager });
}

writeFileSync(localFile("demo-ids.json"), JSON.stringify(out, null, 2));
console.log(`seeded ${TICKETS.length} tickets, ${LEAVES.length} leave requests, ${CATEGORIES.length} categories`);
for (const api of [admin, ...Object.values(it), ...Object.values(hrActors)]) await api.dispose().catch(() => {});
